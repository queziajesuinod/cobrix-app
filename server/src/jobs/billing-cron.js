// server/src/jobs/billing-cron.js
const { query, withClient } = require("../db");
const { sendWhatsapp } = require("../services/messenger");
const { msgPre, msgDue, msgLate } = require("../services/message-templates");
const { ensureGatewayPaymentLink } = require("../services/payment-gateway");
const { ensureDateOnly, formatISODate, addDays } = require("../utils/date-only");
const SCHEMA = process.env.DB_SCHEMA || "public";

function isoDate(value) { return formatISODate(value); }
function effectiveBillingDay(dateValue, billingDay) {
  const base = ensureDateOnly(dateValue) || new Date();
  const y = base.getFullYear();
  const m = base.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return Math.min(Number(billingDay), last);
}
function dueDateForMonth(baseDate, billingDay) {
  const base = ensureDateOnly(baseDate) || new Date();
  const eff = effectiveBillingDay(base, billingDay);
  return new Date(base.getFullYear(), base.getMonth(), eff);
}

function normalizeBillingIntervalMonths(value) {
  const numeric = Number(value);
  if (numeric === 3 || numeric === 12) return numeric;
  if (Number.isNaN(numeric) || numeric <= 0) return 1;
  return 1;
}

function isBillingMonthFor(contract, dateValue) {
  const target = ensureDateOnly(dateValue);
  const start = ensureDateOnly(contract?.start_date);
  if (!target || !start) return true;
  const interval = normalizeBillingIntervalMonths(contract?.billing_interval_months);
  if (interval <= 1) return true;
  const monthsDiff = (target.getFullYear() - start.getFullYear()) * 12 + (target.getMonth() - start.getMonth());
  if (monthsDiff < 0) return false;
  return monthsDiff % interval === 0;
}

function summarizeGatewayPayment(gatewayPayment) {
  if (!gatewayPayment) return null;
  return {
    txid: gatewayPayment.txid || null,
    paymentUrl: gatewayPayment.paymentUrl || null,
    copyPaste: gatewayPayment.copyPaste || null,
    expiresAtIso: gatewayPayment.expiresAtIso || null,
  };
}

