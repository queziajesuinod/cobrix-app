const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('./auth');
const { z } = require('zod');

const router = express.Router();

// LIST
router.get('/companies', requireAuth, async (req, res) => {
  if (req.user.role !== 'master') return res.status(403).json({ error: 'Apenas master' });
  try {
    const r = await query('SELECT id, name, email FROM companies ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// CREATE
router.post('/companies', requireAuth, async (req, res) => {
  if (req.user.role !== 'master') return res.status(403).json({ error: 'Apenas master' });
  const schema = z.object({ name: z.string().min(2), email: z.string().email().optional().nullable() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { name, email } = parse.data;
  try {
    const r = await query('INSERT INTO companies (name, email) VALUES ($1,$2) RETURNING id, name, email', [name, email || null]);
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET
router.get('/companies/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'master') return res.status(403).json({ error: 'Apenas master' });
  try {
    const r = await query('SELECT id, name, email FROM companies WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// UPDATE
router.put('/companies/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'master') return res.status(403).json({ error: 'Apenas master' });
  const schema = z.object({ name: z.string().min(2), email: z.string().email().optional().nullable() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { name, email } = parse.data;
  try {
    const r = await query('UPDATE companies SET name=$1, email=$2 WHERE id=$3 RETURNING id, name, email', [name, email || null, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE
router.delete('/companies/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'master') return res.status(403).json({ error: 'Apenas master' });
  try {
    await query('DELETE FROM companies WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// CREATE USER (empresa)
router.post('/users', requireAuth, async (req, res) => {
  if (req.user.role !== 'master') return res.status(403).json({ error: 'Apenas master' });
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    company_id: z.coerce.number().int().positive(),
    role: z.enum(['user','master']).optional().default('user')
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const { email, password, company_id, role } = parse.data;
  try {
    const exists = await query('SELECT id FROM companies WHERE id=$1', [company_id]);
    if (!exists.rows[0]) return res.status(400).json({ error: 'Empresa não encontrada' });
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password + `::company:${companyId}`, 12);

    const r = await query('INSERT INTO users (email, password_hash, role, company_id) VALUES ($1,$2,$3,$4) RETURNING id, email, role, company_id', [email, hash, role, company_id]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (String(err.message).includes('duplicate key')) return res.status(409).json({ error: 'Email já cadastrado' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;