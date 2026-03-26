const { query } = require('../db');
const { getChargeStatus } = require('../services/payment-gateway');
const { notifyBillingPaid } = require('../services/payment-notifications');
const { ensureDateOnly } = require('../utils/date-only');
const logger = require('../utils/logger');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const SUCCESS_STATUSES = new Set(['CONCLUIDA']);
const DEFAULT_BATCH = Number(process.env.GATEWAY_POLL_BATCH || 20);

let running = false;

async function fetchPending(limit) {
  const r = await query(
    `SELECT id, company_id, contract_id, billing_id, due_date, txid, status
       FROM ${SCHEMA}.billing_gateway_links
      WHERE status IN ('generated','processing')
        AND txid IS NOT NULL
        AND paid_at IS NULL
      ORDER BY updated_at ASC
      LIMIT $1`,
    [limit]
  );
  return r.rows;
}

async function updateContractMonthStatus(contractId, billingDate) {
  if (!contractId || !billingDate) return;
  // new Date('YYYY-MM-DD') interpreta como UTC midnight → em UTC-3/UTC-4 vira
  // o dia anterior, marcando o mês errado como pago. ensureDateOnly() parseia
  // a string via regex e cria Date no horário local, sem shift de timezone.
  const d = ensureDateOnly(billingDate);
  if (!d) return;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  await query(
    `UPDATE ${SCHEMA}.contract_month_status
        SET status='paid'
      WHERE contract_id=$1 AND year=$2 AND month=$3`,
    [contractId, year, month]
  ).catch(() => {});
}

async function markBillingPaid({ companyId, contractId, dueDate, billingId, txid }) {
  let updatedBilling = null;
  if (billingId) {
    const r = await query(
      `UPDATE ${SCHEMA}.billings
          SET status='paid',
              gateway_paid_at=COALESCE(gateway_paid_at, NOW()),
              gateway_txid=COALESCE(gateway_txid, $2)
        WHERE id=$1
        RETURNING id, contract_id, billing_date`,
      [billingId, txid || null]
    );
    updatedBilling = r.rows[0] || null;
  }
  if (!updatedBilling) {
    const r = await query(
      `UPDATE ${SCHEMA}.billings
          SET status='paid',
              gateway_paid_at=COALESCE(gateway_paid_at, NOW()),
              gateway_txid=COALESCE(gateway_txid, $4)
        WHERE company_id=$1 AND contract_id=$2 AND billing_date=$3
        RETURNING id, contract_id, billing_date`,
      [companyId, contractId, dueDate, txid || null]
    );
    updatedBilling = r.rows[0] || null;
  }
  if (updatedBilling) {
    await updateContractMonthStatus(
      updatedBilling.contract_id || contractId,
      updatedBilling.billing_date || dueDate
    );
  }
  return updatedBilling;
}

async function markLinkAsPaid(link, detail) {
  const detailJson = detail ? JSON.stringify(detail) : null;
  const update = await query(
    `UPDATE ${SCHEMA}.billing_gateway_links
        SET status='paid',
            paid_at=NOW(),
            gateway_payload = CASE
              WHEN $2::text IS NULL THEN gateway_payload
              ELSE COALESCE(gateway_payload, '{}'::jsonb) || jsonb_build_object('lastDetail', $2::jsonb)
            END,
            updated_at=NOW()
      WHERE id=$1
      RETURNING company_id, contract_id, billing_id, due_date, txid`,
    [link.id, detailJson]
  );
  const row = update.rows[0];
  if (!row) return null;
  const billingResult = await markBillingPaid({
    companyId: row.company_id,
    contractId: row.contract_id,
    dueDate: row.due_date,
    billingId: row.billing_id || link.billing_id || null,
    txid: row.txid || link.txid,
  });
  const mergedLink = { ...link, ...row };
  return { link: mergedLink, billing: billingResult };
}

async function handleConfirmedPayment(link, detail) {
  const result = await markLinkAsPaid(link, detail);
  if (!result) return;
  const billingId = result.billing?.id || result.link?.billing_id;
  if (!billingId) return;
  const notification = await notifyBillingPaid({
    billingId,
    companyId: result.link?.company_id || link.company_id,
    detail,
  });
  logger.info(
    { billingId, companyId: result.link?.company_id, notified: Boolean(notification?.sent), source: detail?._source || 'polling' },
    '[gateway] pagamento confirmado'
  );
}

async function reconcileLink(link) {
  try {
    const detail = await getChargeStatus({ companyId: link.company_id, txid: link.txid });
    const status = (detail?.status || '').toUpperCase();
    if (SUCCESS_STATUSES.has(status)) {
      await handleConfirmedPayment(link, { ...detail, _source: 'polling' });
    }
  } catch (err) {
    logger.error(
      { err, companyId: link.company_id, txid: link.txid },
      '[gateway-reconcile] erro ao reconciliar link'
    );
  }
}

// Processa um pagamento PIX recebido via webhook (sem consultar EFI novamente)
async function processWebhookPayment({ txid, valor, horario, endToEndId }) {
  // Valida campos obrigatórios e tipos básicos para evitar dados corrompidos no banco
  if (!txid || typeof txid !== 'string' || txid.trim().length === 0 || txid.length > 200) {
    logger.warn({ txid }, '[webhook] txid inválido ou ausente');
    return { skipped: true, reason: 'invalid-txid' };
  }
  if (valor !== undefined && valor !== null && (typeof valor !== 'string' || !/^\d+(\.\d{1,2})?$/.test(valor))) {
    logger.warn({ txid, valor }, '[webhook] campo valor com formato inválido — ignorado');
    valor = null;
  }

  const r = await query(
    `SELECT id, company_id, contract_id, billing_id, due_date, txid, status
       FROM ${SCHEMA}.billing_gateway_links
      WHERE txid = $1
        AND status IN ('generated','processing')
        AND paid_at IS NULL
      LIMIT 1`,
    [txid]
  );
  const link = r.rows[0];
  if (!link) {
    logger.warn({ txid }, '[webhook] txid não encontrado ou já processado');
    return { skipped: true, reason: 'not-found-or-paid' };
  }

  const detail = {
    txid,
    status: 'CONCLUIDA',
    valor,
    horario,
    endToEndId,
    _source: 'webhook',
  };

  await handleConfirmedPayment(link, detail);
  return { processed: true, txid };
}

async function runGatewayReconcile(limit = DEFAULT_BATCH) {
  if (running) return;
  running = true;
  try {
    const pending = await fetchPending(limit);
    if (pending.length > 0) {
      logger.info({ count: pending.length }, '[gateway-reconcile] verificando pagamentos pendentes');
    }
    for (const link of pending) {
      if (!link.txid) continue;
      await reconcileLink(link);
    }
  } finally {
    running = false;
  }
}

module.exports = {
  runGatewayReconcile,
  processWebhookPayment,
};
