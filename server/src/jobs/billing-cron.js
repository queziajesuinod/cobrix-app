const { query, withClient } = require('../db');
const { sendTextMessage } = require('../services/messenger');
const { msgPre, msgDue, msgLate } = require('../services/message-templates');

function pad2(n){ return String(n).padStart(2,'0'); }
function isoDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

function effectiveBillingDay(date, billingDay) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const lastDay = new Date(y, m+1, 0).getDate();
  return Math.min(Number(billingDay), lastDay);
}
function dueDateForMonth(baseDate, billingDay) {
  const y = baseDate.getFullYear();
  const m = baseDate.getMonth();
  const eff = effectiveBillingDay(baseDate, billingDay);
  return new Date(y, m, eff);
}

async function generateBillingsForToday(now = new Date()) {
  const todayStr = isoDate(now);
  const day = now.getDate();

  const contracts = await query(`
    SELECT c.*, cl.name AS client_name, cl.phone AS client_phone
    FROM contracts c
    JOIN clients cl ON cl.id = c.client_id
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
          `INSERT INTO billings (contract_id, billing_date, amount, status)
           VALUES ($1,$2,$3,'pending')
           ON CONFLICT (contract_id, billing_date) DO NOTHING`,
          [c.id, todayStr, c.value]
        );
        await client.query('UPDATE contracts SET last_billed_date=$1 WHERE id=$2', [todayStr, c.id]);
        await client.query('COMMIT');
        console.log(`✔ Billing c#${c.id} ${todayStr} valor=${c.value}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('Generate billing failed', e.message);
      }
    });
  }
}

async function sendPreReminders(now = new Date()) {
  const base = addDays(now, 3);
  const baseStr = isoDate(base);

  const rows = await query(`
    SELECT c.id AS contract_id, c.description, c.value, c.billing_day,
           cl.name AS client_name, cl.phone AS client_phone
    FROM contracts c
    JOIN clients cl ON cl.id = c.client_id
    WHERE c.start_date <= $1 AND c.end_date >= $1
  `, [baseStr]);

  for (const c of rows.rows) {
    const due = dueDateForMonth(base, c.billing_day);
    const dueStr = isoDate(due);
    if (dueStr != baseStr) continue;
    if (!c.client_phone) continue;

    const exists = await query(
      `SELECT 1 FROM billing_notifications WHERE contract_id=$1 AND due_date=$2 AND type='pre'`,
      [c.contract_id, dueStr]
    );
    if (exists.rowCount) continue;

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
      await sendTextMessage({ number, text, companyId: contrato.company_id })
      await query(
        `INSERT INTO billing_notifications (contract_id, due_date, type) VALUES ($1,$2,'pre')`,
        [c.contract_id, dueStr]
      );
      console.log(`↗ pre D-3 sent c#${c.contract_id} due=${dueStr}`);
    } catch (e) {
      console.error('D-3 send failed', e.message);
    }
  }
}

async function sendDueReminders(now = new Date()) {
  const todayStr = isoDate(now);
  const rows = await query(`
    SELECT b.id AS billing_id, b.contract_id, b.amount, b.status,
           c.description, cl.name AS client_name, cl.phone AS client_phone
    FROM billings b
    JOIN contracts c ON c.id = b.contract_id
    JOIN clients cl ON cl.id = c.client_id
    WHERE b.billing_date = $1
  `, [todayStr]);

  for (const r of rows.rows) {
    if (!r.client_phone) continue;
    const exists = await query(
      `SELECT 1 FROM billing_notifications WHERE contract_id=$1 AND due_date=$2 AND type='due'`,
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
await sendTextMessage({ number, text, companyId: contrato.company_id })

      await query(`INSERT INTO billing_notifications (contract_id, due_date, type) VALUES ($1,$2,'due')`, [r.contract_id, todayStr]);
      console.log(`→ due D0 sent c#${r.contract_id} date=${todayStr}`);
    } catch (e) {
      console.error('D0 send failed', e.message);
    }
  }
}

async function sendLateReminders(now = new Date()) {
  const target = addDays(now, -4);
  const targetStr = isoDate(target);

  const rows = await query(`
    SELECT b.id AS billing_id, b.contract_id, b.amount, b.status, b.billing_date,
           c.description, cl.name AS client_name, cl.phone AS client_phone
    FROM billings b
    JOIN contracts c ON c.id = b.contract_id
    JOIN clients cl ON cl.id = c.client_id
    WHERE b.billing_date = $1
  `, [targetStr]);

  for (const r of rows.rows) {
    if (String(r.status || '').toLowerCase() === 'paid') continue;
    if (!r.client_phone) continue;

    const exists = await query(
      `SELECT 1 FROM billing_notifications WHERE contract_id=$1 AND due_date=$2 AND type='late'`,
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
      await sendTextMessage({ number, text, companyId: contrato.company_id })

      await query(`INSERT INTO billing_notifications (contract_id, due_date, type) VALUES ($1,$2,'late')`, [r.contract_id, targetStr]);
      console.log(`↘ late D+4 sent c#${r.contract_id} date=${targetStr}`);
    } catch (e) {
      console.error('D+4 send failed', e.message);
    }
  }
}

async function runDaily(now = new Date(), opts = {}) {
  const { generate = true, pre = true, due = true, late = true } = opts;
  if (generate) await generateBillingsForToday(now);
  if (pre)      await sendPreReminders(now);
  if (due)      await sendDueReminders(now);
  if (late)     await sendLateReminders(now);
}

module.exports = { runDaily, generateBillingsForToday, sendPreReminders, sendDueReminders, sendLateReminders, effectiveBillingDay: dueDateForMonth };