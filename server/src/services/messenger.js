// server/src/services/messenger.js (texto apenas)
const axios = require('axios');
const { query } = require('../db');
const { buildSendUrl, baseUrl } = require('./evo-api');

const SCHEMA = process.env.DB_SCHEMA || 'public';

// Throttle de envios por empresa (instância EVO) para evitar bloqueio por flood do
// WhatsApp. Aplicado somente quando sendWhatsapp é chamado com { throttle: true }
// (crons de cobrança). O envio manual (sem a flag) sai na hora, sem espera.
// Intervalo configurável via NOTIFY_DELAY_MS (ms); padrão = 2 minutos.
const THROTTLE_MS = Number(process.env.NOTIFY_DELAY_MS ?? 120000);
// Atraso CURTO entre os balões de um MESMO envio (mensagem em camadas). Distinto
// do THROTTLE_MS acima, que espaça envios entre clientes diferentes (anti-flood).
// Padrão: 2s — tempo suficiente para o WhatsApp preservar a ordem dos balões.
const STEP_DELAY_MS = Number(process.env.NOTIFY_STEP_DELAY_MS ?? 2000);
const _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const _lastSendAt = new Map(); // companyId -> timestamp (ms) do último envio
const _chains = new Map();     // companyId -> Promise (fila serializada por empresa)

async function withThrottle(companyId, fn) {
  const prev = _chains.get(companyId) || Promise.resolve();
  const run = prev.then(async () => {
    const last = _lastSendAt.get(companyId) || 0;
    const wait = THROTTLE_MS - (Date.now() - last);
    if (wait > 0) {
      console.log(`[messenger] throttle: aguardando ${Math.round(wait / 1000)}s antes do envio (empresa ${companyId})`);
      await _sleep(wait);
    }
    try {
      return await fn();
    } finally {
      _lastSendAt.set(companyId, Date.now());
    }
  });
  // Mantém a fila viva mesmo que um envio falhe.
  _chains.set(companyId, run.then(() => {}, () => {}));
  return run;
}

function normUrl(u) { return String(u || '').replace(/\/+$/, ''); }
function normNumber(n, { forceCountry } = {}) {
  const digits = String(n || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (forceCountry && !digits.startsWith(forceCountry)) return `${forceCountry}${digits}`;
  return digits;
}

async function getCompanyEvoConfig(companyId) {
  const r = await query(
    `SELECT evo_api_url, evo_api_key, evo_instance FROM ${SCHEMA}.companies WHERE id=$1`,
    [Number(companyId)]
  );
  const row = r.rows[0] || {};
  const base = baseUrl();
  const instanceUrl = row.evo_instance ? buildSendUrl(row.evo_instance) : null;
  return {
    url: row.evo_api_url || instanceUrl || process.env.EVO_API_URL || '',
    key: row.evo_api_key || process.env.EVO_API_KEY || '',
    instance: row.evo_instance || null,
    baseUrl: base,
  };
}

// Resolve config/URL/número da empresa uma única vez (reusado pelo envio simples
// e pelo envio em sequência). Lança em caso de configuração inválida.
async function resolveSendTarget(companyId, payload, options = {}) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid)) throw new Error(`companyId inválido: ${companyId}`);

  const cfg = await getCompanyEvoConfig(cid);
  let url = cfg.instance ? normUrl(buildSendUrl(cfg.instance)) : normUrl(cfg.url);
  if (!url && cfg.instance) {
    url = normUrl(buildSendUrl(cfg.instance));
  }
  const number = normNumber(payload?.number, { forceCountry: options.forceCountry ?? '55' });

  if (!url || !cfg.key) throw new Error('Config EVO ausente (url/key) para a empresa');
  if (cfg.instance && !url.includes('/message/sendText/')) {
    throw new Error('Instância EVO inválida para envio (URL incorreta)');
  }
  if (!number) throw new Error('Número (payload.number) é obrigatório');

  return { cid, cfg, url, number };
}

