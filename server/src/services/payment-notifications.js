const { query } = require('../db');
const { sendWhatsapp } = require('./messenger');
const { sendBillingEmail } = require('./mailer');
const { msgPaid } = require('./message-templates');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const NOTIFICATION_TYPE = 'paid';
const NOTIFICATION_KIND = 'auto';

function encodeProviderResponse(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function fetchBillingSummary(billingId) {
  if (!billingId) return null;
  const r = await query(
    `SELECT b.id AS billing_id,
            b.contract_id,
            b.company_id,
            b.amount,
            b.billing_date,
            c.client_id,
            c.description AS contract_description,
            cl.id AS client_id_ref,
            cl.name AS client_name,
            cl.responsavel AS client_responsavel,
            cl.phone AS client_phone,
            cl.email AS client_email
       FROM ${SCHEMA}.billings b
       JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
       JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE b.id = $1`,
    [billingId]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    billing_id: row.billing_id,
    contract_id: row.contract_id,
    company_id: row.company_id,
    amount: row.amount,
    billing_date: row.billing_date,
    client_id: row.client_id_ref || row.client_id || null,
    client_name: row.client_name,
    client_responsavel: row.client_responsavel,
    client_phone: row.client_phone,
    client_email: row.client_email,
    contract_description: row.contract_description,
  };
}

async function hasPaidNotification(billingId) {
  if (!billingId) return false;
  const r = await query(
    `SELECT 1
       FROM ${SCHEMA}.billing_notifications
      WHERE billing_id = $1
        AND type = $2
      LIMIT 1`,
    [billingId, NOTIFICATION_TYPE]
  );
  return r.rowCount > 0;
}

async function savePaidNotification({
  companyId,
  billingId,
  contractId,
  clientId,
  toNumber,
  message,
  dueDate,
  evoResult,
  providerResponse,
}) {
  if (!companyId || !billingId || !contractId || !clientId) return;
  const status = evoResult?.ok ? 'sent' : 'failed';
  const targetDate = formatISODate(new Date()) || (dueDate ? formatISODate(dueDate) : null);
  const providerStatus = evoResult?.status ?? null;
  const providerResponseData = providerResponse ?? (evoResult?.data ?? null);
  const providerResponseJson = encodeProviderResponse(providerResponseData);
  const sentAt = evoResult?.ok ? new Date() : null;
  const dueDateValue = dueDate ? String(dueDate) : null;

  await query(
    `INSERT INTO ${SCHEMA}.billing_notifications
       (company_id, billing_id, contract_id, client_id, kind, target_date,
        status, provider, to_number, message, provider_status, provider_response,
        error, created_at, sent_at, type, due_date)
     VALUES
       ($1,$2,$3,$4,$5,$6,
        $7,'evo',$8,$9,$10,$11,
        $12,NOW(),$13,$5,$14)`,
    [
      Number(companyId),
      Number(billingId),
      Number(contractId),
      Number(clientId),
      NOTIFICATION_KIND,
      targetDate,
      status,
      String(toNumber || ''),
      String(message || ''),
      providerStatus,
      providerResponseJson,
      evoResult?.ok ? null : (evoResult?.error || null),
      sentAt,
      dueDateValue,
    ]
  );
}

function resolvePaymentDate(detail, explicitDate) {
  const candidates = [
    explicitDate,
    detail?.horarioLiquidacao,
    detail?.horario_liquidacao,
    detail?.horario,
    detail?.payment_date,
    detail?.paymentDate,
    detail?.payment_datetime,
    detail?.paymentDateTime,
    detail?.paid_at,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate instanceof Date) return candidate;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

async function notifyBillingPaid({
  billingId,
  companyId = null,
  detail = null,
  paymentDate = null,
  txid = null,
  amount = null,
  force = false,
}) {
  const summary = await fetchBillingSummary(billingId);
  if (!summary) {
    return { sent: false, skipped: true, reason: 'billing-not-found' };
  }
  if (companyId && Number(summary.company_id) !== Number(companyId)) {
    return { sent: false, skipped: true, reason: 'company-mismatch' };
  }
  // Precisa de ao menos um canal: telefone (WhatsApp) ou e-mail.
  if (!summary.client_phone && !summary.client_email) {
    return { sent: false, skipped: true, reason: 'no-channel' };
  }
  if (!force) {
    const alreadySent = await hasPaidNotification(summary.billing_id);
    if (alreadySent) {
      return { sent: false, skipped: true, reason: 'already-notified' };
    }
  }

  const dueDateObj = ensureDateOnly(summary.billing_date) || null;
  const mesRefDate = dueDateObj
    ? new Date(dueDateObj.getFullYear(), dueDateObj.getMonth(), 1)
    : null;
  const paidAt = resolvePaymentDate(detail || {}, paymentDate);
  const resolvedTxid = txid || detail?.txid || null;
  const resolvedAmount = amount != null ? amount : summary.amount;

  const text = await msgPaid({
    companyId: summary.company_id,
    client_name: summary.client_name,
    responsavel: summary.client_responsavel,
    client_responsavel: summary.client_responsavel,
    client_legal_name: summary.client_name,
    tipoContrato: summary.contract_description,
    contract_type: summary.contract_description,
    mesRefDate,
    vencimentoDate: dueDateObj,
    valor: resolvedAmount,
    payment_amount: resolvedAmount,
    payment_date: paidAt,
    payment_txid: resolvedTxid,
  });

  let evo = { ok: false, skipped: true, error: 'no-phone' };
  if (summary.client_phone) {
    try {
      evo = await sendWhatsapp(summary.company_id, { number: summary.client_phone, text });
    } catch (err) {
      evo = { ok: false, error: err.message };
    }
  }

  // Canal de e-mail (best-effort) — confirmação de pagamento também por e-mail.
  let email = { ok: false, skipped: true, error: 'no-email' };
  if (summary.client_email) {
    try {
      email = await sendBillingEmail(summary.company_id, {
        to: summary.client_email,
        type: 'paid',
        ctx: {
          client_name: summary.client_name,
          responsavel: summary.client_responsavel,
          tipoContrato: summary.contract_description,
          mesRefDate,
          vencimentoDate: dueDateObj,
          valor: resolvedAmount,
          payment_amount: resolvedAmount,
          payment_date: paidAt,
          payment_txid: resolvedTxid,
        },
      });
    } catch (err) {
      email = { ok: false, error: err.message };
    }
  }

  const providerResponse = {
    messenger: evo.data ?? null,
    messengerStatus: evo.status ?? null,
    email: { ok: Boolean(email.ok), status: email.status ?? null, error: email.error ?? null },
    gateway: detail ?? (resolvedTxid ? { txid: resolvedTxid } : null),
  };

  const anySent = Boolean(evo.ok || email.ok);
  await savePaidNotification({
    companyId: summary.company_id,
    billingId: summary.billing_id,
    contractId: summary.contract_id,
    clientId: summary.client_id,
    toNumber: summary.client_phone || summary.client_email || '',
    message: text,
    dueDate: dueDateObj ? formatISODate(dueDateObj) : null,
    evoResult: { ok: anySent, status: evo.status ?? (email.ok ? 200 : null), error: anySent ? null : (evo.error || email.error || null) },
    providerResponse,
  });

  return { sent: anySent, skipped: false, reason: null, response: { evo, email } };
}

module.exports = {
  notifyBillingPaid,
};
