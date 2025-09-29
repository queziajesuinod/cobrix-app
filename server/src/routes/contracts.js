const express = require('express');
const { query } = require('../db');
const { z } = require('zod');
const { requireAuth, companyScope } = require('./auth');

const router = express.Router();
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

const SCHEMA = process.env.DB_SCHEMA || 'public';

const contractSchema = z.object({
  client_id: z.number().int().positive(),
  description: z.string().min(3),
  value: z.number().nonnegative(),
  start_date: z.string().regex(DATE_ISO),
  end_date: z.string().regex(DATE_ISO),
  billing_day: z.number().int().min(1).max(31)
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
    `;

    // WHERE (sempre dentro da empresa)
    const filters = [];
    filters.push(`c.company_id = ${add(req.companyId)}`);

    // Contratos ativos na data (se active_on vier)
    if (req.query.active_on) {
      const activeOn = add(req.query.active_on);
      filters.push(`DATE(c.start_date) <= DATE(${activeOn}) AND DATE(c.end_date) >= DATE(${activeOn})`);
    }

    // "não pago" no mês-alvo: inclui NULL (sem registro) e qualquer status ≠ 'paid'
    filters.push(`(cms.status IS NULL OR cms.status <> 'paid')`);

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
    billing_day: Number(req.body.billing_day)
  });
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { client_id, description, value, start_date, end_date, billing_day } = parse.data;
  if (new Date(start_date) >= new Date(end_date)) return res.status(400).json({ error: 'Data de início deve ser anterior à data de fim' });

  try {
    const hasClient = await query('SELECT id FROM clients WHERE id=$1 AND company_id=$2', [client_id, req.companyId]);
    if (!hasClient.rows[0]) return res.status(400).json({ error: 'Cliente não encontrado nesta empresa' });

    const r = await query(`
      INSERT INTO contracts (company_id, client_id, description, value, start_date, end_date, billing_day)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [req.companyId, client_id, description, value, start_date, end_date, billing_day]);
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
    billing_day: Number(req.body.billing_day)
  });
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { client_id, description, value, start_date, end_date, billing_day } = parse.data;
  if (new Date(start_date) >= new Date(end_date)) return res.status(400).json({ error: 'Data de início deve ser anterior à data de fim' });

  try {
    const hasClient = await query('SELECT id FROM clients WHERE id=$1 AND company_id=$2', [client_id, req.companyId]);
    if (!hasClient.rows[0]) return res.status(400).json({ error: 'Cliente não encontrado nesta empresa' });

    const r = await query(`
      UPDATE contracts
      SET client_id=$1, description=$2, value=$3, start_date=$4, end_date=$5, billing_day=$6
      WHERE id=$7 AND company_id=$8 RETURNING *
    `, [client_id, description, value, start_date, end_date, billing_day, req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Contrato não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, companyScope(true), async (req, res) => {
  try {
    const r = await query('DELETE FROM contracts WHERE id=$1 AND company_id=$2', [req.params.id, req.companyId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Contrato não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
