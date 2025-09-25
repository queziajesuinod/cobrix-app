const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { runDaily } = require('../jobs/billing-cron');
const { sendTextMessage } = require('../services/messenger');
const { msgPre, msgDue, msgLate } = require('../services/message-templates');

const router = express.Router();

function validStatus(s){ return ['pending','paid','canceled'].includes(String(s||'').toLowerCase()) }
function pad2(n){ return String(n).padStart(2,'0') }
function isoDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}` }
function monthBounds(ym){
  const [y,m] = ym.split('-').map(Number); 
  const start = new Date(y, m-1, 1);
  const end = new Date(y, m, 1);
  return { y, m, start: isoDate(start), end: isoDate(end) }
}

// LIST with filters (ym / clientId / contractId / status)
router.get('/', requireAuth, companyScope(true), async (req, res) => {
  try {
    const { ym, clientId, contractId, status } = req.query;
    let cond = ['c.company_id = $1']; 
    const params = [req.companyId];

    if (ym && /^\d{4}-\d{2}$/.test(ym)) {
      const { start, end } = monthBounds(ym);
      params.push(start, end);
      cond.push('b.billing_date >= $2 AND b.billing_date < $3');
    }
    if (clientId) { params.push(Number(clientId)); cond.push(`cl.id = $${params.length}`); }
    if (contractId) { params.push(Number(contractId)); cond.push(`c.id = $${params.length}`); }
    if (status && validStatus(status)) { params.push(String(status)); cond.push(`b.status = $${params.length}`); }

    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const r = await query(`
      SELECT b.*, c.description AS contract_description, cl.name AS client_name
      FROM billings b
      JOIN contracts c ON c.id = b.contract_id
      JOIN clients cl ON cl.id = c.client_id
      ${where}
      ORDER BY b.billing_date DESC, b.id DESC
    `, params);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// KPIs for a month
router.get('/kpis', requireAuth, companyScope(true), async (req, res) => {
  try {
    const { ym, clientId, contractId } = req.query;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'ym (YYYY-MM) obrigatório' });
    const { y, m, start, end } = monthBounds(ym);

    let condC = ['c.company_id = $1', 'c.start_date <= $2', 'c.end_date >= $3'];
    let pC = [req.companyId, end, start];
    if (clientId) { pC.push(Number(clientId)); condC.push(`cl.id = $${pC.length}`); }
    if (contractId) { pC.push(Number(contractId)); condC.push(`c.id = $${pC.length}`); }
    const active = await query(`
      SELECT c.id
      FROM contracts c JOIN clients cl ON cl.id = c.client_id
      WHERE ${condC.join(' AND ')}
    `, pC);

    const activeIds = active.rows.map(r => r.id);
    const idsSql = activeIds.length ? `AND b.contract_id = ANY($4)` : '';
    const pB = [req.companyId, start, end];
    if (activeIds.length) pB.push(activeIds);

    const bills = await query(`
      SELECT b.status, COUNT(*)::int AS cnt
      FROM billings b
      JOIN contracts c ON c.id = b.contract_id
      WHERE c.company_id = $1
        AND b.billing_date >= $2 AND b.billing_date < $3
        ${idsSql}
      GROUP BY b.status
    `, pB);

    const cms = await query(`
      SELECT status, COUNT(*)::int AS cnt
      FROM contract_month_status
      WHERE company_id = $1 AND year = $2 AND month = $3
      GROUP BY status
    `, [req.companyId, y, m]);

    const k = {
      contractsActive: activeIds.length,
      monthsPaid: 0, monthsPending: 0, monthsCanceled: 0,
      billingsPaid: 0, billingsPending: 0, billingsCanceled: 0, billingsTotal: 0,
    };
    for (const r of cms.rows) {
      if (r.status === 'paid') k.monthsPaid = r.cnt;
      else if (r.status === 'canceled') k.monthsCanceled = r.cnt;
      else k.monthsPending += r.cnt;
    }
    for (const r of bills.rows) {
      if (r.status === 'paid') k.billingsPaid = r.cnt;
      else if (r.status === 'canceled') k.billingsCanceled = r.cnt;
      else k.billingsPending += r.cnt;
      k.billingsTotal += r.cnt;
    }
    res.json(k);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual notify (PRE/DUE/LATE)
router.post('/notify', requireAuth, companyScope(true), async (req, res) => {
  try {
    const { contract_id, date, type } = req.body || {};
    const typ = String(type || '').toLowerCase();
    if (!['pre','due','late'].includes(typ)) return res.status(400).json({ error: 'type inválido' });
    if (!contract_id || !date) return res.status(400).json({ error: 'contract_id e date são obrigatórios' });

    const c = await query(`
      SELECT c.*, cl.name AS client_name, cl.phone AS client_phone
      FROM contracts c JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = $1 AND c.company_id = $2
    `, [contract_id, req.companyId]);
    const row = c.rows[0];
    if (!row) return res.status(404).json({ error: 'Contrato não encontrado' });

    const due = new Date(date);
    const dueStr = date.slice(0,10);

    const cms = await query(`
      SELECT status FROM contract_month_status
      WHERE contract_id=$1 AND year=$2 AND month=$3
    `, [contract_id, due.getFullYear(), due.getMonth()+1]);
    if (cms.rows[0] && (cms.rows[0].status === 'paid' || cms.rows[0].status === 'canceled')) {
      return res.status(409).json({ error: 'Mês já está PAGO/CANCELADO — notificação bloqueada' });
    }

    if (typ !== 'pre') {
      const b = await query(`SELECT 1 FROM billings WHERE contract_id=$1 AND billing_date=$2 AND status IN ('paid','canceled')`, [contract_id, dueStr]);
      if (b.rowCount) return res.status(409).json({ error: 'Cobrança já está PAGA/CANCELADA — notificação bloqueada' });
    }

    const exists = await query(`SELECT 1 FROM billing_notifications WHERE contract_id=$1 AND due_date=$2 AND type=$3`, [contract_id, dueStr, typ]);
    if (exists.rowCount) return res.status(409).json({ error: 'Notificação já enviada para esse tipo/data' });

    if (!row.client_phone) return res.status(400).json({ error: 'Contrato sem telefone do cliente' });

    const mesRefDate = new Date(due.getFullYear(), due.getMonth(), 1);
    const map = { pre: msgPre, due: msgDue, late: msgLate };
    const text = map[typ]({
      nome: row.client_name,
      tipoContrato: row.description,
      mesRefDate,
      vencimentoDate: due,
      valor: row.value,
      pix: process.env.PIX_CHAVE || 'SUA_CHAVE_PIX'
    });

   await sendTextMessage({ number: row.client_phone, text, companyId: req.companyId })
  await query(`INSERT INTO billing_notifications (contract_id, due_date, type) VALUES ($1,$2,$3)`, [contract_id, dueStr, typ]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id/status', requireAuth, companyScope(true), async (req, res) => {
  const status = String(req.body?.status || '').toLowerCase();
  if (!validStatus(status)) return res.status(400).json({ error: 'status inválido' });
  try {
    const r = await query(`
      UPDATE billings b
      SET status=$1
      FROM contracts c
      WHERE b.id=$2 AND c.id=b.contract_id AND c.company_id=$3
      RETURNING b.id, b.status
    `, [status, req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Cobrança não encontrada' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/notifications', requireAuth, companyScope(true), async (req, res) => {
  try {
    const b = await query(`
      SELECT b.contract_id, b.billing_date, c.company_id
      FROM billings b JOIN contracts c ON c.id = b.contract_id
      WHERE b.id = $1
    `, [req.params.id]);
    const row = b.rows[0];
    if (!row || row.company_id !== req.companyId) return res.status(404).json({ error: 'Cobrança não encontrada' });

    const n = await query(`
      SELECT type, sent_at
      FROM billing_notifications
      WHERE contract_id = $1 AND due_date = $2
      ORDER BY sent_at ASC
    `, [row.contract_id, row.billing_date]);
    res.json(n.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/by-contract/:contractId/month/:year/:month/status', requireAuth, companyScope(true), async (req, res) => {
  const contractId = Number(req.params.contractId);
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const status = String(req.body?.status || '').toLowerCase();
  if (!validStatus(status)) return res.status(400).json({ error: 'status inválido' });
  if (!contractId || !year || !month) return res.status(400).json({ error: 'parâmetros inválidos' });

  try {
    const c = await query(`SELECT id FROM contracts WHERE id=$1 AND company_id=$2`, [contractId, req.companyId]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Contrato não encontrado' });

    await query(`
      INSERT INTO contract_month_status (contract_id, company_id, year, month, status)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (contract_id, year, month) DO UPDATE SET status=EXCLUDED.status, updated_at=now()
    `, [contractId, req.companyId, year, month, status]);

    const r = await query(`
      UPDATE billings b
      SET status = $1
      WHERE b.contract_id = $2
        AND EXTRACT(YEAR FROM b.billing_date) = $3
        AND EXTRACT(MONTH FROM b.billing_date) = $4
      RETURNING b.id
    `, [status, contractId, year, month]);

    res.json({ updated: r.rowCount, ids: r.rows.map(x => x.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/overview', requireAuth, companyScope(true), async (req, res) => {
  const ym = String(req.query.ym || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'Parâmetro ym (YYYY-MM) obrigatório' });
  const [year, month] = ym.split('-').map(Number);
  try {
    const notif = await query(`
      SELECT bn.contract_id, bn.type, COUNT(*) AS cnt, MAX(bn.sent_at) AS last_sent_at
      FROM billing_notifications bn
      JOIN contracts c ON c.id = bn.contract_id
      WHERE c.company_id = $1
        AND EXTRACT(YEAR FROM bn.due_date) = $2
        AND EXTRACT(MONTH FROM bn.due_date) = $3
      GROUP BY bn.contract_id, bn.type
    `, [req.companyId, year, month]);

    const cms = await query(`
      SELECT contract_id, status
      FROM contract_month_status
      WHERE company_id = $1 AND year = $2 AND month = $3
    `, [req.companyId, year, month]);

    const bills = await query(`
      SELECT b.*, c.description AS contract_description, cl.name AS client_name
      FROM billings b
      JOIN contracts c ON c.id = b.contract_id
      JOIN clients cl ON cl.id = c.client_id
      WHERE c.company_id = $1
        AND EXTRACT(YEAR FROM b.billing_date) = $2
        AND EXTRACT(MONTH FROM b.billing_date) = $3
      ORDER BY b.billing_date ASC, b.id ASC
    `, [req.companyId, year, month]);

    const byContract = {};
    for (const r of bills.rows) {
      const key = r.contract_id;
      byContract[key] ??= { contract_id: key, contract_description: r.contract_description, client_name: r.client_name, month_status: 'pending', notifications: {}, billings: [] };
      byContract[key].billings.push(r);
    }
    for (const n of notif.rows) {
      const key = n.contract_id;
      byContract[key] ??= { contract_id: key, contract_description: null, client_name: null, month_status: 'pending', notifications: {}, billings: [] };
      byContract[key].notifications[n.type] = { count: Number(n.cnt), last_sent_at: n.last_sent_at };
    }
    for (const s of cms.rows) {
      const key = s.contract_id;
      byContract[key] ??= { contract_id: key, contract_description: null, client_name: null, month_status: 'pending', notifications: {}, billings: [] };
      byContract[key].month_status = s.status;
    }
    res.json(Object.values(byContract));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/check/run', requireAuth, async (req, res) => {
  try {
    let { date, generate = true, pre = true, due = true, late = true } = (req.body || {});
    let base = new Date();
    if (date) {
      const d = new Date(date);
      if (!isNaN(d)) base = d;
    }
    await runDaily(base, { generate, pre, due, late });
    res.json({ ok: true, ran_for: base.toISOString().slice(0,10), steps: { generate, pre, due, late } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;