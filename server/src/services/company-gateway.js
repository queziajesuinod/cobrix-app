const { query } = require('../db');
const { encryptSecret, decryptSecret } = require('../utils/secret-box');

const SCHEMA = process.env.DB_SCHEMA || 'public';

function normalize(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function mapGatewayResponse(row = {}) {
  const {
    efi_client_id_enc,
    efi_client_secret_enc,
    efi_cert_base64_enc,
    ...rest
  } = row;
  const clientId = efi_client_id_enc ? decryptSafe(efi_client_id_enc, { allowMissingKey: true }) : null;
  const clientSecret = efi_client_secret_enc ? decryptSafe(efi_client_secret_enc, { allowMissingKey: true }) : null;
  return {
    ...rest,
    gateway_client_id: clientId,
    gateway_client_secret: clientSecret,
    gateway_has_secret: Boolean(efi_client_secret_enc),
    gateway_cert_uploaded: Boolean(efi_cert_base64_enc),
  };
}

function decryptSafe(payload, { allowMissingKey = false } = {}) {
  try {
    return decryptSecret(payload, { allowMissingKey });
  } catch (err) {
    if (allowMissingKey) {
      console.warn('[gateway] N\u00e3o foi poss\u00edvel descriptografar credencial (retornando vazio):', err.message);
      return null;
    }
    console.error('[gateway] Falha ao descriptografar credential:', err.message);
    throw err;
  }
}

function buildGatewayUpdate({
  clientIdInput,
  clientSecretInput,
  certificateBase64Input,
  currentClientIdEnc = null,
  currentSecretEnc = null,
  currentCertEnc = null,
}) {
  let clientIdEnc = currentClientIdEnc;
  let clientSecretEnc = currentSecretEnc;
  let certBase64Enc = currentCertEnc;

  if (clientIdInput !== undefined) {
    const normalizedId = normalize(clientIdInput);
    if (!normalizedId) {
      clientIdEnc = null;
      clientSecretEnc = null;
    } else {
      clientIdEnc = encryptSecret(normalizedId);
      if (clientSecretInput === undefined && !currentSecretEnc) {
        throw new Error('gateway_client_secret obrigatório para configurar o gateway');
      }
    }
  }

  if (clientSecretInput !== undefined) {
    if (clientIdInput === undefined && !clientIdEnc) {
      throw new Error('Informe gateway_client_id ao atualizar o secret do gateway');
    }
    const normalizedSecret = normalize(clientSecretInput);
    if (!normalizedSecret) {
      throw new Error('gateway_client_secret não pode ser vazio');
    }
    clientSecretEnc = encryptSecret(normalizedSecret);
  }

  if (certificateBase64Input !== undefined) {
    const normalizedCert = normalize(certificateBase64Input);
    certBase64Enc = normalizedCert ? encryptSecret(normalizedCert) : null;
  }

  return { clientIdEnc, clientSecretEnc, certBase64Enc };
}

async function getCompanyGatewayCredentials(companyId) {
  if (!companyId) return null;
  const r = await query(
    `SELECT pix_key, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM ${SCHEMA}.companies WHERE id=$1`,
    [companyId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const clientId = row.efi_client_id_enc ? decryptSafe(row.efi_client_id_enc) : null;
  const clientSecret = row.efi_client_secret_enc ? decryptSafe(row.efi_client_secret_enc) : null;
  const certBase64 = row.efi_cert_base64_enc ? decryptSafe(row.efi_cert_base64_enc) : null;
  return {
    companyId,
    clientId,
    clientSecret,
    pixKey: row.pix_key || null,
    certBase64,
  };
}

async function isGatewayConfigured(companyId) {
  if (!companyId) return false;
  const r = await query(
    `SELECT pix_key, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM ${SCHEMA}.companies WHERE id=$1`,
    [companyId]
  );
  if (!r.rowCount) return false;
  const row = r.rows[0];
  const hasBaseCert = Boolean(row.efi_cert_base64_enc);
  const hasEnvCert = Boolean(process.env.EFI_CERT_PATH || process.env.EFI_CERT_BASE64);
  return Boolean(row.pix_key && row.efi_client_id_enc && row.efi_client_secret_enc && (hasBaseCert || hasEnvCert));
}

module.exports = {
  mapGatewayResponse,
  buildGatewayUpdate,
  getCompanyGatewayCredentials,
  isGatewayConfigured,
};
