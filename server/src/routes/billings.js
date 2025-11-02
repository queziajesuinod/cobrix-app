const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { runDaily } = require('../jobs/billing-cron');
const { sendWhatsapp } = require('../services/messenger');
const { msgPre, msgDue, msgLate } = require('../services/message-templates');

const router = express.Router();
const SCHEMA = process.env.DB_SCHEMA || 'public';

function validStatus(s) { return ['pending', 'paid', 'canceled'].includes(String(s || '').toLowerCase()); }
function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  return { y, m, start: isoDate(start), end: isoDate(end) };
}

// NEW: parse "YYYY-MM-DD" as local date to avoid timezone shift
function parseDateIsoLocal(s) {
  if (!s) return null;
  const raw = String(s).slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    const d = new Date(s);
    if (isNaN(d)) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  return new Date(y, mo - 1, da);
}

// helper para inserir na billing_notifications (todas colunas)
async function insertBillingNotification({
  companyId,
  billingId = null,
  contractId = null,
  clientId = null,
  kind = 'manual',               // 'manual' ou 'auto'
  targetDate,                    // 'YYYY-MM-DD'
  status = 'queued',             // 'queued' | 'sent' | 'failed' | 'skipped'
  provider = 'evo',
  toNumber = null,
  message = '',
  providerStatus = null,
  providerResponse = null,       // objeto -> jsonb
  error = null,
  sentAt = null,                 // Date | null
  type,                          // 'pre' | 'due' | 'late' | 'manual'
  dueDate                        // 'YYYY-MM-DD'
}) {
  const sql = `
    INSERT INTO ${SCHEMA}.billing_notifications
      (company_id, billing_id, contract_id, client_id, kind, target_date,
       status, provider, to_number, message, provider_status, provider_response,
       error, created_at, sent_at, type, due_date)
    VALUES
      ($1,$2,$3,$4,$5,$6,
       $7,$8,$9,$10,$11,$12,
       $13, NOW(), $14, $15, $16)
    RETURNING id
  `;
  const params = [
    Number(companyId),
    billingId != null ? Number(billingId) : null,
    contractId != null ? Number(contractId) : null,
    clientId != null ? Number(clientId) : null,
    String(kind),
    String(targetDate),
    String(status),
    String(provider),
    toNumber != null ? String(toNumber) : null,
    message != null ? String(message) : '',
    providerStatus != null ? String(providerStatus) : null,
    providerResponse ?? null,
    error != null ? String(error) : null,
    sentAt ?? null,
    String(type),
    String(dueDate),
  ];
  const r = await query(sql, params);
  return r.rows[0].id;
}

