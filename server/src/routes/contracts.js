const express = require('express');
const { query } = require('../db');
const { z } = require('zod');
const { requireAuth, companyScope } = require('./auth');
const { assertContractLimit } = require('../utils/company-limits');

const router = express.Router();
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_BILLING_INTERVALS = [1, 3, 12];

const SCHEMA = process.env.DB_SCHEMA || 'public';

const normalizeDateInput = (value) => {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  return value;
};

const dateField = z.preprocess(
  normalizeDateInput,
  z.string().regex(DATE_ISO)
);

const optionalDateField = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') return null;
    return normalizeDateInput(value);
  },
  z.nullable(z.string().regex(DATE_ISO))
);

const billingIntervalField = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') return 1;
    const numeric = Number(value);
    return Number.isNaN(numeric) ? value : numeric;
  },
  z.number().int().positive()
).refine((val) => ALLOWED_BILLING_INTERVALS.includes(val), {
  message: 'billing_interval_months deve ser 1 (mensal), 3 (trimestral) ou 12 (anual)'
});

async function ensureUniqueContractDescription(companyId, clientId, description, ignoreId) {
  const normalizedDescription = String(description || '').trim();
  if (!normalizedDescription) return;
  const params = [companyId, clientId, normalizedDescription];
  let sql = `
    SELECT 1 FROM ${SCHEMA}.contracts
     WHERE company_id=$1
       AND client_id=$2
       AND LOWER(TRIM(description)) = LOWER(TRIM($3))
  `;
  if (ignoreId) {
    params.push(ignoreId);
    sql += ' AND id <> $4';
  }
  const exists = await query(sql, params);
  if (exists.rowCount) {
    const err = new Error('Já existe um contrato com esta descrição para este cliente');
    err.status = 409;
    throw err;
  }
}

const contractSchema = z.object({
  client_id: z.number().int().positive(),
  contract_type_id: z.number().int().positive(),
  description: z.string().min(3),
  value: z.number().nonnegative(),
  start_date: dateField,
  end_date: dateField,
  billing_day: z.number().int().min(1).max(31),
  billing_interval_months: billingIntervalField,
  cancellation_date: optionalDateField.optional()
});

