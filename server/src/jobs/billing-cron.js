// server/src/jobs/billing-cron.js
const { query, withClient } = require('../db');
const { sendWhatsapp } = require('../services/messenger');
const { msgPre, msgDue, msgLate } = require('../services/message-templates');

const SCHEMA = process.env.DB_SCHEMA || 'public';

// Utils
function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
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

// Grava/atualiza notificação AUTO sem violar UNIQUE
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
      ($1,$2,$3,$4,'auto',$5,
       $6,'evo',$7,$8,$9,$10,
       $11,NOW(),$12,$13,$14)
    ON CONFLICT ON CONSTRAINT uq_bn_auto_one_per_kind_month
    DO UPDATE SET
      status = EXCLUDED.status,
      provider_status = EXCLUDED.provider_status,
      provider_response = EXCLUDED.provider_response,
      error = EXCLUDED.error,
      sent_at = COALESCE(${SCHEMA}.billing_notifications.sent_at, EXCLUDED.sent_at)
    RETURNING id
  `;
  const params = [
    Number(companyId),
    billingId,
    Number(contractId),
    Number(clientId),
    String(targetDate),
    (evoResult?.ok ? 'sent' : 'failed'),
    String(toNumber || ''),
    String(message || ''),
    evoResult?.status ?? null,
    evoResult?.data ?? null,
    evoResult?.ok ? null : (evoResult?.error || null),
    evoResult?.ok ? new Date() : null,
    String(type),  // 'pre'|'due'|'late'
    String(dueDate)
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
    JOIN ${SCHEMA}.contract_month_status cms ON c.id = cms.contract_id
    JOIN ${SCHEMA}.clients  cl ON cl.id = c.client_id
    WHERE c.start_date <= $1 AND c.end_date >= $1 AND cms.status != 'paid'
  `, [todayStr]);

  for (const c of contracts.rows) {
    const eff = effectiveBillingDay(now, Number(c.billing_day));
    if (day !== eff) continue;
    if (c.last_billed_date && String(c.last_billed_date) >= todayStr) continue;

    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO ${SCHEMA}.billings (company_id, contract_id, billing_date, amount, status)
   VALUES ($1,$2,$3,$4,'pending')
    ON CONFLICT ( contract_id, billing_date) DO NOTHING`,
          [c.company_id, c.id, todayStr, c.value]
        );

        await client.query(
          `UPDATE ${SCHEMA}.contracts SET last_billed_date=$1 WHERE id=$2`,
          [todayStr, c.id]
        );
        await client.query('COMMIT');
        console.log(`✔ [BILL] c#${c.id} ${todayStr} valor=${c.value}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('[BILL] falhou', e.message);
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

    // trava por mês já pago/cancelado
    const cms = await query(`
      SELECT status FROM ${SCHEMA}.contract_month_status
      WHERE contract_id=$1 AND year=$2 AND month=$3
    `, [c.id, due.getFullYear(), due.getMonth() + 1]);
    if (cms.rows[0] && (cms.rows[0].status === 'paid' || cms.rows[0].status === 'canceled')) continue;

    const mesRefDate = new Date(due.getFullYear(), due.getMonth(), 1);
    const text = msgPre({
      nome: c.client_name,
      tipoContrato: c.description,
      mesRefDate,
      vencimentoDate: due,
      valor: c.value,
      pix: process.env.PIX_CHAVE || 'SUA_CHAVE_PIX'
    });

    let evo = { ok: false, error: 'no-phone' };
    try { evo = await sendWhatsapp(c.company_id, { number: c.client_phone, text }); }
    catch (e) { evo = { ok: false, error: e.message }; }

   async function upsertAutoNotification({
  companyId, billingId = null, contractId, clientId,
  targetDate, toNumber, message, type, dueDate, evoResult
}) {
  // IMPORTANTE: agora usamos o índice parcial + coluna gerada due_month
  // -> ON CONFLICT (company_id, contract_id, type, due_month) WHERE kind='auto'
  const sql = `
    INSERT INTO ${SCHEMA}.billing_notifications
      (company_id, billing_id, contract_id, client_id, kind, target_date,
       status, provider, to_number, message, provider_status, provider_response,
       error, created_at, sent_at, type, due_date)
    VALUES
      ($1,$2,$3,$4,'auto',$5,
       $6,'evo',$7,$8,$9,$10,
       $11,NOW(),$12,$13,$14)
    ON CONFLICT (company_id, contract_id, type, due_month)
      WHERE kind = 'auto'
    DO UPDATE SET
      status           = EXCLUDED.status,
      provider_status  = EXCLUDED.provider_status,
      provider_response= EXCLUDED.provider_response,
      error            = EXCLUDED.error,
      -- mantém sent_at antigo se já houver; senão usa o novo
      sent_at          = COALESCE(${SCHEMA}.billing_notifications.sent_at, EXCLUDED.sent_at)
    RETURNING id
  `;

  const params = [
    Number(companyId),
    billingId,
    Number(contractId),
    Number(clientId),
    String(targetDate),
    (evoResult?.ok ? 'sent' : 'failed'),
    String(toNumber || ''),
    String(message || ''),
    evoResult?.status ?? null,
    evoResult?.data ?? null,
    evoResult?.ok ? null : (evoResult?.error || null),
    evoResult?.ok ? new Date() : null,
    String(type),            // 'pre' | 'due' | 'late'
    String(dueDate)          // 'YYYY-MM-DD'
  ];

  const r = await query(sql, params);
  return r.rows[0]?.id;
}

    console.log(`↗ [PRE] c#${c.id} due=${dueStr} -> ${evo.ok ? 'sent' : 'failed'}`);
  }
}

