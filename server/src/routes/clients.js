const express = require('express');
const { query } = require('../db');
const { z } = require('zod');
const { requireAuth, companyScope } = require('./auth');

const router = express.Router();

const clientSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(8).max(30).optional().nullable(),
  responsavel: z.string().trim().min(2)
});

router.get('/', requireAuth, companyScope(true), async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
  const q = (req.query.q || '').trim();
  const offset = (page - 1) * pageSize;

  const params = [req.companyId];
  let where = 'WHERE company_id=$1';
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR responsavel ILIKE $${params.length})`;
  }

  try {
    const count = await query(`SELECT COUNT(*)::int AS total FROM clients ${where}`, params);
    params.push(pageSize, offset);
    const rows = await query(`SELECT * FROM clients ${where} ORDER BY name LIMIT $${params.length-1} OFFSET $${params.length}`, params);
    res.json({ page, pageSize, total: count.rows[0].total, data: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requireAuth, companyScope(true), async (req, res) => {
  try {
    const r = await query(`SELECT * FROM clients WHERE id=$1 AND company_id=$2`, [req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, companyScope(true), async (req, res) => {
  const parse = clientSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { name, email, phone, responsavel } = parse.data;
  try {
    const r = await query(`
      INSERT INTO clients (company_id, name, email, phone, responsavel)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [req.companyId, name, email || null, phone || null, responsavel || null]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, companyScope(true), async (req, res) => {
  const parse = clientSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { name, email, phone, responsavel } = parse.data;
  try {
    const r = await query(`
      UPDATE clients SET name=$1, email=$2, phone=$3, responsavel=$4
      WHERE id=$5 AND company_id=$6 RETURNING *
    `, [name, email || null, phone || null, responsavel || null, req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, companyScope(true), async (req, res) => {
  try {
    const cnt = await query('SELECT COUNT(*)::int AS c FROM contracts WHERE client_id=$1 AND company_id=$2', [req.params.id, req.companyId]);
    if (cnt.rows[0].c > 0) return res.status(400).json({ error: 'Não é possível excluir cliente com contratos associados' });
    const r = await query('DELETE FROM clients WHERE id=$1 AND company_id=$2', [req.params.id, req.companyId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
