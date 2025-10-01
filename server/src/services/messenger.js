// server/src/services/messenger.js
const axios = require('axios');
const { query } = require('../db');

const SCHEMA = process.env.DB_SCHEMA || 'public';

function normUrl(u) { return String(u || '').replace(/\/+$/, ''); }
function normNumber(n, { forceCountry } = {}) {
  const digits = String(n || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (forceCountry && !digits.startsWith(forceCountry)) return `${forceCountry}${digits}`;
  return digits;
}

async function getCompanyEvoConfig(companyId) {
  // ⚠️ usa schema configurado
  const r = await query(
    `SELECT evo_api_url, evo_api_key FROM ${SCHEMA}.companies WHERE id=$1`,
    [Number(companyId)]
  );
  const row = r.rows[0] || {};
  return {
    url: row.evo_api_url || process.env.EVO_API_URL || '',
    key: row.evo_api_key || process.env.EVO_API_KEY || '',
  };
}

async function sendWhatsapp(companyId, payload, options = {}) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid)) throw new Error(`companyId inválido: ${companyId}`);

  const cfg = await getCompanyEvoConfig(cid);
  const url = normUrl(cfg.url);
  const number = normNumber(payload?.number, { forceCountry: options.forceCountry ?? '55' });
  const text = String(payload?.text ?? '');

  // logs úteis (não logar texto completo em prod se for sensível)
  console.log('[messenger] companyId=%s url=%s key?=%s number=%s textLen=%d',
    cid, url, cfg.key ? 'yes' : 'no', number, text.length
  );

  if (!url || !cfg.key) throw new Error('Config EVO ausente (url/key) para a empresa');
  if (!number) throw new Error('Número (payload.number) é obrigatório');
  if (!text) throw new Error('Texto (payload.text) é obrigatório');

  try {
    const res = await axios.post(
      url,
      { number, text },
      {
        headers: {
          'APIKEY': cfg.key,            // alguns proxies quebram case; mandamos os dois
          'apikey': cfg.key,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
        // descomente se houver problema de TLS no ambiente de teste (NÃO usar em prod):
        // httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
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

    console.error('[messenger] EVO error status=%s message=%s data=%j',
      status, message, data);

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

/**
 * Alias: aceita as DUAS assinaturas
 *   - sendTextMessage(companyId, { number, text })
 *   - sendTextMessage({ number, text, companyId })
 */
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
  sendTextMessage,
};