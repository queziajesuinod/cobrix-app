// server/src/routes/coupons.js
// CRUD de CUPONS de desconto da assinatura SaaS. Somente master.
// O desconto é aplicado na 1ª cobrança do signup (ver services/coupons.js).
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('./auth');
const { masterOnly } = require('../services/permissions');
const { respondError } = require('../utils/http-error');
const { normalizeCode } = require('../services/coupons');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

function parseMoney(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function parseIntOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function parseDateOrNull(v) {
  if (!v) return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function parsePlanIds(v) {
  if (!Array.isArray(v) || v.length === 0) return null;
  const ids = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  return ids.length ? ids : null;
}
function normPeriod(v) {
  const p = String(v || 'any').toLowerCase();
  return ['any', 'monthly', 'annual'].includes(p) ? p : 'any';
}

// Valida e normaliza o corpo de um cupom. Lança { status, message } em erro.
function parseCouponBody(body = {}) {
  const code = normalizeCode(body.code);
  if (code.length < 2) { const e = new Error('Código do cupom obrigatório'); e.status = 400; throw e; }
  if (!/^[A-Z0-9_-]+$/.test(code)) { const e = new Error('Use apenas letras, números, hífen e underscore no código'); e.status = 400; throw e; }

  const discountType = body.discount_type === 'fixed' ? 'fixed' : 'percent';
  const discountValue = parseMoney(body.discount_value);
  if (discountValue == null || discountValue <= 0) { const e = new Error('Informe um valor de desconto maior que zero'); e.status = 400; throw e; }
  if (discountType === 'percent' && discountValue > 100) { const e = new Error('Desconto em % não pode passar de 100'); e.status = 400; throw e; }

  const startsAt = parseDateOrNull(body.starts_at);
  const expiresAt = parseDateOrNull(body.expires_at);
  if (startsAt && expiresAt && expiresAt < startsAt) { const e = new Error('A validade final não pode ser antes da inicial'); e.status = 400; throw e; }

  return {
    code,
    description: body.description ? String(body.description).trim() : null,
    discount_type: discountType,
    discount_value: discountValue,
    applies_to_period: normPeriod(body.applies_to_period),
    plan_ids: parsePlanIds(body.plan_ids),
    min_amount: parseMoney(body.min_amount),
    max_redemptions: parseIntOrNull(body.max_redemptions),
    starts_at: startsAt,
    expires_at: expiresAt,
    active: body.active === undefined ? true : Boolean(body.active),
  };
}

const RETURN_COLS = `id, code, description, discount_type, discount_value, applies_to_period,
  plan_ids, min_amount, max_redemptions, redeemed_count, starts_at, expires_at, active,
  created_at, updated_at`;

// ---- Listar ----
router.get('/', requireAuth, masterOnly, async (_req, res) => {
  try {
    const r = await query(
      `SELECT ${RETURN_COLS} FROM ${SCHEMA}.coupons ORDER BY active DESC, created_at DESC`
    );
    res.json({ coupons: r.rows });
  } catch (e) { respondError(res, e); }
});

// ---- Criar ----
router.post('/', requireAuth, masterOnly, async (req, res) => {
  try {
    const c = parseCouponBody(req.body);
    const r = await query(
      `INSERT INTO ${SCHEMA}.coupons
         (code, description, discount_type, discount_value, applies_to_period, plan_ids,
          min_amount, max_redemptions, starts_at, expires_at, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::int[],$7,$8,$9,$10,$11,$12)
       RETURNING ${RETURN_COLS}`,
      [c.code, c.description, c.discount_type, c.discount_value, c.applies_to_period, c.plan_ids,
       c.min_amount, c.max_redemptions, c.starts_at, c.expires_at, c.active, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'Já existe um cupom com esse código' });
    if (e.status) return res.status(e.status).json({ error: e.message });
    respondError(res, e);
  }
});

// ---- Atualizar ----
router.put('/:id', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const c = parseCouponBody(req.body);
    const r = await query(
      `UPDATE ${SCHEMA}.coupons
          SET code=$1, description=$2, discount_type=$3, discount_value=$4, applies_to_period=$5,
              plan_ids=$6::int[], min_amount=$7, max_redemptions=$8, starts_at=$9, expires_at=$10,
              active=$11, updated_at=now()
        WHERE id=$12
        RETURNING ${RETURN_COLS}`,
      [c.code, c.description, c.discount_type, c.discount_value, c.applies_to_period, c.plan_ids,
       c.min_amount, c.max_redemptions, c.starts_at, c.expires_at, c.active, id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Cupom não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'Já existe um cupom com esse código' });
    if (e.status) return res.status(e.status).json({ error: e.message });
    respondError(res, e);
  }
});

// ---- Ativar/desativar ----
router.patch('/:id/active', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const active = Boolean(req.body?.active);
    const r = await query(
      `UPDATE ${SCHEMA}.coupons SET active=$1, updated_at=now() WHERE id=$2 RETURNING ${RETURN_COLS}`,
      [active, id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Cupom não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// ---- Excluir (soft se já teve uso, para preservar a auditoria) ----
router.delete('/:id', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const cur = await query(`SELECT redeemed_count FROM ${SCHEMA}.coupons WHERE id=$1`, [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Cupom não encontrado' });
    if (Number(cur.rows[0].redeemed_count) > 0) {
      await query(`UPDATE ${SCHEMA}.coupons SET active=false, updated_at=now() WHERE id=$1`, [id]);
      return res.json({ ok: true, softDeleted: true, message: 'Cupom já utilizado — foi desativado (mantido para auditoria).' });
    }
    await query(`DELETE FROM ${SCHEMA}.coupons WHERE id=$1`, [id]);
    res.json({ ok: true, deleted: true });
  } catch (e) { respondError(res, e); }
});

module.exports = router;