router.get('/', requireAuth, companyScope(true), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = (page - 1) * pageSize;

    // ym=YYYY-MM (se não vier, usa mês atual)
    const ym = String(req.query.ym || '').trim();
  const baseDate = ym && /^\d{4}-\d{2}$/.test(ym) ? new Date(`${ym}-01`) : new Date();
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;
  const clientIdRaw = req.query.clientId;
  const clientId = clientIdRaw != null && clientIdRaw !== '' ? Number(clientIdRaw) : null;
  const contractTypeRaw = req.query.contractTypeId;
  const contractTypeId = contractTypeRaw != null && contractTypeRaw !== '' ? Number(contractTypeRaw) : null;
  if (clientIdRaw && (clientId == null || Number.isNaN(clientId))) {
    return res.status(400).json({ error: 'clientId inválido' });
  }
  if (contractTypeRaw && (contractTypeId == null || Number.isNaN(contractTypeId))) {
    return res.status(400).json({ error: 'contractTypeId inválido' });
  }
  const q = String(req.query.q || '').trim();

  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  // FROM com LEFT JOIN em contract_month_status (limitado ao mês/ano)
    const fromSql = `
      FROM ${SCHEMA}.contracts c
      LEFT JOIN ${SCHEMA}.contract_month_status cms
        ON cms.contract_id = c.id
       AND cms.year = ${add(year)}
       AND cms.month = ${add(month)}
      JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      LEFT JOIN ${SCHEMA}.contract_types ct ON ct.id = c.contract_type_id
    `;

    // WHERE (sempre dentro da empresa)
    const filters = [];
    filters.push(`c.company_id = ${add(req.companyId)}`);
    const statusFilter = String(req.query.status || 'active').toLowerCase();
    if (statusFilter === 'inactive') {
      filters.push('c.active = false');
    } else if (statusFilter !== 'all') {
      filters.push('c.active = true');
    }

    // Contratos ativos na data (se active_on vier)
    if (req.query.active_on) {
      const activeOn = add(req.query.active_on);
      filters.push(`DATE(c.start_date) <= DATE(${activeOn}) AND DATE(c.end_date) >= DATE(${activeOn}) AND (c.cancellation_date IS NULL OR DATE(c.cancellation_date) >= DATE(${activeOn}))`);
    }

    if (clientId) {
      filters.push(`c.client_id = ${add(clientId)}`);
    }
    if (contractTypeId) {
      filters.push(`c.contract_type_id = ${add(contractTypeId)}`);
    }

    if (q) {
      const like = `%${q}%`;
      filters.push(`(c.description ILIKE ${add(like)} OR cl.name ILIKE ${add(like)})`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    // 1) COUNT com os MESMOS JOINs/WHERE
    const countSql = `SELECT COUNT(*)::int AS total ${fromSql} ${whereSql}`;
    const count = await query(countSql, params);

    // 2) LISTAGEM
    const listParams = params.slice(); // reaproveita a mesma sequência de parâmetros
    listParams.push(pageSize, offset);
    const limitPos = `$${listParams.length - 1}`;
    const offsetPos = `$${listParams.length}`;

    const listSql = `
      SELECT c.*,
             cl.name  AS client_name,
             cl.email AS client_email,
             cl.responsavel AS client_responsavel,
             ct.name AS contract_type_name,
             ct.is_recurring,
             ct.adjustment_percent,
             cms.status AS month_status,
             cms.year, cms.month
      ${fromSql}
      ${whereSql}
      ORDER BY c.start_date DESC
      LIMIT ${limitPos} OFFSET ${offsetPos}
    `;
    const rows = await query(listSql, listParams);

    res.json({
      page,
      pageSize,
      total: count.rows[0].total,
      data: rows.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requireAuth, companyScope(true), async (req, res) => {
  try {
    await ensureUniqueContractDescription(req.companyId, client_id, description, req.params.id);
    const r = await query(`
      SELECT c.*, cl.name as client_name, cl.email as client_email
      FROM contracts c
      JOIN clients cl ON c.client_id = cl.id
      WHERE c.id=$1 AND c.company_id=$2 
    `, [req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Contrato não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, companyScope(true), async (req, res) => {
  const parse = contractSchema.safeParse({
    ...req.body,
    client_id: Number(req.body.client_id),
    value: Number(req.body.value),
    billing_day: Number(req.body.billing_day),
    billing_interval_months: req.body.billing_interval_months
  });
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { client_id, contract_type_id, description, value, start_date, end_date, billing_day, billing_interval_months, cancellation_date } = parse.data;
  if (new Date(start_date) >= new Date(end_date)) return res.status(400).json({ error: 'Data de início deve ser anterior à data de fim' });
  if (cancellation_date) {
    const cancelDt = new Date(cancellation_date);
    if (cancelDt < new Date(start_date)) return res.status(400).json({ error: 'Data de cancelamento não pode ser anterior ao início' });
    if (cancelDt > new Date(end_date)) return res.status(400).json({ error: 'Data de cancelamento não pode ser após o fim' });
  }

  try {
    const hasClient = await query('SELECT id FROM clients WHERE id=$1 AND company_id=$2', [client_id, req.companyId]);
    if (!hasClient.rows[0]) return res.status(400).json({ error: 'Cliente não encontrado nesta empresa' });

    const typeExists = await query(`SELECT id FROM ${SCHEMA}.contract_types WHERE id=$1`, [contract_type_id]);
    if (!typeExists.rows[0]) return res.status(400).json({ error: 'Tipo de contrato inválido' });

    await ensureUniqueContractDescription(req.companyId, client_id, description, null);
    await assertContractLimit(req.companyId);
    const r = await query(`
      INSERT INTO contracts (company_id, client_id, contract_type_id, description, value, start_date, end_date, billing_day, billing_interval_months, cancellation_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [req.companyId, client_id, contract_type_id, description, value, start_date, end_date, billing_day, billing_interval_months, cancellation_date]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, companyScope(true), async (req, res) => {
  const parse = contractSchema.safeParse({
    ...req.body,
    client_id: Number(req.body.client_id),
    value: Number(req.body.value),
    billing_day: Number(req.body.billing_day),
    billing_interval_months: req.body.billing_interval_months
  });
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { client_id, contract_type_id, description, value, start_date, end_date, billing_day, billing_interval_months, cancellation_date } = parse.data;
  if (new Date(start_date) >= new Date(end_date)) return res.status(400).json({ error: 'Data de início deve ser anterior à data de fim' });
  if (cancellation_date) {
    const cancelDt = new Date(cancellation_date);
    if (cancelDt < new Date(start_date)) return res.status(400).json({ error: 'Data de cancelamento não pode ser anterior ao início' });
    if (cancelDt > new Date(end_date)) return res.status(400).json({ error: 'Data de cancelamento não pode ser após o fim' });
  }

  try {
    const hasClient = await query('SELECT id FROM clients WHERE id=$1 AND company_id=$2', [client_id, req.companyId]);
    if (!hasClient.rows[0]) return res.status(400).json({ error: 'Cliente não encontrado nesta empresa' });

    const typeExists = await query(`SELECT id FROM ${SCHEMA}.contract_types WHERE id=$1`, [contract_type_id]);
    if (!typeExists.rows[0]) return res.status(400).json({ error: 'Tipo de contrato inválido' });

    const r = await query(`
      UPDATE contracts
      SET client_id=$1, contract_type_id=$2, description=$3, value=$4, start_date=$5, end_date=$6, billing_day=$7, billing_interval_months=$8, cancellation_date=$9
      WHERE id=$10 AND company_id=$11 RETURNING *
    `, [client_id, contract_type_id, description, value, start_date, end_date, billing_day, billing_interval_months, cancellation_date, req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Contrato não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', requireAuth, companyScope(true), async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Campo active obrigatorio' });
  try {
    if (active) await assertContractLimit(req.companyId);
    const r = await query('UPDATE contracts SET active=$1 WHERE id=$2 AND company_id=$3 RETURNING *', [active, req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Contrato nao encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, companyScope(true), async (req, res) => {
  try {
    const r = await query('UPDATE contracts SET active=false WHERE id=$1 AND company_id=$2 RETURNING *', [req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Contrato nao encontrado' });
    res.json({ ok: true, active: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



