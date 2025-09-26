// server/src/jobs/billing-cron.js
const { query, withClient } = require('../db');
const { sendTextMessage } = require('../services/messenger');
const { msgPre, msgDue, msgLate } = require('../services/message-templates');

const SCHEMA = process.env.DB_SCHEMA || 'public';

// ---------------- utils de data ----------------
function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function effectiveBillingDay(date, billingDay) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return Math.min(Number(billingDay), lastDay);
}
function dueDateForMonth(baseDate, billingDay) {
  const y = baseDate.getFullYear();
  const m = baseDate.getMonth();
  const eff = effectiveBillingDay(baseDate, billingDay);
  return new Date(y, m, eff);
}

// -------------- insert completo em billing_notifications --------------
async function insertBillingNotification({
  companyId,
  billingId = null,
  contractId = null,
  clientId = null,
  kind = 'auto',               // 'auto' | 'manual'
  targetDate,                  // 'YYYY-MM-DD' (data da geração/envio)
  status = 'queued',           // 'queued' | 'sent' | 'failed' | 'skipped'
  provider = 'evo',
  toNumber = null,
  message = '',
  providerStatus = null,
  providerResponse = null,     // objeto -> jsonb
  error = null,
  sentAt = null,               // Date | null
  type,                        // 'pre' | 'due' | 'late' | 'manual'
  dueDate                      // 'YYYY-MM-DD'
}) {
  const sql = `
    INSERT INTO ${SCHEMA}.billing_notifications
      (company_id, billing_id, contract_id, client_id, kind, target_date,
       status, provider, to_number, message, provider_status, provider_response,
       error, created_at, sent_at, type, due_date)
    VALUES
      ($1,$2,$3,$4,$5,$6,
       $7,$8,$9,$10,$11,$12,
       $13,NOW(),$14,$15,$16)
    RETURNING id
  `;
  const params = [
    Number(companyId),                                          // $1
    billingId != null ? Number(billingId) : null,               // $2
    contractId != null ? Number(contractId) : null,             // $3
    clientId != null ? Number(clientId) : null,                 // $4
    String(kind),                                               // $5
    String(targetDate),                                         // $6
    String(status),                                             // $7
    String(provider),                                           // $8
    toNumber != null ? String(toNumber) : null,                 // $9
    message != null ? String(message) : '',                     // $10
    providerStatus != null ? String(providerStatus) : null,     // $11
    providerResponse ?? null,                                   // $12 (obj -> jsonb)
    error != null ? String(error) : null,                       // $13
    sentAt ?? null,                                             // $14
    String(type),                                               // $15
    String(dueDate),                                            // $16
  ];

  const r = await query(sql, params);
  return r.rows[0].id;
}

// ---------------- geração de billings (D0) ----------------
async function generateBillingsForToday(now = new Date()) {
  const todayStr = isoDate(now);
  const day = now.getDate();

  const contracts = await query(`
    SELECT c.*, cl.name AS client_name, cl.phone AS client_phone
    FROM ${SCHEMA}.contracts c
    JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
    WHERE c.start_date <= $1 AND c.end_date >= $1
  `, [todayStr]);

  for (const c of contracts.rows) {
    const eff = effectiveBillingDay(now, Number(c.billing_day));
    if (day !== eff) continue;
    if (c.last_billed_date && String(c.last_billed_date) >= todayStr) continue;

    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO ${SCHEMA}.billings (contract_id, billing_date, amount, status)
           VALUES ($1,$2,$3,'pending')
           ON CONFLICT (contract_id, billing_date) DO NOTHING`,
          [c.id, todayStr, c.value]
        );
        await client.query(
          `UPDATE ${SCHEMA}.contracts SET last_billed_date=$1 WHERE id=$2`,
          [todayStr, c.id]
        );
        await client.query('COMMIT');
        console.log(`✔ Billing c#${c.id} ${todayStr} valor=${c.value}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('Generate billing failed', e.message);
      }
    });
  }
}

