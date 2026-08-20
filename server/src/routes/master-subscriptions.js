// server/src/routes/master-subscriptions.js
// Gestão de assinaturas do SaaS (somente master / dono do sistema).
// Lista as inscrições (company_subscriptions), confirma pagamento manualmente
// (ativando a empresa-cliente quando o webhook da Efí falha), cancela pendentes
// e reemite o PIX da 1ª mensalidade.
//
// Escopo: master opera CROSS-TENANT. NÃO usar req.companyId (para master é null);
// os dados são escopados pelas próprias FKs (contract_id/owner_company_id).
const express = require('express');
const { query, withClient } = require('../db');
const { requireAuth } = require('./auth');
const { masterOnly } = require('../services/permissions');
const { resolvePixPayment } = require('../services/pix-resolver');
const { notifyBillingPaid } = require('../services/payment-notifications');
const { accrueForPaidBilling } = require('../services/partner-commission');
const {
  handleConfirmedPayment,
  markBillingPaid,
  activateSubscriptionForContract,
} = require('../jobs/gateway-reconcile');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');
const { cancelSubscriptionImmediate, reactivateSubscription } = require('../services/subscription-service');
const { respondError } = require('../utils/http-error');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

const VALID_FILTER = new Set(['pending_payment', 'active', 'canceling', 'canceled']);

// ---- Listar assinaturas (com empresa, plano, valor e status da 1ª cobrança) ----
router.get('/subscriptions', requireAuth, masterOnly, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const filter = status && VALID_FILTER.has(status) ? status : null;
    const r = await query(
      `SELECT cs.id, cs.company_id, c.name AS company_name, c.status AS company_status,
              cs.plan_id, p.name AS plan_name, cs.period, cs.status,
              cs.created_at, cs.activated_at, cs.access_until, cs.contract_id, cs.owner_company_id,
              cs.promo_code,
              ct.value AS amount,
              b.status AS billing_status,
              gl.txid AS txid,
              (gl.txid IS NOT NULL OR gl.copy_paste IS NOT NULL) AS has_pix
         FROM ${SCHEMA}.company_subscriptions cs
         JOIN ${SCHEMA}.companies c ON c.id = cs.company_id
         LEFT JOIN ${SCHEMA}.plans p ON p.id = cs.plan_id
         LEFT JOIN ${SCHEMA}.contracts ct ON ct.id = cs.contract_id
         LEFT JOIN LATERAL (
           SELECT status FROM ${SCHEMA}.billings
            WHERE contract_id = cs.contract_id
            ORDER BY billing_date ASC LIMIT 1
         ) b ON true
         LEFT JOIN LATERAL (
           SELECT txid, copy_paste FROM ${SCHEMA}.billing_gateway_links
            WHERE contract_id = cs.contract_id
            ORDER BY created_at ASC LIMIT 1
         ) gl ON true
        WHERE ($1::text IS NULL OR cs.status = $1)
        ORDER BY cs.created_at DESC`,
      [filter]
    );
    res.json({ subscriptions: r.rows });
  } catch (e) {
    respondError(res, e);
  }
});