function encodeProviderResponse(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// Grava/atualiza notificação sem violar UNIQUE
async function upsertAutoNotification({
  companyId, billingId = null, contractId, clientId,
  targetDate, toNumber, message, type, dueDate, evoResult, providerResponse = null
}) {
  const sql = `
    INSERT INTO ${SCHEMA}.billing_notifications
      (company_id, billing_id, contract_id, client_id, kind, target_date,
       status, provider, to_number, message, provider_status, provider_response,
       error, created_at, sent_at, type, due_date)
    VALUES
      ($1,$2,$3,$4,
       $5,$6,
       $7,'evo',$8,$9,$10,$11,
       $12,NOW(),$13,$5,$14)
    RETURNING id
  `;

  const params = [
    Number(companyId),        // $1
    billingId,                // $2
    Number(contractId),       // $3
    Number(clientId),         // $4
    String(type),             // $5 - usado para kind e type
    String(targetDate),       // $6
    (evoResult?.ok ? 'sent' : 'failed'), // $7
    String(toNumber || ''),   // $8
    String(message || ''),    // $9
    evoResult?.status ?? null, // $10
    encodeProviderResponse(providerResponse ?? (evoResult?.data ?? null)),  // $11
    evoResult?.ok ? null : (evoResult?.error || null), // $12
    evoResult?.ok ? new Date() : null, // $13
    String(dueDate)           // $14
  ];

  const r = await query(sql, params);
  return r.rows[0]?.id;
}

async function renewRecurringContracts(now = new Date()) {
  const todayStr = isoDate(now);
  const rows = await query(`
    SELECT c.*, ct.adjustment_percent, ct.is_recurring
    FROM ${SCHEMA}.contracts c
    JOIN ${SCHEMA}.contract_types ct ON ct.id = c.contract_type_id
    WHERE ct.is_recurring = true
      AND c.cancellation_date IS NULL
      AND DATE(c.end_date) <= DATE($1)
      AND NOT EXISTS (
        SELECT 1 FROM ${SCHEMA}.contracts c2
        WHERE c2.recurrence_of = c.id
      )
  `, [todayStr]);

  for (const c of rows.rows) {
    const baseEnd = ensureDateOnly(c.end_date || todayStr) || ensureDateOnly(todayStr);
    const newStart = addDays(baseEnd, 1);
    const newEnd = addDays(newStart, 365);
    const factor = 1 + Number(c.adjustment_percent || 0) / 100;
    const newValue = Number(c.value || 0) * factor;
    await query(`
      INSERT INTO ${SCHEMA}.contracts
        (company_id, client_id, contract_type_id, description, value, start_date, end_date, billing_day, billing_interval_months, recurrence_of, cancellation_date)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      c.company_id,
      c.client_id,
      c.contract_type_id,
      c.description,
      newValue,
      isoDate(newStart),
      isoDate(newEnd),
      c.billing_day,
      c.billing_interval_months || 1,
      c.id,
      null,
    ]);
    console.log(`[RENEW] Contrato #${c.id} renovado para ${isoDate(newStart)}-${isoDate(newEnd)} com valor ${newValue.toFixed(2)}`);
  }
}

// 1) Gera cobranças do dia (idempotente)
async function generateBillingsForToday(now = new Date()) {
  const todayStr = isoDate(now);
  const day = now.getDate();

  const contracts = await query(`
    SELECT c.*, cl.name AS client_name
    FROM ${SCHEMA}.contracts c
    JOIN ${SCHEMA}.clients  cl ON cl.id = c.client_id
    WHERE c.start_date <= $1 AND c.end_date >= $1
      AND (c.cancellation_date IS NULL OR c.cancellation_date >= $1)
  `, [todayStr]);

  for (const c of contracts.rows) {
    const interval = normalizeBillingIntervalMonths(c.billing_interval_months);
    const inCycle = isBillingMonthFor(c, now);
    if (!inCycle) {
      console.log(`[BILL] Contract #${c.id}: Not a billing month for interval=${interval}. Skipping.`);
      continue;
    }
    const eff = effectiveBillingDay(now, Number(c.billing_day));
    console.log(`[BILL] Contract #${c.id}: day=${day}, effectiveBillingDay=${eff}, interval=${interval}`);

    await withClient(async (client) => {
        await client.query("BEGIN");
      try {
        // Ensure contract_month_status is set to \'pending\' for the current month
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        console.log(`[BILL] Attempting to insert/update contract_month_status for contract #${c.id}, year=${currentYear}, month=${currentMonth}`);
        try {
          const cmsInsertResult = await client.query(
            `INSERT INTO ${SCHEMA}.contract_month_status (company_id, contract_id, year, month, status)
     VALUES ($1, $2, $3, $4, \'pending\')
      ON CONFLICT (contract_id, year, month)
      DO UPDATE
        SET status = CASE
          WHEN ${SCHEMA}.contract_month_status.status IN (\'paid\',\'canceled\')
            THEN ${SCHEMA}.contract_month_status.status
          ELSE EXCLUDED.status
        END`,
            [c.company_id, c.id, currentYear, currentMonth]
          );
          console.log(`[BILL] contract_month_status inserted/updated for contract #${c.id}, year=${currentYear}, month=${currentMonth}. RowCount: ${cmsInsertResult.rowCount}`);
        } catch (cmsError) {
          console.error(`[BILL] Failed to insert/update contract_month_status for contract #${c.id}:`, cmsError.message);
        }

        if (day !== eff) {
          console.log(`[BILL] Contract #${c.id}: Not effective billing day. Skipping billing generation.`);
        } else if (c.last_billed_date && String(c.last_billed_date) >= todayStr) {
          console.log(`[BILL] Contract #${c.id}: Already billed for today. Skipping billing generation.`);
        } else {
          const billingInsertResult = await client.query(
            `INSERT INTO ${SCHEMA}.billings (company_id, contract_id, billing_date, amount, status)
     VALUES ($1,$2,$3,$4,\'pending\')
      ON CONFLICT ( contract_id, billing_date) DO NOTHING`,
            [c.company_id, c.id, todayStr, c.value]
          );
          console.log(`[BILL] Billing insert result for contract #${c.id}: rowCount=${billingInsertResult.rowCount}`);

          await client.query(
            `UPDATE ${SCHEMA}.contracts SET last_billed_date=$1 WHERE id=$2`,
            [todayStr, c.id]
          );
          console.log(`✔ [BILL] c#${c.id} ${todayStr} valor=${c.value}. Billing generated.`);
        }
        await client.query("COMMIT");
        console.log(`✔ [BILL] c#${c.id}. Transaction committed.`);
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[BILL] falhou para c#" + c.id + ":", e.message);
      } finally {
        console.log(`[BILL] Finished processing contract #${c.id}.`);
      }
    });
  }
}

// 2) D-3 (PRE)
async function sendPreReminders(now = new Date()) {
  const base = addDays(now, 3);
  const baseStr = isoDate(base);
  const year = base.getFullYear();
  const month = base.getMonth() + 1;

  const rows = await query(`
    SELECT c.id, c.company_id, c.client_id, c.description, c.value, c.billing_day, c.start_date, c.billing_interval_months,
           cl.name AS client_name, cl.responsavel AS client_responsavel, cl.phone AS client_phone,
           cl.document_cpf AS client_document_cpf, cl.document_cnpj AS client_document_cnpj,
           cms.status AS month_status
    FROM ${SCHEMA}.contracts c
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    LEFT JOIN ${SCHEMA}.contract_month_status cms
      ON cms.contract_id = c.id AND cms.year = $2 AND cms.month = $3
    WHERE c.start_date <= $1 AND c.end_date >= $1
      AND (c.cancellation_date IS NULL OR c.cancellation_date >= $1)
      AND LOWER(COALESCE(cms.status, 'pending')) <> 'paid'
  `, [baseStr, year, month]);

  for (const c of rows.rows) {
    if (!isBillingMonthFor(c, base)) {
      console.log(`[PRE] Contract #${c.id}: Skipping because ${isoDate(base)} is not in the billing interval.`);
      continue;
    }
    const due = dueDateForMonth(base, c.billing_day);
    const dueStr = isoDate(due);
    if (dueStr !== baseStr) continue;
    if (!c.client_phone) continue;

    const mesRefDate = new Date(due.getFullYear(), due.getMonth(), 1);
    const recipientName = c.client_responsavel || c.client_name;
    const clientDocument = {
      cpf: c.client_document_cpf || null,
      cnpj: c.client_document_cnpj || null,
    };
    const gatewayPayment = await ensureGatewayPaymentLink({
      companyId: c.company_id,
      contractId: c.id,
      billingId: null,
      dueDate: dueStr,
      amount: c.value,
      contractDescription: c.description,
      clientName: recipientName,
      clientDocument,
    });
    const gatewaySummary = summarizeGatewayPayment(gatewayPayment);
    const text = await msgPre({
      nome: recipientName,
      responsavel: c.client_responsavel,
      client_name: c.client_name,
      tipoContrato: c.description,
      mesRefDate,
      vencimentoDate: due,
      valor: c.value,
      companyId: c.company_id,
      gatewayPayment,
      gatewayPaymentLink: Boolean(gatewaySummary?.paymentUrl || gatewaySummary?.copyPaste),
      payment_link: gatewaySummary?.paymentUrl || null,
      payment_code: gatewaySummary?.copyPaste || null,
      payment_qrcode: gatewayPayment?.qrCodeImage || null,
      payment_expires_at_iso: gatewaySummary?.expiresAtIso || null,
    });

    let evo = { ok: false, error: "no-phone" };
    try { evo = await sendWhatsapp(c.company_id, { number: c.client_phone, text }); }
    catch (e) { evo = { ok: false, error: e.message }; }
    const providerResponse = {
      messenger: evo.data ?? null,
      messengerStatus: evo.status ?? null,
      gateway: gatewaySummary,
    };

    await upsertAutoNotification({
      companyId: c.company_id,
      billingId: null,
      contractId: c.id,
      clientId: c.client_id,
      targetDate: baseStr,
      toNumber: c.client_phone,
      message: text,
      type: "pre",
      dueDate: dueStr,
      evoResult: evo,
      providerResponse,
    });

    console.log(`↗ [PRE] c#${c.id} due=${dueStr} -> ${evo.ok ? "sent" : "failed"}`);
  }
}

// 3) D0 (DUE) — garante geração antes de notificar
async function sendDueReminders(now = new Date()) {
  console.log(`[DUE] Input 'now' date: ${now}`);
  const todayStr = isoDate(now);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  try { await generateBillingsForToday(now); }
  catch (e) { console.error("[DUE] generateBillingsForToday falhou:", e.message); }

  const rows = await query(`
    SELECT b.id AS billing_id, b.contract_id, b.amount, b.status,
           c.company_id, c.client_id, c.description,
           cl.name AS client_name, cl.responsavel AS client_responsavel, cl.phone AS client_phone,
           cl.document_cpf AS client_document_cpf, cl.document_cnpj AS client_document_cnpj,
           cms.status AS month_status
    FROM ${SCHEMA}.billings b
    JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    LEFT JOIN ${SCHEMA}.contract_month_status cms
      ON cms.contract_id = c.id AND cms.year = $2 AND cms.month = $3
    WHERE b.billing_date = $1
      AND (c.cancellation_date IS NULL OR c.cancellation_date >= $1)
      AND LOWER(COALESCE(cms.status, 'pending')) <> 'paid'
  `, [todayStr, year, month]);

  console.log(`[DUE] todayStr: ${todayStr}, encontrados ${rows.rowCount} billings para ${todayStr}`);

  for (const r of rows.rows) {
    const s = String(r.status || "").toLowerCase();
    if (s === "paid" || s === "canceled") continue;
    if (!r.client_phone) continue;

    const mesRefDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const recipientName = r.client_responsavel || r.client_name;
    const clientDocument = {
      cpf: r.client_document_cpf || null,
      cnpj: r.client_document_cnpj || null,
    };
    const gatewayPayment = await ensureGatewayPaymentLink({
      companyId: r.company_id,
      contractId: r.contract_id,
      billingId: r.billing_id || null,
      dueDate: todayStr,
      amount: r.amount,
      contractDescription: r.description,
      clientName: recipientName,
      clientDocument,
    });
    const gatewaySummary = summarizeGatewayPayment(gatewayPayment);
    const text = await msgDue({
      nome: recipientName,
      responsavel: r.client_responsavel,
      client_name: r.client_name,
      tipoContrato: r.description,
      mesRefDate,
      vencimentoDate: ensureDateOnly(todayStr),
      valor: r.amount,
      companyId: r.company_id,
      gatewayPayment,
      gatewayPaymentLink: Boolean(gatewaySummary?.paymentUrl || gatewaySummary?.copyPaste),
      payment_link: gatewaySummary?.paymentUrl || null,
      payment_code: gatewaySummary?.copyPaste || null,
      payment_qrcode: gatewayPayment?.qrCodeImage || null,
      payment_expires_at_iso: gatewaySummary?.expiresAtIso || null,
    });

    let evo = { ok: false, error: "no-phone" };
    try { evo = await sendWhatsapp(r.company_id, { number: r.client_phone, text }); }
    catch (e) { evo = { ok: false, error: e.message }; }
    const providerResponse = {
      messenger: evo.data ?? null,
      messengerStatus: evo.status ?? null,
      gateway: gatewaySummary,
    };

    await upsertAutoNotification({
      companyId: r.company_id,
      billingId: r.billing_id,
      contractId: r.contract_id,
      clientId: r.client_id,
      targetDate: todayStr,
      toNumber: r.client_phone,
      message: text,
      type: "due",
      dueDate: todayStr,
      evoResult: evo,
      providerResponse,
    });

    console.log(`→ [DUE] c#${r.contract_id} ${todayStr} -> ${evo.ok ? "sent" : `failed (${evo.error || evo.status})`}`);
  }
}

// 4) D+4 (LATE)
async function sendLateReminders(now = new Date()) {
  const target = addDays(now, -4);
  const targetStr = isoDate(target);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;

  const rows = await query(`
    SELECT b.id AS billing_id, b.contract_id, b.amount, b.status, b.billing_date,
           c.company_id, c.client_id, c.description,
           cl.name AS client_name, cl.responsavel AS client_responsavel, cl.phone AS client_phone,
           cl.document_cpf AS client_document_cpf, cl.document_cnpj AS client_document_cnpj,
           cms.status AS month_status
    FROM ${SCHEMA}.billings b
    JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    LEFT JOIN ${SCHEMA}.contract_month_status cms
      ON cms.contract_id = c.id AND cms.year = $2 AND cms.month = $3
    WHERE b.billing_date = $1
      AND (c.cancellation_date IS NULL OR c.cancellation_date >= $1)
      AND LOWER(COALESCE(cms.status, 'pending')) <> 'paid'
  `, [targetStr, year, month]);

  for (const r of rows.rows) {
    const s = String(r.status || "").toLowerCase();
    if (s === "paid" || s === "canceled") continue;
    if (!r.client_phone) continue;

    const mesRefDate = new Date(target.getFullYear(), target.getMonth(), 1);
    const recipientName = r.client_responsavel || r.client_name;
    const clientDocument = {
      cpf: r.client_document_cpf || null,
      cnpj: r.client_document_cnpj || null,
    };
    const gatewayPayment = await ensureGatewayPaymentLink({
      companyId: r.company_id,
      contractId: r.contract_id,
      billingId: r.billing_id || null,
      dueDate: targetStr,
      amount: r.amount,
      contractDescription: r.description,
      clientName: recipientName,
      clientDocument,
    });
    const gatewaySummary = summarizeGatewayPayment(gatewayPayment);
    const text = await msgLate({
      nome: recipientName,
      responsavel: r.client_responsavel,
      client_name: r.client_name,
      tipoContrato: r.description,
      mesRefDate,
      vencimentoDate: ensureDateOnly(targetStr),
      valor: r.amount,
      companyId: r.company_id,
      gatewayPayment,
      gatewayPaymentLink: Boolean(gatewaySummary?.paymentUrl || gatewaySummary?.copyPaste),
      payment_link: gatewaySummary?.paymentUrl || null,
      payment_code: gatewaySummary?.copyPaste || null,
      payment_qrcode: gatewayPayment?.qrCodeImage || null,
      payment_expires_at_iso: gatewaySummary?.expiresAtIso || null,
    });

    let evo = { ok: false, error: "no-phone" };
    try { evo = await sendWhatsapp(r.company_id, { number: r.client_phone, text }); }
    catch (e) { evo = { ok: false, error: e.message }; }
    const providerResponse = {
      messenger: evo.data ?? null,
      messengerStatus: evo.status ?? null,
      gateway: gatewaySummary,
    };

    await upsertAutoNotification({
      companyId: r.company_id,
      billingId: r.billing_id,
      contractId: r.contract_id,
      clientId: r.client_id,
      targetDate: isoDate(now),
      toNumber: r.client_phone,
      message: text,
      type: "late",
      dueDate: targetStr,
      evoResult: evo,
      providerResponse,
    });

    console.log(`↘ [LATE] c#${r.contract_id} ${targetStr} -> ${evo.ok ? "sent" : "failed"}`);
  }
}

// Orquestração
async function runDaily(now = new Date(), opts = {}) {
  const { generate = true, pre = true, due = true, late = true } = opts;
  await renewRecurringContracts(now);
  if (generate) await generateBillingsForToday(now);
  if (pre) await sendPreReminders(now);
  if (due) await sendDueReminders(now);
  if (late) await sendLateReminders(now);
}

// Wrappers (para cron com horários distintos)
async function runPreOnly(now = new Date()) { await sendPreReminders(now); }
async function runDueOnly(now = new Date()) { await sendDueReminders(now); }
async function runLateOnly(now = new Date()) { await sendLateReminders(now); }
async function runRenewOnly(now = new Date()) { await renewRecurringContracts(now); }

module.exports = {
  runDaily,
  runPreOnly,
  runDueOnly,
  runLateOnly,
  runRenewOnly,
  generateBillingsForToday,
  sendPreReminders,
  sendDueReminders,
  sendLateReminders,
  effectiveBillingDay,
  dueDateForMonth,
  normalizeBillingIntervalMonths,
  isBillingMonthFor,
};
