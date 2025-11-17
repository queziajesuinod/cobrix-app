const { query } = require('../db');
const { getChargeStatus } = require('../services/payment-gateway');

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
  const d = new Date(billingDate);
  if (Number.isNaN(d.getTime())) return;
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
}

async function markLinkAsPaid(link, detail) {
  const detailJson = detail ? JSON.stringify(detail) : null;
  const update = await query(
    `UPDATE ${SCHEMA}.billing_gateway_links
        SET status='paid',
            paid_at=NOW(),
            gateway_payload = COALESCE(gateway_payload, '{}'::jsonb) || jsonb_build_object('lastDetail', COALESCE($2::jsonb, '{}'::jsonb)),
            updated_at=NOW()
      WHERE id=$1
      RETURNING company_id, contract_id, billing_id, due_date, txid`,
    [link.id, detailJson]
  );
  const row = update.rows[0];
  if (!row) return;
  await markBillingPaid({
    companyId: row.company_id,
    contractId: row.contract_id,
    dueDate: row.due_date,
    billingId: row.billing_id || link.billing_id || null,
    txid: row.txid || link.txid,
  });
}

async function reconcileLink(link) {
  try {
    const detail = await getChargeStatus({ companyId: link.company_id, txid: link.txid });
    const status = (detail?.status || '').toUpperCase();
    if (SUCCESS_STATUSES.has(status)) {
      await markLinkAsPaid(link, detail);
    }
  } catch (err) {
    console.error('[gateway-reconcile] company=%s txid=%s erro=%s', link.company_id, link.txid, err.message);
  }
}

async function runGatewayReconcile(limit = DEFAULT_BATCH) {
  if (running) return;
  running = true;
  try {
    const pending = await fetchPending(limit);
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
};