// LIST com filtros
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
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
      ${where}
      ORDER BY b.billing_date DESC, b.id DESC
    `, params);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// KPIs do mês
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
      FROM ${SCHEMA}.contracts c JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE ${condC.join(' AND ')}
    `, pC);

    const activeIds = active.rows.map(r => r.id);
    const idsSql = activeIds.length ? `AND b.contract_id = ANY($4::int[])` : '';
    const pB = [req.companyId, start, end];
    if (activeIds.length) pB.push(activeIds);

    const bills = await query(`
      SELECT b.status, COUNT(*)::int AS cnt
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      WHERE c.company_id = $1
        AND b.billing_date >= $2 AND b.billing_date < $3
        ${idsSql}
      GROUP BY b.status
    `, pB);

    const cms = await query(`
      SELECT status, COUNT(*)::int AS cnt
      FROM ${SCHEMA}.contract_month_status
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

// Notificação MANUAL (pre/due/late)
router.post('/notify', requireAuth, companyScope(true), async (req, res) => {
  try {
    const { contract_id, date, type } = req.body || {};
    const typ = String(type || '').toLowerCase();
    if (!['pre', 'due', 'late'].includes(typ)) return res.status(400).json({ error: 'type inválido' });
    if (!contract_id || !date) return res.status(400).json({ error: 'contract_id e date são obrigatórios' });

    const c = await query(`
      SELECT c.*, cl.name AS client_name, cl.phone AS client_phone, cl.responsavel AS client_responsavel
      FROM ${SCHEMA}.contracts c
      JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
      WHERE c.id = $1 AND c.company_id = $2
    `, [contract_id, req.companyId]);
    const row = c.rows[0];
    if (!row) return res.status(404).json({ error: 'Contrato não encontrado' });

    // parse de date como local para evitar shift de timezone
    const baseDate = new Date(); // mês atual
    const dueDay = row.billing_day || 1; // default 1 se não tiver
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth(); // mês atual (0-11)

    // evita erro se o mês tiver menos dias (ex: dia 30 em fevereiro)
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(dueDay, lastDay);

    // 🔹 Cria a data final de vencimento
    const due = new Date(year, month, day);
    if (!due) return res.status(400).json({ error: 'date inválida' });
    const dueStr = isoDate(due);

    // se mês já pago/cancelado, bloqueia
    const cms = await query(`
      SELECT status FROM ${SCHEMA}.contract_month_status
      WHERE contract_id=$1 AND year=$2 AND month=$3
    `, [contract_id, due.getFullYear(), due.getMonth() + 1]);
    if (cms.rows[0] && (cms.rows[0].status === 'paid' || cms.rows[0].status === 'canceled')) {
      return res.status(409).json({ error: 'Mês já está PAGO/CANCELADO — notificação bloqueada' });
    }

    // se for due/late, não envia se já houver billing pago/cancelado
    if (typ !== 'pre') {
      const b = await query(`
        SELECT 1 FROM ${SCHEMA}.billings
        WHERE contract_id=$1 AND billing_date=$2 AND status IN ('paid','canceled') LIMIT 1
      `, [contract_id, dueStr]);
      if (b.rowCount) return res.status(409).json({ error: 'Cobrança já está PAGA/CANCELADA — notificação bloqueada' });
    }

    // usa advisory lock por contrato para evitar race conditions
    await query('SELECT pg_advisory_lock($1)', [Number(contract_id)]);
    try {
      // checa existência novamente dentro da lock
      const exists2 = await query(`
        SELECT 1 FROM ${SCHEMA}.billing_notifications
        WHERE contract_id=$1 AND due_date=$2 AND type=$3 LIMIT 1
      `, [contract_id, dueStr, typ]);
      if (exists2.rowCount) {
        return res.status(409).json({ error: 'Notificação já enviada para esse tipo/data' });
      }

      if (!row.client_phone) return res.status(400).json({ error: 'Contrato sem telefone do cliente' });

      const mesRefDate = new Date(due.getFullYear(), due.getMonth(), 1);
      const map = { pre: msgPre, due: msgDue, late: msgLate };
      const recipientName = row.client_responsavel || row.client_name;
      const text = await map[typ]({
        nome: recipientName,
        responsavel: row.client_responsavel,
        client_name: row.client_name,
        tipoContrato: row.description,
        mesRefDate,
        vencimentoDate: due,
        valor: row.value,
        companyId: req.companyId,
      });

      // envia via EVO com config da empresa
      const evo = await sendWhatsapp(req.companyId, { number: row.client_phone, text });

      // registra completo
      await insertBillingNotification({
        companyId: req.companyId,
        billingId: null,                         // manual direto, sem billing atrelado
        contractId: Number(contract_id),
        clientId: Number(row.client_id),
        kind: 'manual',
        targetDate: isoDate(new Date()),
        status: evo.ok ? 'sent' : 'failed',
        provider: 'evo',
        toNumber: row.client_phone,
        message: text,
        providerStatus: evo.status != null ? String(evo.status) : null,
        providerResponse: evo.data ?? null,
        error: evo.ok ? null : (evo.error || null),
        sentAt: evo.ok ? new Date() : null,
        type: typ,
        dueDate: dueStr,
      });

      res.json({ ok: true, provider: { ok: evo.ok, status: evo.status, data: evo.data } });
    } finally {
      // libera sempre o advisory lock
      try {
        await query('SELECT pg_advisory_unlock($1)', [Number(contract_id)]);
      } catch (unlockErr) {
        console.warn('unlock failed', unlockErr);
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Atualiza status da cobrança
router.put('/:id/status', requireAuth, companyScope(true), async (req, res) => {
  const status = String(req.body?.status || '').toLowerCase();
  if (!validStatus(status)) return res.status(400).json({ error: 'status inválido' });
  try {
    const r = await query(`
      UPDATE ${SCHEMA}.billings b
      SET status=$1
      FROM ${SCHEMA}.contracts c
      WHERE b.id=$2 AND c.id=b.contract_id AND c.company_id=$3
      RETURNING b.id, b.status
    `, [status, req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Cobrança não encontrada' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Histórico de notificações de uma cobrança
router.get('/:id/notifications', requireAuth, companyScope(true), async (req, res) => {
  try {
    const b = await query(`
      SELECT b.contract_id, b.billing_date, c.company_id
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      WHERE b.id = $1
    `, [req.params.id]);
    const row = b.rows[0];
    if (!row || Number(row.company_id) !== Number(req.companyId)) {
      return res.status(404).json({ error: 'Cobrança não encontrada' });
    }

    const n = await query(`
      SELECT type, sent_at
      FROM ${SCHEMA}.billing_notifications
      WHERE contract_id = $1 AND due_date = $2
      ORDER BY sent_at ASC
    `, [row.contract_id, row.billing_date]);
    res.json(n.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marca status do mês por contrato (sincroniza billings do mês)
router.put('/by-contract/:contractId/month/:year/:month/status', requireAuth, companyScope(true), async (req, res) => {
  const contractId = Number(req.params.contractId);
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const status = String(req.body?.status || '').toLowerCase();
  if (!validStatus(status)) return res.status(400).json({ error: 'status inválido' });
  if (!contractId || !year || !month) return res.status(400).json({ error: 'parâmetros inválidos' });

  try {
    const c = await query(`SELECT id FROM ${SCHEMA}.contracts WHERE id=$1 AND company_id=$2`, [contractId, req.companyId]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Contrato não encontrado' });

    await query(`
      INSERT INTO ${SCHEMA}.contract_month_status (contract_id, company_id, year, month, status)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (contract_id, year, month)
      DO UPDATE SET status=EXCLUDED.status, updated_at=now()
    `, [contractId, req.companyId, year, month, status]);

    const r = await query(`
      UPDATE ${SCHEMA}.billings b
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

// Visão agrupada do mês (para o front) — somente contratos com month_status diferente de 'paid'
router.get('/overview', requireAuth, companyScope(true), async (req, res) => {
  const ym = String(req.query.ym || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'Parâmetro ym (YYYY-MM) obrigatório' });
  const [year, month] = ym.split('-').map(Number);
  const clientIdRaw = req.query.clientId;
  const contractIdRaw = req.query.contractId;
  const clientId = clientIdRaw ? Number(clientIdRaw) : null;
  const contractId = contractIdRaw ? Number(contractIdRaw) : null;
  if (clientIdRaw && (clientId == null || Number.isNaN(clientId))) return res.status(400).json({ error: 'clientId inválido' });
  if (contractIdRaw && (contractId == null || Number.isNaN(contractId))) return res.status(400).json({ error: 'contractId inválido' });
  try {
    const notif = await query(`
      SELECT bn.contract_id, bn.type, COUNT(*) AS cnt, MAX(bn.sent_at) AS last_sent_at,
             c.client_id, c.description AS contract_description, cl.name AS client_name
      FROM ${SCHEMA}.billing_notifications bn
      JOIN ${SCHEMA}.contracts c ON c.id = bn.contract_id
      JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE c.company_id = $1
        AND EXTRACT(YEAR FROM bn.due_date) = $2
        AND EXTRACT(MONTH FROM bn.due_date) = $3
        AND ($4::int IS NULL OR c.client_id = $4)
        AND ($5::int IS NULL OR c.id = $5)
        AND NOT EXISTS (
          SELECT 1 FROM ${SCHEMA}.contract_month_status cms2
          WHERE cms2.contract_id = bn.contract_id AND cms2.year = $2 AND cms2.month = $3 AND cms2.status = 'paid'
        )
      GROUP BY bn.contract_id, bn.type, c.client_id, c.description, cl.name
    `, [req.companyId, year, month, clientId, contractId]);

    const cms = await query(`
      SELECT cms.contract_id, cms.status, c.client_id, c.description AS contract_description, cl.name AS client_name
      FROM ${SCHEMA}.contract_month_status cms
      JOIN ${SCHEMA}.contracts c ON c.id = cms.contract_id
      JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE cms.company_id = $1 AND cms.year = $2 AND cms.month = $3
        AND cms.status <> 'paid'
        AND ($4::int IS NULL OR c.client_id = $4)
        AND ($5::int IS NULL OR c.id = $5)
    `, [req.companyId, year, month, clientId, contractId]);

    const bills = await query(`
      SELECT b.*, c.description AS contract_description, c.client_id AS contract_client_id, cl.name AS client_name
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
      WHERE c.company_id = $1
        AND EXTRACT(YEAR FROM b.billing_date) = $2
        AND EXTRACT(MONTH FROM b.billing_date) = $3
        AND ($4::int IS NULL OR cl.id = $4)
        AND ($5::int IS NULL OR c.id = $5)
        AND NOT EXISTS (
          SELECT 1 FROM ${SCHEMA}.contract_month_status cms2
          WHERE cms2.contract_id = c.id AND cms2.year = $2 AND cms2.month = $3 AND cms2.status = 'paid'
        )
      ORDER BY b.billing_date ASC, b.id ASC
    `, [req.companyId, year, month, clientId, contractId]);

    const byContract = {};
    for (const r of bills.rows) {
      const key = r.contract_id;
      const entry = byContract[key] ?? {
        contract_id: key,
        contract_description: null,
        client_name: null,
        client_id: null,
        month_status: 'pending',
        notifications: {},
        billings: []
      };
      entry.contract_description ??= r.contract_description;
      entry.client_name ??= r.client_name;
      entry.client_id ??= r.contract_client_id != null ? Number(r.contract_client_id) : entry.client_id;
      entry.billings.push(r);
      byContract[key] = entry;
    }
    for (const n of notif.rows) {
      const key = n.contract_id;
      const entry = byContract[key] ?? { contract_id: key, contract_description: null, client_name: null, client_id: null, month_status: 'pending', notifications: {}, billings: [] };
      entry.contract_description ??= n.contract_description || entry.contract_description;
      entry.client_name ??= n.client_name || entry.client_name;
      entry.client_id ??= n.client_id != null ? Number(n.client_id) : entry.client_id;
      entry.notifications[n.type] = { count: Number(n.cnt), last_sent_at: n.last_sent_at };
      byContract[key] = entry;
    }
    for (const s of cms.rows) {
      const key = s.contract_id;
      const entry = byContract[key] ?? { contract_id: key, contract_description: null, client_name: null, client_id: null, month_status: 'pending', notifications: {}, billings: [] };
      entry.month_status = s.status;
      entry.contract_description ??= s.contract_description || entry.contract_description;
      entry.client_name ??= s.client_name || entry.client_name;
      entry.client_id ??= s.client_id != null ? Number(s.client_id) : entry.client_id;
      byContract[key] = entry;
    }
    res.json(Object.values(byContract));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rodar pipeline (manual)
router.post('/check/run', requireAuth, async (req, res) => {
  try {
    let { date, generate = true, pre = true, due = true, late = true } = (req.body || {});
    let base = new Date(date);
    await runDaily(base, { generate, pre, due, late });
    res.json({ ok: true, ran_for: base.toISOString().slice(0, 10), steps: { generate, pre, due, late } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
