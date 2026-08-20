// server/src/routes/partner-commissions.js
// Tela de comissões de revenda (razão partner_commissions). Mostra, para a empresa
// SELECIONADA, o que ela tem A RECEBER (como payee) e A PAGAR (como payer).
// Registrar acerto marca as comissões como pagas e quita a despesa financeira do
// parceiro pagador (a receita do recebedor já foi lançada no acúmulo).
const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { requirePermission } = require('../services/permissions');
const { respondError } = require('../utils/http-error');
const { chargePartnerCommissions } = require('../services/partner-commission');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Totais em aberto (accrued): a receber (por parceiro pagador) e a pagar (por credor).
router.get('/summary', requireAuth, companyScope(true), requirePermission('partner.portal.view'), async (req, res) => {
  const cid = req.companyId;
  if (!cid) return res.status(400).json({ error: 'Selecione uma empresa' });
  try {
    const receivable = await query(
      `SELECT pc.payer_company_id AS company_id, co.name AS company_name,
              COUNT(*)::int AS count, COALESCE(SUM(pc.amount),0)::numeric(14,2) AS total
         FROM ${SCHEMA}.partner_commissions pc
         JOIN ${SCHEMA}.companies co ON co.id = pc.payer_company_id
        WHERE pc.payee_company_id = $1 AND pc.status = 'accrued'
        GROUP BY pc.payer_company_id, co.name
        ORDER BY total DESC`,
      [cid]
    );
    const payable = await query(
      `SELECT pc.payee_company_id AS company_id, co.name AS company_name,
              COUNT(*)::int AS count, COALESCE(SUM(pc.amount),0)::numeric(14,2) AS total
         FROM ${SCHEMA}.partner_commissions pc
         JOIN ${SCHEMA}.companies co ON co.id = pc.payee_company_id
        WHERE pc.payer_company_id = $1 AND pc.status = 'accrued'
        GROUP BY pc.payee_company_id, co.name
        ORDER BY total DESC`,
      [cid]
    );
    const sum = (rows) => round2(rows.reduce((a, r) => a + Number(r.total || 0), 0));
    res.json({
      receivable: { items: receivable.rows, total: sum(receivable.rows) },
      payable: { items: payable.rows, total: sum(payable.rows) },
    });
  } catch (e) { respondError(res, e); }
});

// Lista detalhada. ?role=receivable|payable · ?status=accrued|settled · ?counterparty=<id>
router.get('/', requireAuth, companyScope(true), requirePermission('partner.portal.view'), async (req, res) => {
  const cid = req.companyId;
  if (!cid) return res.status(400).json({ error: 'Selecione uma empresa' });
  const role = req.query.role === 'payable' ? 'payable' : 'receivable';
  const status = ['accrued', 'settled'].includes(String(req.query.status)) ? String(req.query.status) : 'accrued';
  const counterparty = req.query.counterparty ? Number(req.query.counterparty) : null;
  try {
    const selfCol = role === 'receivable' ? 'payee_company_id' : 'payer_company_id';
    const otherCol = role === 'receivable' ? 'payer_company_id' : 'payee_company_id';
    const params = [cid, status];
    let where = `pc.${selfCol} = $1 AND pc.status = $2`;
    if (counterparty) { params.push(counterparty); where += ` AND pc.${otherCol} = $${params.length}`; }
    const r = await query(
      `SELECT pc.id, pc.kind, pc.period, pc.amount, pc.floor_amount, pc.created_at, pc.settled_at,
              pc.${otherCol} AS counterparty_id, co.name AS counterparty_name, pc.subscription_id
         FROM ${SCHEMA}.partner_commissions pc
         JOIN ${SCHEMA}.companies co ON co.id = pc.${otherCol}
        WHERE ${where}
        ORDER BY pc.created_at DESC
        LIMIT 500`,
      params
    );
    res.json({ items: r.rows, role, status });
  } catch (e) { respondError(res, e); }
});

// Registrar acerto: só quem RECEBE (payee = empresa atual) dá baixa. Recebe
// { ids: [] } e/ou { counterparty_id } (quita tudo a receber daquele parceiro).
// Marca as comissões como 'settled' e quita a despesa financeira ligada do pagador.
router.post('/settle', requireAuth, companyScope(true), requirePermission('partner.portal.view'), async (req, res) => {
  const cid = req.companyId;
  if (!cid) return res.status(400).json({ error: 'Selecione uma empresa' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  const counterpartyId = req.body?.counterparty_id ? Number(req.body.counterparty_id) : null;
  if ((!ids || !ids.length) && !counterpartyId) {
    return res.status(400).json({ error: 'Informe as comissões (ids) ou o parceiro (counterparty_id)' });
  }
  try {
    const params = [cid];
    let where = `payee_company_id = $1 AND status = 'accrued'`;
    if (ids && ids.length) { params.push(ids); where += ` AND id = ANY($${params.length}::int[])`; }
    if (counterpartyId) { params.push(counterpartyId); where += ` AND payer_company_id = $${params.length}`; }
    const upd = await query(
      `UPDATE ${SCHEMA}.partner_commissions
          SET status='settled', settled_at=now()
        WHERE ${where}
        RETURNING id, finance_expense_id`,
      params
    );
    const expenseIds = upd.rows.map((r) => r.finance_expense_id).filter(Boolean);
    if (expenseIds.length) {
      await query(
        `UPDATE ${SCHEMA}.finance_expenses SET status='paid', updated_at=now()
          WHERE id = ANY($1::int[]) AND status <> 'paid'`,
        [expenseIds]
      );
    }
    res.json({ ok: true, settled: upd.rowCount });
  } catch (e) { respondError(res, e); }
});

// Cobrar a comissão de um parceiro (gera billing + PIX + WhatsApp). Só o CREDOR
// (empresa atual = payee) pode cobrar. { counterparty_id } = o parceiro pagador.
router.post('/charge', requireAuth, companyScope(true), requirePermission('partner.portal.view'), async (req, res) => {
  const cid = req.companyId;
  if (!cid) return res.status(400).json({ error: 'Selecione uma empresa' });
  const partnerId = Number(req.body?.counterparty_id);
  if (!Number.isInteger(partnerId)) return res.status(400).json({ error: 'Parceiro inválido' });
  try {
    const out = await chargePartnerCommissions({ payeeCompanyId: cid, partnerId });
    res.json({ ok: true, ...out });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    respondError(res, e);
  }
});

module.exports = router;