// 3) D0 (DUE) — garante geração antes de notificar
async function sendDueReminders(now = new Date()) {
  const todayStr = isoDate(now);

  try { await generateBillingsForToday(now); }
  catch (e) { console.error('[DUE] generateBillingsForToday falhou:', e.message); }

  const rows = await query(`
    SELECT b.id AS billing_id, b.contract_id, b.amount, b.status,
           c.company_id, c.client_id, c.description,
           cl.name AS client_name, cl.phone AS client_phone
    FROM ${SCHEMA}.billings b
    JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    WHERE b.billing_date = $1
  `, [todayStr]);

  console.log(`[DUE] encontrados ${rows.rowCount} billings para ${todayStr}`);

  for (const r of rows.rows) {
    const s = String(r.status || '').toLowerCase();
    if (s === 'paid' || s === 'canceled') continue;
    if (!r.client_phone) continue;

    const cms = await query(`
      SELECT status FROM ${SCHEMA}.contract_month_status
      WHERE contract_id=$1 AND year=$2 AND month=$3
    `, [r.contract_id, now.getFullYear(), now.getMonth() + 1]);
    if (cms.rows[0] && (cms.rows[0].status === 'paid' || cms.rows[0].status === 'canceled')) continue;

    const mesRefDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const text = msgDue({
      nome: r.client_name,
      tipoContrato: r.description,
      mesRefDate,
      vencimentoDate: new Date(todayStr),
      valor: r.amount,
      pix: process.env.PIX_CHAVE || 'SUA_CHAVE_PIX'
    });

    let evo = { ok: false, error: 'no-phone' };
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
      type: 'due',
      dueDate: todayStr,
      evoResult: evo
    });

    console.log(`→ [DUE] c#${r.contract_id} ${todayStr} -> ${evo.ok ? 'sent' : `failed (${evo.error || evo.status})`}`);
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
    const s = String(r.status || '').toLowerCase();
    if (s === 'paid' || s === 'canceled') continue;
    if (!r.client_phone) continue;

    const cms = await query(`
      SELECT status FROM ${SCHEMA}.contract_month_status
      WHERE contract_id=$1 AND year=$2 AND month=$3
    `, [r.contract_id, target.getFullYear(), target.getMonth() + 1]);
    if (cms.rows[0] && (cms.rows[0].status === 'paid' || cms.rows[0].status === 'canceled')) continue;

    const mesRefDate = new Date(target.getFullYear(), target.getMonth(), 1);
    const text = msgLate({
      nome: r.client_name,
      tipoContrato: r.description,
      mesRefDate,
      vencimentoDate: new Date(targetStr),
      valor: r.amount,
      pix: process.env.PIX_CHAVE || 'SUA_CHAVE_PIX'
    });

    let evo = { ok: false, error: 'no-phone' };
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
      type: 'late',
      dueDate: targetStr,
      evoResult: evo
    });

    console.log(`↘ [LATE] c#${r.contract_id} ${targetStr} -> ${evo.ok ? 'sent' : 'failed'}`);
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
