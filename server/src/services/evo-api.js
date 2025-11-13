const axios = require('axios');

const BASE_RAW = process.env.EVO_API_URL || '';
const API_KEY = process.env.EVO_API_KEY || '';

function resolveBase(raw) {
  if (!raw) return '';
  let base = String(raw).trim();
  if (!base) return '';
  const idx = base.indexOf('/message/');
  if (idx !== -1) base = base.slice(0, idx);
  return base.replace(/\/+$/, '');
}

function baseUrl() {
  return resolveBase(BASE_RAW);
}

function buildSendUrl(instance) {
  const base = baseUrl();
  if (!base || !instance) return '';
  return `${base}/message/sendText/${encodeURIComponent(instance)}`;
}

function decodeMaybeBase64(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return null;

  // já é um código legível (apenas números, letras, hífens)
  if (/^[0-9A-Za-z\-]{4,}$/.test(raw)) return raw;

  const isBase64 = /^[A-Za-z0-9+/=]+$/.test(raw) && raw.length % 4 === 0;
  if (!isBase64) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const reencoded = Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '');
    if (raw.replace(/=+$/, '') === reencoded) {
      return decoded;
    }
  } catch (err) {
    console.warn('[EVO] falha ao decodificar base64 de pairing code', err.message);
  }
  return raw;
}

function normalizePairingCode(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizePairingCode(item)).filter(Boolean).join('-') || null;
  }
  if (typeof raw === 'object') {
    return normalizePairingCode(raw.code || raw.value || raw.number || raw.pairingCode || raw[0] || null);
  }
  if (typeof raw === 'string' && raw.includes(',')) {
    return raw
      .split(',')
      .map((chunk) => normalizePairingCode(chunk))
      .filter(Boolean)
      .join('-') || null;
  }
  const val = decodeMaybeBase64(String(raw));
  return val ? val.trim() : null;
}

async function evoRequest({
  method = 'get',
  path = '',
  data = null,
  params = null,
  timeout = 15000,
  baseOverride = null,
  apiKeyOverride = null,
}) {
  const base = baseOverride || baseUrl();
  const key = apiKeyOverride || API_KEY;
  if (!base) throw new Error('EVO_API_URL não configurada');
  if (!key) throw new Error('EVO_API_KEY não configurada');

  const url = `${base}${path}`;
  console.log('[EVO] request', { method, url, hasKey: !!key, params, hasData: !!data });
  try {
    const config = {
      method,
      url,
      params,
      timeout,
      headers: {
        'APIKEY': key,
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      transformResponse: [(raw) => {
        if (raw == null) return null;
        let trimmed = String(raw).trim();
        if (!trimmed) return null;

        const lower = trimmed.toLowerCase();
        if (lower === 'null') return null;

        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
          trimmed = trimmed.slice(1, -1).trim();
        }
        if (!trimmed) return null;

        const normalized = trimmed.replace(/'/g, '"');
        try {
          return JSON.parse(normalized);
        } catch {
          return normalized;
        }
      }],
    };

    if (data != null && method.toLowerCase() !== 'get' && method.toLowerCase() !== 'head') {
      config.data = data;
    }

    const res = await axios(config);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const responseData = err.response?.data;
    console.error('[EVO] error', {
      method,
      url,
      status,
      data: responseData,
      message: err.message,
    });
    let message = err.message || 'Falha ao acessar WhatsApp ';
    if (responseData && typeof responseData === 'object') {
      message = responseData?.error || responseData?.message || message;
    } else if (typeof responseData === 'string' && responseData.trim().length) {
      message = responseData.trim();
    }
    const error = new Error(message || 'Falha ao acessar WhatsApp ');
    error.status = status;
    error.data = responseData ?? null;
    throw error;
  }
}

function formatInstanceName(name, suffix = '') {
  if (!name) return suffix ? `COMPANY_${suffix}` : 'COMPANY';
  const normalized = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = normalized || 'COMPANY';
  return suffix ? `${base}_${suffix}` : base;
}

async function createInstance(instanceName, options = {}) {
  const data = await evoRequest({
    method: 'post',
    path: '/instance/create',
    data: {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    },
    ...options,
  });
  return data;
}

async function getConnectionState(instanceName, options = {}) {
  const data = await evoRequest({
    method: 'get',
    path: `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    params: { pairingCode: true },
    ...options,
  });
  if (data == null || data === 'null') {
    return {
      connectionStatus: 'unknown',
      instance: { instanceName, state: 'unknown' },
      raw: null,
    };
  }

  const state =
    data?.instance?.state ??
    data?.state ??
    data?.connectionStatus ??
    'unknown';

  return {
    connectionStatus: state,
    instance: data?.instance ?? { instanceName, state },
    raw: data,
  };
}

async function restartInstance(instanceName, options = {}) {
  const data = await evoRequest({
    method: 'post',
    path: `/instance/restart/${encodeURIComponent(instanceName)}`,
    data: { qrcode: true, pairingCode: true },
    ...options,
  });
  return normalizeQrResponse(instanceName, data);
}

async function connectInstance(instanceName, options = {}) {
  const data = await evoRequest({
    method: 'get',
    path: `/instance/connect/${encodeURIComponent(instanceName)}`,
    data: { pairingCode: true },
    ...options,
  });
  return normalizeQrResponse(instanceName, data);
}

async function getQrCode(instanceName, options = {}) {
  const data = await evoRequest({
    method: 'get',
    path: `/instance/qrcode/${encodeURIComponent(instanceName)}`,
    params: { pairingCode: true },
    ...options,
  });
  return normalizeQrResponse(instanceName, data);
}

function normalizeQrResponse(instanceName, data) {
  if (data == null || data === 'null') {
    return {
      connectionStatus: 'unknown',
      instance: { instanceName, state: 'unknown' },
      qrcode: null,
      code: null,
      pairingCode: null,
      raw: null,
    };
  }

  const state =
    data?.instance?.state ??
    data?.state ??
    data?.connectionStatus ??
    'pending';

  const qrcode =
    data?.base64 ??
    data?.qrcode ??
    data?.instance?.qrcode ??
    data?.data?.base64 ??
    data?.data?.qrcode ??
    null;

  const rawPairing =
    data?.pairingCode ??
    data?.instance?.pairingCode ??
    data?.data?.pairingCode ??
    data?.data?.pairing_code ??
    null;

  const pairingCode = normalizePairingCode(rawPairing);

  return {
    connectionStatus: state,
    instance: data?.instance ?? { instanceName, state },
    qrcode,
    code: decodeMaybeBase64(data?.code ?? data?.instance?.code ?? data?.data?.code ?? null),
    pairingCode,
    raw: data,
  };
}

module.exports = {
  baseUrl,
  resolveBase,
  buildSendUrl,
  createInstance,
  getConnectionState,
  restartInstance,
  connectInstance,
  getQrCode,
  formatInstanceName,
};
