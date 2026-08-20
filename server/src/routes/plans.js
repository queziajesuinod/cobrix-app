// server/src/routes/plans.js
// CRUD do catálogo de PLANOS (Fase 1 do SaaS). Somente master.
// Um plano = preço (mensal/anual) + cotas + teto de acesso (permission_keys).
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('./auth');
const { masterOnly } = require('../services/permissions');
const { isValidPermission } = require('../config/permissions-catalog');
const { respondError } = require('../utils/http-error');
const { previewPlanAdjustment, applyPlanAdjustment } = require('../services/subscription-service');
const { schedulePlanFloor } = require('../services/plan-floor');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

// Preço: número >= 0 ou null (aceita vírgula decimal).
function parseMoney(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Cota (clientes/contratos): inteiro >= 0 ou null (null = ilimitado).
function parseLimit(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// Chaves de permissão válidas, sem duplicatas (o teto do plano).
function parseKeys(v) {
  const arr = Array.isArray(v) ? v : [];
  return [...new Set(arr.map(String))].filter(isValidPermission);
}

// Comissão-base da Padrão neste plano (revenda). Lança { status } se % > 100.
// Incide sobre o PISO (price_monthly/annual são o piso). type: 'percent'|'fixed'.
function parseCommission(body = {}) {
  const type = body.partner_commission_type === 'fixed' ? 'fixed' : 'percent';
  const value = parseMoney(body.partner_commission_value) || 0;
  if (type === 'percent' && value > 100) {
    const e = new Error('Comissão em % não pode passar de 100'); e.status = 400; throw e;
  }
  return { type, value };
}

// ---- Listar ----
router.get('/', requireAuth, masterOnly, async (_req, res) => {
  try {
    const r = await query(
      `SELECT p.id, p.name, p.description, p.price_monthly, p.price_annual,
              p.clients_limit, p.contracts_limit, p.permission_keys, p.active,
              p.partner_commission_type, p.partner_commission_value,
              p.created_at, p.updated_at,
              (SELECT COUNT(*)::int FROM ${SCHEMA}.companies c WHERE c.plan_id = p.id) AS company_count
         FROM ${SCHEMA}.plans p
        ORDER BY p.active DESC, p.price_monthly ASC NULLS LAST, p.name ASC`
    );
    res.json({ plans: r.rows });
  } catch (e) { respondError(res, e); }
});

// ---- Obter um ----
router.get('/:id', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const r = await query(
      `SELECT id, name, description, price_monthly, price_annual, clients_limit,
              contracts_limit, permission_keys, active,
              partner_commission_type, partner_commission_value, created_at, updated_at
         FROM ${SCHEMA}.plans WHERE id = $1`,
      [id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Plano não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// ---- Criar ----
router.post('/', requireAuth, masterOnly, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Nome do plano obrigatório' });
    const description = req.body?.description ? String(req.body.description).trim() : null;
    const priceMonthly = parseMoney(req.body?.price_monthly);
    const priceAnnual = parseMoney(req.body?.price_annual);
    if (priceMonthly == null && priceAnnual == null) {
      return res.status(400).json({ error: 'Informe ao menos um preço (mensal ou anual)' });
    }
    const keys = parseKeys(req.body?.permission_keys);
    const active = req.body?.active === undefined ? true : Boolean(req.body.active);
    const commission = parseCommission(req.body);

    const r = await query(
      `INSERT INTO ${SCHEMA}.plans
         (name, description, price_monthly, price_annual, clients_limit, contracts_limit, permission_keys, active, partner_commission_type, partner_commission_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11)
       RETURNING id, name, description, price_monthly, price_annual, clients_limit, contracts_limit, permission_keys, active, partner_commission_type, partner_commission_value`,
      [name, description, priceMonthly, priceAnnual, parseLimit(req.body?.clients_limit), parseLimit(req.body?.contracts_limit), keys, active, commission.type, commission.value, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'Já existe um plano com esse nome' });
    respondError(res, e);
  }
});

// ---- Atualizar (substitui o recurso inteiro) ----
router.put('/:id', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const name = String(req.body?.name || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Nome do plano obrigatório' });
    const priceMonthly = parseMoney(req.body?.price_monthly);
    const priceAnnual = parseMoney(req.body?.price_annual);
    if (priceMonthly == null && priceAnnual == null) {
      return res.status(400).json({ error: 'Informe ao menos um preço (mensal ou anual)' });
    }
    const description = req.body?.description ? String(req.body.description).trim() : null;
    const keys = parseKeys(req.body?.permission_keys);
    const active = req.body?.active === undefined ? true : Boolean(req.body.active);
    const commission = parseCommission(req.body);

    const r = await query(
      `UPDATE ${SCHEMA}.plans
          SET name = $1, description = $2, price_monthly = $3, price_annual = $4,
              clients_limit = $5, contracts_limit = $6, permission_keys = $7::text[],
              active = $8, partner_commission_type = $9, partner_commission_value = $10, updated_at = now()
        WHERE id = $11
        RETURNING id, name, description, price_monthly, price_annual, clients_limit, contracts_limit, permission_keys, active, partner_commission_type, partner_commission_value`,
      [name, description, priceMonthly, priceAnnual, parseLimit(req.body?.clients_limit), parseLimit(req.body?.contracts_limit), keys, active, commission.type, commission.value, id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Plano não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'Já existe um plano com esse nome' });
    respondError(res, e);
  }
});

// ---- Reajuste de assinantes: prévia (assinaturas ativas + de/para valor) ----
router.get('/:id/adjust-preview', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    res.json(await previewPlanAdjustment(id));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---- Reajuste de assinantes: aplicar (grava o valor vigente nos contratos) ----
router.post('/:id/adjust', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const subscriptionIds = Array.isArray(req.body?.subscription_ids) ? req.body.subscription_ids : null;
  try {
    res.json(await applyPlanAdjustment(id, { subscriptionIds, appliedBy: req.user?.id || null }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---- Reajuste de PISO agendado (revenda): listar ----
router.get('/:id/floor-schedule', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const r = await query(
      `SELECT id, new_price_monthly, new_price_annual, effective_date, note, created_at, applied_at
         FROM ${SCHEMA}.plan_floor_adjustments
        WHERE plan_id = $1
        ORDER BY effective_date DESC, id DESC`,
      [id]
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

// ---- Reajuste de PISO agendado: criar (avisa os parceiros na hora) ----
router.post('/:id/floor-schedule', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const out = await schedulePlanFloor({
      planId: id,
      newMonthly: parseMoney(req.body?.new_price_monthly),
      newAnnual: parseMoney(req.body?.new_price_annual),
      effectiveDate: req.body?.effective_date,
      note: req.body?.note ? String(req.body.note).trim() : null,
      userId: req.user?.id || null,
    });
    res.status(201).json(out);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    respondError(res, e);
  }
});

// ---- Reajuste de PISO agendado: cancelar um pendente (ainda não aplicado) ----
router.delete('/:id/floor-schedule/:adjId', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  const adjId = Number(req.params.adjId);
  if (!Number.isInteger(id) || !Number.isInteger(adjId)) return res.status(400).json({ error: 'parâmetros inválidos' });
  try {
    const r = await query(
      `DELETE FROM ${SCHEMA}.plan_floor_adjustments WHERE id=$1 AND plan_id=$2 AND applied_at IS NULL RETURNING id`,
      [adjId, id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Agendamento não encontrado ou já aplicado' });
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// ---- Excluir (bloqueia se estiver em uso por empresas) ----
router.delete('/:id', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const used = await query(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.companies WHERE plan_id = $1`, [id]);
    if (Number(used.rows[0].n) > 0) {
      return res.status(409).json({ error: 'Plano em uso por empresas. Migre-as antes de excluir.' });
    }
    const r = await query(`DELETE FROM ${SCHEMA}.plans WHERE id = $1 RETURNING id`, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Plano não encontrado' });
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

module.exports = router;
