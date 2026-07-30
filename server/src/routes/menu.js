const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('./auth');
const { respondError } = require('../utils/http-error');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

// Itens de menu "Novo" já vistos pelo usuário logado.
router.get('/seen', requireAuth, async (req, res) => {
  try {
    const r = await query(`SELECT item_key FROM ${SCHEMA}.user_seen_menu WHERE user_id = $1`, [req.user.id]);
    res.json({ keys: r.rows.map((x) => x.item_key) });
  } catch (e) { respondError(res, e); }
});

// Marca um item como visto (ao abri-lo).
router.post('/seen', requireAuth, async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim().slice(0, 200);
    if (!key) return res.status(400).json({ error: 'key obrigatório' });
    await query(
      `INSERT INTO ${SCHEMA}.user_seen_menu (user_id, item_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.user.id, key]
    );
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

module.exports = router;
