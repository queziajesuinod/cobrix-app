const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EfiPay = require('sdk-node-apis-efi');
const { query } = require('../db');
const { getCompanyGatewayCredentials } = require('./company-gateway');
const { ensureDateOnly, addDays } = require('../utils/date-only');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const DEFAULT_EXPIRATION = Number(process.env.EFI_PIX_EXPIRATION || 86400); // 24h
const DEFAULT_PIX_SANDBOX = process.env.NODE_ENV === 'production' ? 'false' : 'true';
const EFI_SANDBOX = String(process.env.EFI_PIX_SANDBOX ?? DEFAULT_PIX_SANDBOX).toLowerCase() === 'true';

let cachedInlineCertPath = null;
const companyCertCache = new Map();

function resolveGlobalCertificate() {
  if (cachedInlineCertPath) return cachedInlineCertPath;
  const certPath = process.env.EFI_CERT_PATH;
  if (certPath && fs.existsSync(certPath)) {
    cachedInlineCertPath = certPath;
    return cachedInlineCertPath;
  }
  const certBase64 = process.env.EFI_CERT_BASE64;
  if (certBase64) {
    const buffer = Buffer.from(certBase64, 'base64');
    const tmpPath = path.join(os.tmpdir(), `efi-cert-${process.pid}-${Date.now()}.p12`);
    fs.writeFileSync(tmpPath, buffer);
    cachedInlineCertPath = tmpPath;
    return cachedInlineCertPath;
  }
  throw new Error('Configure EFI_CERT_PATH ou EFI_CERT_BASE64 com o certificado PIX da EfiPay');
}

function resolveCompanyCertificate(companyId, certBase64) {
  if (!companyId || !certBase64) return null;
  const hash = crypto.createHash('sha1').update(certBase64).digest('hex');
  const cached = companyCertCache.get(companyId);
  if (cached && cached.hash === hash && cached.path && fs.existsSync(cached.path)) {
    return cached.path;
  }
  const buffer = Buffer.from(certBase64, 'base64');
  const tmpPath = path.join(os.tmpdir(), `efi-cert-${companyId}-${Date.now()}.p12`);
  fs.writeFileSync(tmpPath, buffer);
  if (cached?.path) {
    try { fs.unlinkSync(cached.path); } catch {}
  }
  companyCertCache.set(companyId, { path: tmpPath, hash });
  return tmpPath;
}

function resolveCertificatePath({ companyId, certBase64 }) {
  if (certBase64) {
    return resolveCompanyCertificate(companyId, certBase64);
  }
  return resolveGlobalCertificate();
}

function buildClient({ companyId, clientId, clientSecret, certBase64 }) {
  if (!clientId || !clientSecret) {
    throw new Error('Credenciais do gateway incompletas');
  }
  const certificate = resolveCertificatePath({ companyId, certBase64 });
  const options = {
    sandbox: EFI_SANDBOX,
    client_id: clientId,
    client_secret: clientSecret,
    certificate,
  };
  return new EfiPay(options);
}

function trimDescription(description, contractId) {
  const base = description || `Contrato #${contractId}`;
  return base.length > 60 ? `${base.slice(0, 57)}...` : base;
}

function formatAmount(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return '0.01';
  return num.toFixed(2);
}

// Ensures the PIX expires two days after the billing due date.
function calculateExpirationSeconds(dueDate) {
  const due = ensureDateOnly(dueDate);
  if (!due) return DEFAULT_EXPIRATION;
  const target = addDays(due, 2);
  if (!target) return DEFAULT_EXPIRATION;
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return DEFAULT_EXPIRATION;
  return Math.ceil(diffMs / 1000);
}

function normalizeCopyPaste(value) {
  if (!value && value !== 0) return null;
  try {
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  } catch {
    return null;
  }
}

function readGatewayPayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
}

