// server/src/routes/coupons.js
// CRUD de CUPONS de desconto da assinatura SaaS. Master gerencia os cupons da
// PLATAFORMA (partner_id NULL); um PARCEIRO gerencia os próprios (partner_id = a
// empresa dele) via o portal de revenda. O desconto é aplicado na 1ª cobrança do
// signup (ver services/coupons.js).
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('./auth');
const { getEffectivePermissions } = require('../services/permissions');
const { respondError } = require('../utils/http-error');
const { normalizeCode } = require('../services/coupons');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

// Escopo do ator sobre cupons: master mexe em todos (partner_id NULL nos que cria);
// parceiro (empresa is_partner + permissão do portal) mexe só nos próprios. Retorna
// null quando não autorizado.
async function couponScope(req) {
  if (req.user?.role === 'master') return { isMaster: true, partnerId: null };
  const cid = req.companyId;
  if (!cid) return null;
  const perms = await getEffectivePermissions(req.user, cid);
  if (!perms.includes('partner.portal.view')) return null;
  const c = await query(`SELECT is_partner FROM ${SCHEMA}.companies WHERE id=$1`, [cid]);
  if (!c.rows[0]?.is_partner) return null;
  return { isMaster: false, partnerId: cid };
}

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
  partner_id, created_at, updated_at`;

// ---- Listar ---- (master: todos; parceiro: só os dele)
router.get('/', requireAuth, async (req, res) => {
  try {
    const scope = await couponScope(req);
    if (!scope) return res.status(403).json({ error: 'Sem permissão' });
    const r = scope.isMaster
      ? await query(`SELECT ${RETURN_COLS} FROM ${SCHEMA}.coupons ORDER BY active DESC, created_at DESC`)
      : await query(`SELECT ${RETURN_COLS} FROM ${SCHEMA}.coupons WHERE partner_id=$1 ORDER BY active DESC, created_at DESC`, [scope.partnerId]);
    res.json({ coupons: r.rows });
  } catch (e) { respondError(res, e); }
});

// ---- Criar ---- (parceiro: partner_id forçado = empresa dele)
router.post('/', requireAuth, async (req, res) => {
  try {
    const scope = await couponScope(req);
    if (!scope) return res.status(403).json({ error: 'Sem permissão' });
    const c = parseCouponBody(req.body);
    // Parceiro só cria cupom próprio; suas restrições de plano ficam de fora
    // (o cupom vale para o que ele vender). Master cria cupom da plataforma.
    const partnerId = scope.isMaster ? null : scope.partnerId;
    const planIds = scope.isMaster ? c.plan_ids : null;
    const r = await query(
      `INSERT INTO ${SCHEMA}.coupons
         (code, description, discount_type, discount_value, applies_to_period, plan_ids,
          min_amount, max_redemptions, starts_at, expires_at, active, partner_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::int[],$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${RETURN_COLS}`,
      [c.code, c.description, c.discount_type, c.discount_value, c.applies_to_period, planIds,
       c.min_amount, c.max_redemptions, c.starts_at, c.expires_at, c.active, partnerId, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'Já existe um cupom com esse código' });
    if (e.status) return res.status(e.status).json({ error: e.message });
    respondError(res, e);
  }
});

// Confere que o cupom é do escopo do ator (master: qualquer; parceiro: só o dele).
async function ownedCoupon(scope, id) {
  const r = await query(`SELECT id, partner_id, redeemed_count FROM ${SCHEMA}.coupons WHERE id=$1`, [id]);
  const row = r.rows[0];
  if (!row) return { notFound: true };
  if (!scope.isMaster && Number(row.partner_id) !== Number(scope.partnerId)) return { forbidden: true };
  return { row };
}

// ---- Atualizar ----
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const scope = await couponScope(req);
    if (!scope) return res.status(403).json({ error: 'Sem permissão' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const own = await ownedCoupon(scope, id);
    if (own.notFound) return res.status(404).json({ error: 'Cupom não encontrado' });
    if (own.forbidden) return res.status(403).json({ error: 'Sem permissão' });
    const c = parseCouponBody(req.body);
    const planIds = scope.isMaster ? c.plan_ids : null;
    const r = await query(
      `UPDATE ${SCHEMA}.coupons
          SET code=$1, description=$2, discount_type=$3, discount_value=$4, applies_to_period=$5,
              plan_ids=$6::int[], min_amount=$7, max_redemptions=$8, starts_at=$9, expires_at=$10,
              active=$11, updated_at=now()
        WHERE id=$12
        RETURNING ${RETURN_COLS}`,
      [c.code, c.description, c.discount_type, c.discount_value, c.applies_to_period, planIds,
       c.min_amount, c.max_redemptions, c.starts_at, c.expires_at, c.active, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'Já existe um cupom com esse código' });
    if (e.status) return res.status(e.status).json({ error: e.message });
    respondError(res, e);
  }
});

// ---- Ativar/desativar ----
router.patch('/:id/active', requireAuth, async (req, res) => {
  try {
    const scope = await couponScope(req);
    if (!scope) return res.status(403).json({ error: 'Sem permissão' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const own = await ownedCoupon(scope, id);
    if (own.notFound) return res.status(404).json({ error: 'Cupom não encontrado' });
    if (own.forbidden) return res.status(403).json({ error: 'Sem permissão' });
    const active = Boolean(req.body?.active);
    const r = await query(
      `UPDATE ${SCHEMA}.coupons SET active=$1, updated_at=now() WHERE id=$2 RETURNING ${RETURN_COLS}`,
      [active, id]
    );
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// ---- Excluir (soft se já teve uso, para preservar a auditoria) ----
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const scope = await couponScope(req);
    if (!scope) return res.status(403).json({ error: 'Sem permissão' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const own = await ownedCoupon(scope, id);
    if (own.notFound) return res.status(404).json({ error: 'Cupom não encontrado' });
    if (own.forbidden) return res.status(403).json({ error: 'Sem permissão' });
    if (Number(own.row.redeemed_count) > 0) {
      await query(`UPDATE ${SCHEMA}.coupons SET active=false, updated_at=now() WHERE id=$1`, [id]);
      return res.json({ ok: true, softDeleted: true, message: 'Cupom já utilizado — foi desativado (mantido para auditoria).' });
    }
    await query(`DELETE FROM ${SCHEMA}.coupons WHERE id=$1`, [id]);
    res.json({ ok: true, deleted: true });
  } catch (e) { respondError(res, e); }
});

module.exports = router;
