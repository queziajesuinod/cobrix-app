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

// Nota: a antiga rota POST /users foi removida — estava quebrada (referenciava
// a variável indefinida `companyId` e uma coluna users.company_id inexistente,
// sempre resultando em 500). A criação de usuários é feita por
// company-users-management.js (modelo M2M via user_companies).

module.exports = router;