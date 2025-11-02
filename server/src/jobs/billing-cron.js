// server/src/jobs/billing-cron.js
const { query, withClient } = require("../db");
const { sendWhatsapp } = require("../services/messenger");
const { msgPre, msgDue, msgLate } = require("../services/message-templates");

const SCHEMA = process.env.DB_SCHEMA || "public";

// Utils
function pad2(n) { return String(n).padStart(2, "0"); }
function isoDate(d) {
  const date = new Date(d);
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function effectiveBillingDay(date, billingDay) {
  const y = date.getFullYear(), m = date.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return Math.min(Number(billingDay), last);
}
function dueDateForMonth(baseDate, billingDay) {
  const y = baseDate.getFullYear(), m = baseDate.getMonth();
  const eff = effectiveBillingDay(baseDate, billingDay);
  return new Date(y, m, eff);
}

// Grava/atualiza notificação sem violar UNIQUE
async function upsertAutoNotification({
  companyId, billingId = null, contractId, clientId,
  targetDate, toNumber, message, type, dueDate, evoResult
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
    evoResult?.data ?? null,  // $11
    evoResult?.ok ? null : (evoResult?.error || null), // $12
    evoResult?.ok ? new Date() : null, // $13
    String(dueDate)           // $14
  ];

  const r = await query(sql, params);
  return r.rows[0]?.id;
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
  `, [todayStr]);

  for (const c of contracts.rows) {
    const eff = effectiveBillingDay(now, Number(c.billing_day));
    console.log(`[BILL] Contract #${c.id}: day=${day}, effectiveBillingDay=${eff}`);

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

  const rows = await query(`
    SELECT c.id, c.company_id, c.client_id, c.description, c.value, c.billing_day,
           cl.name AS client_name, cl.phone AS client_phone
    FROM ${SCHEMA}.contracts c
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    WHERE c.start_date <= $1 AND c.end_date >= $1
  `, [baseStr]);

  for (const c of rows.rows) {
    const due = dueDateForMonth(base, c.billing_day);
    const dueStr = isoDate(due);
    if (dueStr !== baseStr) continue;
    if (!c.client_phone) continue;

    const mesRefDate = new Date(due.getFullYear(), due.getMonth(), 1);
    const text = msgPre({
      nome: c.client_name,
      tipoContrato: c.description,
      mesRefDate,
      vencimentoDate: due,
      valor: c.value,
      pix: process.env.PIX_CHAVE || "SUA_CHAVE_PIX"
    });

    let evo = { ok: false, error: "no-phone" };
    try { evo = await sendWhatsapp(c.company_id, { number: c.client_phone, text }); }
    catch (e) { evo = { ok: false, error: e.message }; }

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
      evoResult: evo
    });

    console.log(`↗ [PRE] c#${c.id} due=${dueStr} -> ${evo.ok ? "sent" : "failed"}`);
  }
}

// 3) D0 (DUE) — garante geração antes de notificar
async function sendDueReminders(now = new Date()) {
  console.log(`[DUE] Input 'now' date: ${now}`);
  const todayStr = isoDate(now);

  try { await generateBillingsForToday(now); }
  catch (e) { console.error("[DUE] generateBillingsForToday falhou:", e.message); }

  const rows = await query(`
    SELECT b.id AS billing_id, b.contract_id, b.amount, b.status,
           c.company_id, c.client_id, c.description,
           cl.name AS client_name, cl.phone AS client_phone
    FROM ${SCHEMA}.billings b
    JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    WHERE b.billing_date = $1
  `, [todayStr]);

  console.log(`[DUE] todayStr: ${todayStr}, encontrados ${rows.rowCount} billings para ${todayStr}`);

  for (const r of rows.rows) {
    const s = String(r.status || "").toLowerCase();
    if (s === "paid" || s === "canceled") continue;
    if (!r.client_phone) continue;

    const mesRefDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const text = msgDue({
      nome: r.client_name,
      tipoContrato: r.description,
      mesRefDate,
      vencimentoDate: new Date(todayStr),
      valor: r.amount,
      pix: process.env.PIX_CHAVE || "SUA_CHAVE_PIX"
    });

    let evo = { ok: false, error: "no-phone" };
    try { evo = await sendWhatsapp(r.company_id, { number: r.client_phone, text }); }
    catch (e) { evo = { ok: false, error: e.message }; }

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
      evoResult: evo
    });

    console.log(`→ [DUE] c#${r.contract_id} ${todayStr} -> ${evo.ok ? "sent" : `failed (${evo.error || evo.status})`}`);
  }
}

// 4) D+4 (LATE)
async function sendLateReminders(now = new Date()) {
  const target = addDays(now, -4);
  const targetStr = isoDate(target);

  const rows = await query(`
    SELECT b.id AS billing_id, b.contract_id, b.amount, b.status, b.billing_date,
           c.company_id, c.client_id, c.description,
           cl.name AS client_name, cl.phone AS client_phone
    FROM ${SCHEMA}.billings b
    JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    WHERE b.billing_date = $1
  `, [targetStr]);

  for (const r of rows.rows) {
    const s = String(r.status || "").toLowerCase();
    if (s === "paid" || s === "canceled") continue;
    if (!r.client_phone) continue;

    const mesRefDate = new Date(target.getFullYear(), target.getMonth(), 1);
    const text = msgLate({
      nome: r.client_name,
      tipoContrato: r.description,
      mesRefDate,
      vencimentoDate: new Date(targetStr),
      valor: r.amount,
      pix: process.env.PIX_CHAVE || "SUA_CHAVE_PIX"
    });

    let evo = { ok: false, error: "no-phone" };
    try { evo = await sendWhatsapp(r.company_id, { number: r.client_phone, text }); }
    catch (e) { evo = { ok: false, error: e.message }; }

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
      evoResult: evo
    });

    console.log(`↘ [LATE] c#${r.contract_id} ${targetStr} -> ${evo.ok ? "sent" : "failed"}`);
  }
}

// Orquestração
async function runDaily(now = new Date(), opts = {}) {
  const { generate = true, pre = true, due = true, late = true } = opts;
  if (generate) await generateBillingsForToday(now);
  if (pre) await sendPreReminders(now);
  if (due) await sendDueReminders(now);
  if (late) await sendLateReminders(now);
}

// Wrappers (para cron com horários distintos)
async function runPreOnly(now = new Date()) { await sendPreReminders(now); }
async function runDueOnly(now = new Date()) { await sendDueReminders(now); }
async function runLateOnly(now = new Date()) { await sendLateReminders(now); }

module.exports = {
  runDaily,
  runPreOnly,
  runDueOnly,
  runLateOnly,
  generateBillingsForToday,
  sendPreReminders,
  sendDueReminders,
  sendLateReminders,
  effectiveBillingDay,
  dueDateForMonth
};