// ---- Detalhes / histórico de uma assinatura (somente leitura) ----
router.get('/subscriptions/:id', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Assinatura inválida' });
  try {
    const r = await query(
      `SELECT cs.*, c.name AS company_name, c.status AS company_status,
              p.name AS plan_name,
              ct.value AS amount, ct.description AS contract_description,
              cli.name AS client_name, cli.email AS client_email, cli.phone AS client_phone,
              cli.document_cpf, cli.document_cnpj,
              b.id AS billing_id, b.status AS billing_status, b.billing_date, b.gateway_paid_at,
              gl.txid, gl.status AS gateway_status, gl.paid_at AS gateway_paid_link_at,
              gl.copy_paste, gl.qr_code
         FROM ${SCHEMA}.company_subscriptions cs
         JOIN ${SCHEMA}.companies c ON c.id = cs.company_id
         LEFT JOIN ${SCHEMA}.plans p ON p.id = cs.plan_id
         LEFT JOIN ${SCHEMA}.contracts ct ON ct.id = cs.contract_id
         LEFT JOIN ${SCHEMA}.clients cli ON cli.id = cs.client_id
         LEFT JOIN LATERAL (
           SELECT id, status, billing_date, gateway_paid_at FROM ${SCHEMA}.billings
            WHERE contract_id = cs.contract_id
            ORDER BY billing_date ASC LIMIT 1
         ) b ON true
         LEFT JOIN LATERAL (
           SELECT txid, status, paid_at, copy_paste, qr_code FROM ${SCHEMA}.billing_gateway_links
            WHERE contract_id = cs.contract_id
            ORDER BY created_at ASC LIMIT 1
         ) gl ON true
        WHERE cs.id = $1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Assinatura não encontrada' });
    res.json({ subscription: row });
  } catch (e) {
    respondError(res, e);
  }
});

// ---- Confirmar pagamento manualmente (ativa a empresa-cliente) ----
router.post('/subscriptions/:id/confirm', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Assinatura inválida' });
  try {
    const sub = await query(
      `SELECT id, company_id, owner_company_id, contract_id, status
         FROM ${SCHEMA}.company_subscriptions WHERE id = $1`,
      [id]
    );
    const s = sub.rows[0];
    if (!s) return res.status(404).json({ error: 'Assinatura não encontrada' });
    if (!s.contract_id) return res.status(400).json({ error: 'Assinatura sem contrato vinculado' });

    // Caminho 1: existe link de gateway pendente → reproduz o webhook (marca link
    // pago → cobrança paga → notifica → ativa assinatura/empresa). Idempotente.
    const linkRes = await query(
      `SELECT id, company_id, contract_id, billing_id, due_date, txid
         FROM ${SCHEMA}.billing_gateway_links
        WHERE contract_id = $1 AND status IN ('generated','processing') AND paid_at IS NULL
        ORDER BY created_at ASC LIMIT 1`,
      [s.contract_id]
    );
    const link = linkRes.rows[0];
    if (link) {
      await handleConfirmedPayment(link, { _source: 'manual', status: 'CONCLUIDA' });
      return res.json({ ok: true, status: 'active', via: 'gateway-link' });
    }

    // Caminho 2: sem link de gateway (gateway não configurado no signup) →
    // marca a 1ª cobrança pendente como paga, notifica e ativa diretamente.
    const billRes = await query(
      `SELECT id, company_id, contract_id, billing_date, amount
         FROM ${SCHEMA}.billings
        WHERE contract_id = $1
        ORDER BY billing_date ASC LIMIT 1`,
      [s.contract_id]
    );
    const bill = billRes.rows[0];
    if (bill) {
      await markBillingPaid({
        companyId: bill.company_id,
        contractId: bill.contract_id,
        dueDate: bill.billing_date,
        billingId: bill.id,
        txid: null,
      });
      try {
        await notifyBillingPaid({
          billingId: bill.id,
          companyId: bill.company_id,
          amount: bill.amount,
          paymentDate: new Date(),
          detail: { source: 'manual-subscription', status: 'CONCLUIDA' },
        });
      } catch (_e) { /* notificação é best-effort */ }
    }
    await activateSubscriptionForContract(s.contract_id);
    // Revenda: acumula a comissão deste pagamento (no-op fora de assinatura de parceiro).
    if (bill) await accrueForPaidBilling({ billingId: bill.id, contractId: s.contract_id });
    return res.json({ ok: true, status: 'active', via: bill ? 'billing' : 'activate-only' });
  } catch (e) {
    respondError(res, e);
  }
});

// ---- Cancelar uma assinatura (imediato) — pendente, ativa ou em carência.
// Inativa a empresa-cliente e seus usuários. ----
router.post('/subscriptions/:id/cancel', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Assinatura inválida' });
  try {
    const result = await cancelSubscriptionImmediate({ subscriptionId: id });
    if (result.skipped && result.reason === 'assinatura-nao-encontrada') {
      return res.status(404).json({ error: 'Assinatura não encontrada' });
    }
    res.json({ ok: true, status: 'canceled', companyId: result.companyId });
  } catch (e) {
    respondError(res, e);
  }
});

// ---- Reativar uma assinatura cancelada (reativa usuários + define o plano) ----
router.post('/subscriptions/:id/reactivate', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Assinatura inválida' });
  const planId = Number(req.body?.plan_id);
  const period = String(req.body?.period || 'monthly').toLowerCase();
  if (!Number.isInteger(planId)) return res.status(400).json({ error: 'Selecione um plano' });
  if (!['monthly', 'annual'].includes(period)) return res.status(400).json({ error: 'Período inválido' });
  try {
    const result = await reactivateSubscription({ subscriptionId: id, planId, period });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- Reenviar / reemitir o PIX da 1ª mensalidade ----
router.post('/subscriptions/:id/resend-pix', requireAuth, masterOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Assinatura inválida' });
  try {
    const r = await query(
      `SELECT cs.owner_company_id, cs.contract_id,
              ct.description AS contract_description,
              cli.name AS client_name, cli.document_cpf, cli.document_cnpj,
              b.id AS billing_id, b.amount, b.billing_date
         FROM ${SCHEMA}.company_subscriptions cs
         LEFT JOIN ${SCHEMA}.contracts ct ON ct.id = cs.contract_id
         LEFT JOIN ${SCHEMA}.clients cli ON cli.id = cs.client_id
         LEFT JOIN LATERAL (
           SELECT id, amount, billing_date FROM ${SCHEMA}.billings
            WHERE contract_id = cs.contract_id AND status = 'pending'
            ORDER BY billing_date ASC LIMIT 1
         ) b ON true
        WHERE cs.id = $1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Assinatura não encontrada' });
    if (!row.billing_id) return res.status(400).json({ error: 'Não há cobrança pendente para gerar o PIX' });
    if (!row.owner_company_id) return res.status(400).json({ error: 'Assinatura sem empresa dona vinculada' });

    const link = await resolvePixPayment({
      companyId: row.owner_company_id,
      contractId: row.contract_id,
      billingId: row.billing_id,
      amount: Number(row.amount),
      dueDate: formatISODate(ensureDateOnly(row.billing_date) || row.billing_date),
      contractDescription: row.contract_description,
      clientName: row.client_name,
      clientDocument: { cpf: row.document_cpf, cnpj: row.document_cnpj },
    });
    if (!link) {
      return res.status(502).json({ error: 'Não foi possível gerar o PIX. Verifique o gateway da empresa dona.' });
    }
    res.json({
      ok: true,
      pix: {
        copyPaste: link.copyPaste || null,
        qrCodeImage: link.qrCodeImage || null,
        amount: Number(link.amount || row.amount),
      },
    });
  } catch (e) {
    respondError(res, e);
  }
});

module.exports = router;