// ---------------- lembretes D-3 (pré-vencimento) ----------------
async function sendPreReminders(now = new Date()) {
  const base = addDays(now, 3);                // 3 dias antes do vencimento
  const baseStr = isoDate(base);
  const todayStr = isoDate(now);

  const rows = await query(`
    SELECT
      c.id AS contract_id,
      c.company_id,
      c.client_id,
      c.description,
      c.value,
      c.billing_day,
      cl.name  AS client_name,
      cl.phone AS client_phone
    FROM ${SCHEMA}.contracts c
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    WHERE c.start_date <= $1 AND c.end_date >= $1
  `, [baseStr]);

  for (const c of rows.rows) {
    const due = dueDateForMonth(base, c.billing_day);
    const dueStr = isoDate(due);
    if (dueStr !== baseStr) continue;
    if (!c.client_phone) continue;

    // se já existe notificação pre para esse vencimento, pula
    const exists = await query(
      `SELECT 1 FROM ${SCHEMA}.billing_notifications
       WHERE contract_id=$1 AND due_date=$2 AND type='pre' LIMIT 1`,
      [c.contract_id, dueStr]
    );
    if (exists.rowCount) continue;

    // se já foi marcado como pago (há billing do dia pago), pula
    const paid = await query(
      `SELECT 1 FROM ${SCHEMA}.billings
       WHERE contract_id=$1 AND billing_date=$2 AND status='paid' LIMIT 1`,
      [c.contract_id, dueStr]
    );
    if (paid.rowCount) continue;

    try {
      const mesRefDate = new Date(due.getFullYear(), due.getMonth(), 1);
      const text = msgPre({
        nome: c.client_name,
        tipoContrato: c.description,
        mesRefDate,
        vencimentoDate: due,
        valor: c.value,
        pix: process.env.PIX_CHAVE || 'SUA_CHAVE_PIX'
      });

      const number = c.client_phone;
      const evo = await sendTextMessage(Number(c.company_id), { number, text });

      await insertBillingNotification({
        companyId: Number(c.company_id),
        billingId: null,
        contractId: Number(c.contract_id ?? c.id),
        clientId: Number(c.client_id),
        kind: 'auto',
        targetDate: todayStr,
        status: evo.ok ? 'sent' : 'failed',
        provider: 'evo',
        toNumber: number,
        message: text,
        providerStatus: evo.status != null ? String(evo.status) : null,
        providerResponse: evo.data ?? null,
        error: evo.ok ? null : (evo.error || null),
        sentAt: evo.ok ? new Date() : null,
        type: 'pre',
        dueDate: dueStr,
      });

      console.log(`↗ pre D-3 sent c#${c.contract_id || c.id} due=${dueStr}`);
    } catch (e) {
      console.error('D-3 send failed', e.message);
      // ainda assim registra a tentativa (failed)
      await insertBillingNotification({
        companyId: Number(c.company_id),
        billingId: null,
        contractId: Number(c.contract_id ?? c.id),
        clientId: Number(c.client_id),
        kind: 'auto',
        targetDate: todayStr,
        status: 'failed',
        provider: 'evo',
        toNumber: c.client_phone,
        message: '(auto pre) erro ao gerar mensagem',
        providerStatus: null,
        providerResponse: null,
        error: e.message,
        sentAt: null,
        type: 'pre',
        dueDate: dueStr,
      });
    }
  }
}

// ---------------- lembretes D0 (dia do vencimento) ----------------
async function sendDueReminders(now = new Date()) {
  const todayStr = isoDate(now);

  const rows = await query(`
    SELECT
      b.id AS billing_id, b.contract_id, b.amount, b.status,
      c.company_id, c.description,
      cl.id AS client_id, cl.name AS client_name, cl.phone AS client_phone
    FROM ${SCHEMA}.billings b
    JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    WHERE b.billing_date = $1
  `, [todayStr]);

  for (const r of rows.rows) {
    if (!r.client_phone) continue;
    if (String(r.status || '').toLowerCase() === 'paid') continue;

    const exists = await query(
      `SELECT 1 FROM ${SCHEMA}.billing_notifications
       WHERE contract_id=$1 AND due_date=$2 AND type='due' LIMIT 1`,
      [r.contract_id, todayStr]
    );
    if (exists.rowCount) continue;

    try {
      const due = new Date(todayStr);
      const mesRefDate = new Date(due.getFullYear(), due.getMonth(), 1);
      const text = msgDue({
        nome: r.client_name,
        tipoContrato: r.description,
        mesRefDate,
        vencimentoDate: due,
        valor: r.amount,
        pix: process.env.PIX_CHAVE || 'SUA_CHAVE_PIX'
      });

      const evo = await sendTextMessage(Number(r.company_id), { number: r.client_phone, text });

      await insertBillingNotification({
        companyId: Number(r.company_id),
        billingId: Number(r.billing_id),
        contractId: Number(r.contract_id),
        clientId: Number(r.client_id),
        kind: 'auto',
        targetDate: todayStr,
        status: evo.ok ? 'sent' : 'failed',
        provider: 'evo',
        toNumber: r.client_phone,
        message: text,
        providerStatus: evo.status != null ? String(evo.status) : null,
        providerResponse: evo.data ?? null,
        error: evo.ok ? null : (evo.error || null),
        sentAt: evo.ok ? new Date() : null,
        type: 'due',
        dueDate: todayStr,
      });

      console.log(`→ due D0 sent c#${r.contract_id} date=${todayStr}`);
    } catch (e) {
      console.error('D0 send failed', e.message);
      await insertBillingNotification({
        companyId: Number(r.company_id),
        billingId: Number(r.billing_id),
        contractId: Number(r.contract_id),
        clientId: Number(r.client_id),
        kind: 'auto',
        targetDate: todayStr,
        status: 'failed',
        provider: 'evo',
        toNumber: r.client_phone,
        message: '(auto due) erro ao gerar mensagem',
        providerStatus: null,
        providerResponse: null,
        error: e.message,
        sentAt: null,
        type: 'due',
        dueDate: todayStr,
      });
    }
  }
}

