// server/src/services/pix-resolver.js
// Resolve o PIX de uma cobrança escolhendo a melhor fonte disponível:
//  1) Efí (PIX dinâmico, com baixa automática) quando a empresa tem gateway;
//  2) PIX estático (BR Code local a partir da chave PIX) como fallback;
//  3) null quando não há nem gateway nem chave PIX.
// Devolve sempre o mesmo shape { copyPaste, qrCodeImage, amount, ... } consumido
// por message-templates (payment_code / payment_qrcode).
const { query } = require('../db');
const { ensureGatewayPaymentLink } = require('./payment-gateway');
const { isGatewayConfigured } = require('./company-gateway');
const { buildStaticPix } = require('./pix-static');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const DEFAULT_CITY = process.env.PIX_MERCHANT_CITY || 'BRASIL';

// Reference label do PIX estático: alfanumérico, curto, referencia a cobrança.
function staticRef({ billingId, contractId }) {
  const base = billingId ? `FAT${billingId}` : contractId ? `CT${contractId}` : '';
  return String(base).replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
}

async function resolvePixPayment(args = {}) {
  const { companyId, contractId, billingId, amount } = args;
  if (!companyId) return null;

  // 1) Gateway Efí configurado → PIX dinâmico (com txid rastreável / webhook).
  try {
    if (await isGatewayConfigured(companyId)) {
      return await ensureGatewayPaymentLink(args);
    }
  } catch (err) {
    console.warn('[pix-resolver] falha ao checar/gerar gateway, tentando estático:', err.message);
  }

  // 2) Fallback estático a partir da chave PIX da empresa.
  try {
    const r = await query(
      `SELECT name, pix_key FROM ${SCHEMA}.companies WHERE id=$1`,
      [companyId]
    );
    const row = r.rows[0];
    if (!row || !row.pix_key) return null;
    return await buildStaticPix({
      pixKey: row.pix_key,
      merchantName: row.name,
      merchantCity: DEFAULT_CITY,
      amount,
      txid: staticRef({ billingId, contractId }),
    });
  } catch (err) {
    console.error('[pix-resolver] falha ao gerar PIX estático:', err.message);
    return null;
  }
}

module.exports = { resolvePixPayment };