function selectCopyPaste(row) {
  const explicit = normalizeCopyPaste(row?.copy_paste);
  const payload = readGatewayPayload(row?.gateway_payload);
  const payloadCopy = normalizeCopyPaste(payload?.qrcode?.qrcode);

  if (!explicit) return payloadCopy;
  if (payloadCopy) {
    const explicitLooksShort = explicit.length < 30 || /^[0-9]+$/.test(explicit);
    const payloadLooksLonger = payloadCopy.length > Math.max(explicit.length, 30);
    if (explicitLooksShort && payloadLooksLonger) {
      return payloadCopy;
    }
  }
  return explicit;
}

function formatGatewayRow(row) {
  if (!row) return null;
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  return {
    id: row.id,
    txid: row.txid,
    locId: row.loc_id,
    paymentUrl: row.payment_link || null,
    copyPaste: selectCopyPaste(row),
    qrCodeImage: row.qr_code || null,
    amount: Number(row.amount || 0),
    expiresAt,
    expiresAtIso: expiresAt ? expiresAt.toISOString() : null,
  };
}

async function fetchExistingLink({ companyId, contractId, dueDate, billingId }) {
  const params = [companyId, contractId, dueDate];
  let sql = `SELECT * FROM ${SCHEMA}.billing_gateway_links WHERE company_id=$1 AND contract_id=$2 AND due_date=$3`;
  if (billingId) {
    params.push(billingId);
    sql += ` AND (billing_id IS NULL OR billing_id = $4)`;
  }
  const r = await query(sql, params);
  const row = r.rows[0] || null;
  if (row && billingId && !row.billing_id) {
    await query(`UPDATE ${SCHEMA}.billing_gateway_links SET billing_id=$1 WHERE id=$2`, [billingId, row.id]);
    row.billing_id = billingId;
  }
  return row;
}

function isValid(existing) {
  if (!existing) return false;
  if (!existing.payment_link && !existing.copy_paste) return false;
  if (!existing.expires_at) return true;
  return new Date(existing.expires_at).getTime() > Date.now();
}

async function storeGatewayLink(data) {
  const {
    companyId,
    contractId,
    billingId = null,
    dueDate,
    txid,
    locId,
    paymentLink,
    copyPaste,
    qrCode,
    amount,
    expiresAt,
    payload,
  } = data;

  const r = await query(
    `INSERT INTO ${SCHEMA}.billing_gateway_links
      (company_id, contract_id, billing_id, due_date, txid, loc_id, payment_link, copy_paste, qr_code, amount, status, expires_at, gateway_payload, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'generated',$11,$12,NOW())
     ON CONFLICT (company_id, contract_id, due_date)
     DO UPDATE SET
        txid=EXCLUDED.txid,
        loc_id=EXCLUDED.loc_id,
        payment_link=EXCLUDED.payment_link,
        copy_paste=EXCLUDED.copy_paste,
        qr_code=EXCLUDED.qr_code,
        amount=EXCLUDED.amount,
        status='generated',
        expires_at=EXCLUDED.expires_at,
        billing_id=COALESCE(EXCLUDED.billing_id, ${SCHEMA}.billing_gateway_links.billing_id),
        gateway_payload=EXCLUDED.gateway_payload,
        updated_at=NOW()
     RETURNING *`,
    [
      companyId,
      contractId,
      billingId != null ? Number(billingId) : null,
      dueDate,
      txid || null,
      locId,
      paymentLink || null,
      copyPaste || null,
      qrCode || null,
      Number(amount || 0),
      expiresAt || null,
      payload || null,
    ]
  );

  if (billingId && txid) {
    await query(
      `UPDATE ${SCHEMA}.billings
         SET gateway_txid=$1
       WHERE id=$2 AND (gateway_txid IS NULL OR gateway_txid <> $1)`,
      [txid, Number(billingId)]
    ).catch(() => {});
  }

  return r.rows[0];
}

