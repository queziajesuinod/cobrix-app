// server/src/routes/subscriptions.js
// Autosserviço da assinatura (empresa-cliente). Escopado por req.companyId.
// O cliente vê a própria assinatura e pode cancelá-la — o cancelamento vale até
// o fim do período já pago (carência); a inativação é efetivada pelo cron.
const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { selfCancelAtPeriodEnd, changePlan, listAccountCompanies, addCompanyToAccount, removeCompanyFromAccount } = require('../services/subscription-service');
const { respondError } = require('../utils/http-error');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

// GET /api/subscriptions/me — assinatura da empresa do usuário logado.
router.get('/me', requireAuth, companyScope(true), async (req, res) => {
  try {
    const r = await query(
      `SELECT cs.id, cs.status, cs.period, cs.plan_id, cs.access_until, cs.cancel_requested_at,
              cs.created_at, cs.activated_at,
              p.name AS plan_name, ct.value AS amount, c.status AS company_status
         FROM ${SCHEMA}.company_subscriptions cs
         LEFT JOIN ${SCHEMA}.plans p ON p.id = cs.plan_id
         LEFT JOIN ${SCHEMA}.contracts ct ON ct.id = cs.contract_id
         JOIN ${SCHEMA}.companies c ON c.id = cs.company_id
        WHERE cs.company_id = $1
        ORDER BY cs.created_at DESC LIMIT 1`,
      [req.companyId]
    );
    res.json({ subscription: r.rows[0] || null });
  } catch (e) {
    respondError(res, e);
  }
});

// POST /api/subscriptions/me/cancel — cancelamento pelo cliente (fim do período).
// Restrito ao admin da empresa.
router.post('/me/cancel', requireAuth, companyScope(true), async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'master') {
    return res.status(403).json({ error: 'Apenas o administrador da empresa pode cancelar a assinatura' });
  }
  try {
    const result = await selfCancelAtPeriodEnd(req.companyId);
    if (result.skipped) {
      return res.status(400).json({ error: 'Nenhuma assinatura ativa para cancelar' });
    }
    res.json({ ok: true, ...result });
  } catch (e) {
    respondError(res, e);
  }
});

// POST /api/subscriptions/me/change-plan — upgrade/mudança de plano pelo cliente.
// Cancela o contrato atual e cria um novo com o valor do plano escolhido.
router.post('/me/change-plan', requireAuth, companyScope(true), async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'master') {
    return res.status(403).json({ error: 'Apenas o administrador da empresa pode alterar o plano' });
  }
  const planId = Number(req.body?.plan_id);
  const period = String(req.body?.period || 'monthly').toLowerCase();
  if (!Number.isInteger(planId)) return res.status(400).json({ error: 'Selecione um plano' });
  if (!['monthly', 'annual'].includes(period)) return res.status(400).json({ error: 'Período inválido' });
  try {
    const result = await changePlan({ companyId: req.companyId, planId, period });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- Empresas da conta (multi-empresa com o mesmo login) ----
const isAccountAdmin = (req) => req.user.role === 'admin' || req.user.role === 'master';

// GET /api/subscriptions/me/companies — principal + extras + custo de uma extra.
router.get('/me/companies', requireAuth, companyScope(true), async (req, res) => {
  try {
    const data = await listAccountCompanies(req.companyId);
    res.json(data);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// POST /api/subscriptions/me/companies { name } — adiciona empresa extra (cobra
// a diferença proporcional na hora). Só o admin da conta.
router.post('/me/companies', requireAuth, companyScope(true), async (req, res) => {
  if (!isAccountAdmin(req)) return res.status(403).json({ error: 'Apenas o administrador da conta pode adicionar empresas' });
  try {
    const result = await addCompanyToAccount({ companyId: req.companyId, name: req.body?.name, document: req.body?.document });
    res.status(201).json(result);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// DELETE /api/subscriptions/me/companies/:id — remove uma empresa extra da conta.
router.delete('/me/companies/:id', requireAuth, companyScope(true), async (req, res) => {
  if (!isAccountAdmin(req)) return res.status(403).json({ error: 'Apenas o administrador da conta pode remover empresas' });
  try {
    const result = await removeCompanyFromAccount({ companyId: req.companyId, extraCompanyId: Number(req.params.id) });
    res.json(result);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = router;