// ---------------- lembretes D+4 (atraso) ----------------
async function sendLateReminders(now = new Date()) {
  const target = addDays(now, -4);
  const targetStr = isoDate(target);

  const rows = await query(`
    SELECT
      b.id AS billing_id, b.contract_id, b.amount, b.status, b.billing_date,
      c.company_id, c.description,
      cl.id AS client_id, cl.name AS client_name, cl.phone AS client_phone
    FROM ${SCHEMA}.billings b
    JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
    JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
    WHERE b.billing_date = $1
  `, [targetStr]);

  for (const r of rows.rows) {
    if (!r.client_phone) continue;
    if (String(r.status || '').toLowerCase() === 'paid') continue;

    const exists = await query(
      `SELECT 1 FROM ${SCHEMA}.billing_notifications
       WHERE contract_id=$1 AND due_date=$2 AND type='late' LIMIT 1`,
      [r.contract_id, targetStr]
    );
    if (exists.rowCount) continue;

    try {
      const due = new Date(targetStr);
      const mesRefDate = new Date(due.getFullYear(), due.getMonth(), 1);
      const text = msgLate({
        nome: r.client_name,
        tipoContrato: r.description,
        mesRefDate,
        vencimentoDate: due,
        valor: r.amount,
        pix: process.env.PIX_CHAVE || 'SUA_CHAVE_PIX'
      });

      const evo = await sendTextMessage(Number(r.company_id), { number: r.client_phone, text });

      await insertBillingNotification({
        companyId: Number(r.company_id),
        billingId: Number(r.billing_id),
        contractId: Number(r.contract_id),
        clientId: Number(r.client_id),
        kind: 'auto',
        targetDate: isoDate(now),
        status: evo.ok ? 'sent' : 'failed',
        provider: 'evo',
        toNumber: r.client_phone,
        message: text,
        providerStatus: evo.status != null ? String(evo.status) : null,
        providerResponse: evo.data ?? null,
        error: evo.ok ? null : (evo.error || null),
        sentAt: evo.ok ? new Date() : null,
        type: 'late',
        dueDate: targetStr,
      });

      console.log(`↘ late D+4 sent c#${r.contract_id} date=${targetStr}`);
    } catch (e) {
      console.error('D+4 send failed', e.message);
      await insertBillingNotification({
        companyId: Number(r.company_id),
        billingId: Number(r.billing_id),
        contractId: Number(r.contract_id),
        clientId: Number(r.client_id),
        kind: 'auto',
        targetDate: isoDate(now),
        status: 'failed',
        provider: 'evo',
        toNumber: r.client_phone,
        message: '(auto late) erro ao gerar mensagem',
        providerStatus: null,
        providerResponse: null,
        error: e.message,
        sentAt: null,
        type: 'late',
        dueDate: targetStr,
      });
    }
  }
}

// ---------------- orquestração ----------------
async function runDaily(now = new Date(), opts = {}) {
  const { generate = true, pre = true, due = true, late = true } = opts;
  if (generate) await generateBillingsForToday(now);
  if (pre)      await sendPreReminders(now);
  if (due)      await sendDueReminders(now);
  if (late)     await sendLateReminders(now);
}

module.exports = {
  runDaily,
  generateBillingsForToday,
  sendPreReminders,
  sendDueReminders,
  sendLateReminders,
  effectiveBillingDay,
  dueDateForMonth,
};