async function createGatewayLink({
  companyId,
  contractId,
  billingId = null,
  dueDate,
  amount,
  contractDescription,
  clientName,
  clientDocument = {},
  credentials,
}) {
  const client = buildClient(credentials);
  const description = trimDescription(contractDescription, contractId);
  const expirationSeconds = calculateExpirationSeconds(dueDate);
  const body = {
    calendario: { expiracao: expirationSeconds },
    valor: { original: formatAmount(amount) },
    chave: credentials.pixKey,
    solicitacaoPagador: `Pagamento ${description} - venc ${dueDate}`,
  };
  if (clientName) {
    body.devedor = { nome: String(clientName).slice(0, 80) };
  } else {
    body.devedor = {};
  }
  const cpfDigits = clientDocument?.cpf ? String(clientDocument.cpf).replace(/\D+/g, '').slice(0, 11) : null;
  const cnpjDigits = clientDocument?.cnpj ? String(clientDocument.cnpj).replace(/\D+/g, '').slice(0, 14) : null;
  if (cpfDigits && cpfDigits.length === 11) {
    body.devedor.cpf = cpfDigits;
  } else if (cnpjDigits && cnpjDigits.length === 14) {
    body.devedor.cnpj = cnpjDigits;
  }
  if (Object.keys(body.devedor).length === 0) {
    delete body.devedor;
  }

  const charge = await client.pixCreateImmediateCharge({}, body);
  const locId = charge?.loc?.id || charge?.loc?.idCob;
  if (!locId) {
    throw new Error('Resposta do gateway sem location id');
  }
  const qrcode = await client.pixGenerateQRCode({ id: locId });
  const expiresSeconds = Number(charge?.calendario?.expiracao || expirationSeconds || DEFAULT_EXPIRATION);
  const expiresAt = new Date(Date.now() + expiresSeconds * 1000);

  const stored = await storeGatewayLink({
    companyId,
    contractId,
    billingId,
    dueDate,
    txid: charge?.txid || null,
    locId,
    paymentLink: charge?.loc?.location || qrcode?.linkVisualizacao || null,
    copyPaste: qrcode?.qrcode || null,
    qrCode: qrcode?.imagemQrcode || null,
    amount,
    expiresAt: expiresAt.toISOString(),
    payload: { charge, qrcode },
  });

  return stored;
}

async function ensureGatewayPaymentLink({
  companyId,
  contractId,
  billingId = null,
  amount,
  dueDate,
  contractDescription,
  clientName,
  clientDocument = {},
}) {
  try {
    const credentials = await getCompanyGatewayCredentials(companyId);
    if (!credentials?.clientId || !credentials?.clientSecret || !credentials?.pixKey) {
      console.warn('[gateway] credenciais incompletas para empresa %s (clientId? %s secret? %s pix? %s)',
        companyId,
        Boolean(credentials?.clientId),
        Boolean(credentials?.clientSecret),
        Boolean(credentials?.pixKey)
      );
      return null;
    }
    if (!credentials.certBase64 && !process.env.EFI_CERT_PATH && !process.env.EFI_CERT_BASE64) {
      console.warn('[gateway] Nenhum certificado configurado para empresa %s (nem específico, nem global)', companyId);
      return null;
    }
    const existing = await fetchExistingLink({ companyId, contractId, dueDate, billingId });
    if (isValid(existing)) {
      return formatGatewayRow(existing);
    }
    const record = await createGatewayLink({
      companyId,
      contractId,
      billingId,
      dueDate,
      amount,
      contractDescription,
      clientName,
      clientDocument,
      credentials,
    });
    return formatGatewayRow(record);
  } catch (err) {
    const msg = err?.message || err?.response?.data?.error || String(err);
    console.error('[gateway] Falha ao gerar link de pagamento:', msg);
    if (err?.stack) console.error(err.stack);
    return null;
  }
}

async function getChargeStatus({ companyId, txid }) {
  if (!companyId || !txid) {
    throw new Error('companyId e txid são obrigatórios');
  }
  const credentials = await getCompanyGatewayCredentials(companyId);
  if (!credentials?.clientId || !credentials?.clientSecret) {
    throw new Error('Credenciais do gateway incompletas');
  }
  if (!credentials.certBase64 && !process.env.EFI_CERT_PATH && !process.env.EFI_CERT_BASE64) {
    throw new Error('Certificado do gateway não configurado');
  }
  const client = buildClient(credentials);
  return client.pixDetailCharge({ txid });
}

module.exports = {
  ensureGatewayPaymentLink,
  getChargeStatus,
  formatGatewayRow,
};