// Faz um POST de texto no EVO. Retorna sempre um objeto de resultado (nunca
// rejeita) para que o chamador consiga registrar sucesso/falha.
async function postText({ url, key, number, text }) {
  try {
    const res = await axios.post(
      url,
      { number, text },
      {
        headers: {
          'APIKEY': key,
          'apikey': key,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );
    return {
      ok: true,
      status: res.status,
      data: res.data,
      requestUrl: url,
      payload: { number, textLen: text.length },
    };
  } catch (err) {
    const status = err.response?.status ?? null;
    const data = err.response?.data ?? null;
    const message = err.message || 'EVO request failed';
    console.error('[messenger] EVO error status=%s message=%s data=%j', status, message, data);
    return {
      ok: false,
      status,
      data,
      error: message,
      requestUrl: url,
      payload: { number, textLen: text.length },
    };
  }
}

async function sendWhatsapp(companyId, payload, options = {}) {
  const { cid, cfg, url, number } = await resolveSendTarget(companyId, payload, options);
  const text = String(payload?.text ?? '');

  console.log('[messenger] companyId=%s url=%s instance=%s key?=%s number=%s textLen=%d',
    cid, url, cfg.instance || '-', cfg.key ? 'yes' : 'no', number, text.length
  );

  if (!text) throw new Error('Texto (payload.text) é obrigatório');

  const doSend = () => postText({ url, key: cfg.key, number, text });

  // Crons de cobrança chamam com { throttle: true } → serializa e espaça por empresa.
  if (options.throttle && THROTTLE_MS > 0) {
    return withThrottle(cid, doSend);
  }
  return doSend();
}

// Consolida o resultado de uma sequência de balões num formato compatível com
// sendWhatsapp (ok/status/data/error), para a camada de persistência não mudar.
function aggregateSequence(results, url, number, total) {
  const ok = results.length === total && results.every((r) => r.ok);
  const failed = results.find((r) => !r.ok) || null;
  const last = results[results.length - 1] || {};
  return {
    ok,
    status: failed ? failed.status : (last.status ?? null),
    data: results.map((r) => r.data ?? null),
    error: ok ? null : (failed?.error || 'sequence-failed'),
    requestUrl: url,
    payload: { number, balloons: total, sent: results.filter((r) => r.ok).length },
    sequence: true,
    results,
  };
}

// Envia uma mensagem em CAMADAS: cada item de `payload.segments` vira um balão
// separado, na ordem dada, com um atraso curto (STEP_DELAY_MS) entre eles.
// Útil para mandar o Pix copia e cola sozinho, fácil de copiar. Se um balão
// falha, aborta os seguintes (não manda o código sem o balão de contexto).
// Toda a sequência roda dentro de UM slot de throttle por empresa.
async function sendWhatsappSequence(companyId, payload, options = {}) {
  const segments = (payload?.segments || [])
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length > 0);

  // 0 ou 1 balão → envio simples (mantém compat e o mesmo formato de retorno).
  if (segments.length <= 1) {
    const text = segments[0] ?? String(payload?.text ?? '');
    return sendWhatsapp(companyId, { number: payload?.number, text }, options);
  }

  const { cid, cfg, url, number } = await resolveSendTarget(companyId, payload, options);
  const stepDelay = Number(options.stepDelayMs ?? STEP_DELAY_MS);

  console.log('[messenger] sequence companyId=%s number=%s balloons=%d stepDelay=%dms',
    cid, number, segments.length, stepDelay
  );

  const runSequence = async () => {
    const results = [];
    for (let i = 0; i < segments.length; i++) {
      if (i > 0 && stepDelay > 0) await _sleep(stepDelay);
      const res = await postText({ url, key: cfg.key, number, text: segments[i] });
      results.push(res);
      if (!res.ok) break; // aborta os balões seguintes
    }
    return aggregateSequence(results, url, number, segments.length);
  };

  if (options.throttle && THROTTLE_MS > 0) {
    return withThrottle(cid, runSequence);
  }
  return runSequence();
}

async function sendTextMessage(a, b, options = {}) {
  let companyId, payload;
  if (typeof a === 'object' && a !== null && ('number' in a || 'text' in a)) {
    payload = { number: a.number, text: a.text };
    companyId = a.companyId ?? a.company_id;
  } else {
    companyId = a;
    payload = b;
  }
  return sendWhatsapp(companyId, payload, options);
}

module.exports = {
  getCompanyEvoConfig,
  sendWhatsapp,
  sendWhatsappSequence,
  sendTextMessage,
};
