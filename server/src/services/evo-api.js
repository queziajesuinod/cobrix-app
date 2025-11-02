const axios = require('axios');

const BASE_RAW = process.env.EVO_API_URL || '';
const API_KEY = process.env.EVO_API_KEY || '';

function baseUrl() {
  if (!BASE_RAW) return '';
  const idx = BASE_RAW.indexOf('/message/');
  if (idx !== -1) return BASE_RAW.slice(0, idx);
  return BASE_RAW.replace(/\/+$/, '');
}

function buildSendUrl(instance) {
  const base = baseUrl();
  if (!base || !instance) return '';
  return `${base}/message/sendText/${encodeURIComponent(instance)}`;
}

async function evoRequest({ method = 'get', path = '', data = null, params = null, timeout = 15000 }) {
  const base = baseUrl();
  if (!base) throw new Error('EVO_API_URL não configurada');
  if (!API_KEY) throw new Error('EVO_API_KEY não configurada');

  const url = `${base}${path}`;
  console.log('[EVO] request', { method, url, hasKey: !!API_KEY, params, hasData: !!data });
  try {
    const config = {
      method,
      url,
      params,
      timeout,
      headers: {
        'APIKEY': API_KEY,
        'apikey': API_KEY,
        'Authorization': `Bearer ${API_KEY}`,
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

async function createInstance(instanceName) {
  const data = await evoRequest({
    method: 'post',
    path: '/instance/create',
    data: {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    },
  });
  return data;
}

async function getConnectionState(instanceName) {
  const data = await evoRequest({
    method: 'get',
    path: `/instance/connectionState/${encodeURIComponent(instanceName)}`,
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

async function restartInstance(instanceName) {
  const data = await evoRequest({
    method: 'post',
    path: `/instance/restart/${encodeURIComponent(instanceName)}`,
    data: { qrcode: true },
  });
  return normalizeQrResponse(instanceName, data);
}

async function connectInstance(instanceName) {
  const data = await evoRequest({
    method: 'post',
    path: `/instance/connect/${encodeURIComponent(instanceName)}`,
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

  return {
    connectionStatus: state,
    instance: data?.instance ?? { instanceName, state },
    qrcode,
    code: data?.code ?? data?.instance?.code ?? null,
    pairingCode: data?.pairingCode ?? data?.instance?.pairingCode ?? null,
    raw: data,
  };
}

module.exports = {
  baseUrl,
  buildSendUrl,
  createInstance,
  getConnectionState,
  restartInstance,
  connectInstance,
  formatInstanceName,
};
