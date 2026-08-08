// server/src/services/pix-static.js
// PIX estático (BR Code / padrão EMV® do Banco Central) montado localmente a
// partir da chave PIX da empresa — sem depender da API da Efí. Não há baixa
// automática (sem txid rastreável no gateway): a confirmação é manual.
// Retorna o mesmo shape de formatGatewayRow (payment-gateway.js) para encaixar
// direto nas bindings de template: { copyPaste, qrCodeImage, amount, static }.
const QRCode = require('qrcode');

// ---- Sanitização de texto para os campos EMV (ASCII, sem acento) ----
function sanitizeText(value, maxLen) {
  // NFD separa os acentos em combining chars; o filtro ASCII abaixo os remove.
  const s = String(value || '')
    .normalize('NFD')
    .replace(/[^\x20-\x7E]/g, '')         // só ASCII imprimível (tira acentos e emojis)
    .trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

// ---- Normaliza a chave PIX (texto livre) para a forma crua exigida no EMV ----
// Heurística: e-mail e EVP (UUID) passam como estão; CPF (11) / CNPJ (14) viram
// só dígitos; telefone (prefixo + ou 55) vira +55DDNNNNNNNNN.
function normalizePixKey(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.includes('@')) return s.toLowerCase();
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) {
    return s.toLowerCase();
  }
  const digits = s.replace(/\D+/g, '');
  if (s.startsWith('+') || /^55\d{10,11}$/.test(digits)) {
    const local = digits.replace(/^55/, '');
    return `+55${local}`;
  }
  if (digits.length === 11 || digits.length === 14) return digits; // CPF / CNPJ
  return s; // fallback: usa como veio
}

// ---- TLV (id + length 2 dígitos + value) ----
function tlv(id, value) {
  const v = String(value == null ? '' : value);
  const len = String(v.length).padStart(2, '0');
  return `${id}${len}${v}`;
}

// ---- CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF) sobre a string, 4 hex maiúsc ----
function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

// ---- Monta o "copia e cola" (BR Code) ----
function buildCopyPaste({ pixKey, merchantName, merchantCity, amount, txid }) {
  const key = normalizePixKey(pixKey);
  if (!key) throw new Error('Chave PIX ausente ou inválida');

  const gui = tlv('00', 'br.gov.bcb.pix');
  const merchantAccount = tlv('26', `${gui}${tlv('01', key)}`);

  const name = sanitizeText(merchantName, 25) || 'RECEBEDOR';
  const city = sanitizeText(merchantCity, 15) || 'BRASIL';
  const ref = sanitizeText(txid, 25) || '***';
  const additionalData = tlv('62', tlv('05', ref));

  const amt = formatAmount(amount);

  let payload =
    tlv('00', '01') +            // Payload Format Indicator
    tlv('01', '11') +            // Point of Initiation Method (11 = estático/reutilizável)
    merchantAccount +
    tlv('52', '0000') +         // Merchant Category Code
    tlv('53', '986') +          // Moeda (BRL)
    (amt ? tlv('54', amt) : '') + // Valor (opcional)
    tlv('58', 'BR') +           // País
    tlv('59', name) +           // Nome do recebedor
    tlv('60', city) +           // Cidade
    additionalData;

  payload += '6304';            // id+len do CRC, sobre o qual o CRC é calculado
  const crc = crc16(payload);
  return payload + crc;
}

// ---- API principal: devolve copyPaste + QR base64 (mesmo shape do gateway) ----
async function buildStaticPix({ pixKey, merchantName, merchantCity, amount, txid }) {
  const copyPaste = buildCopyPaste({ pixKey, merchantName, merchantCity, amount, txid });
  let qrCodeImage = null;
  try {
    qrCodeImage = await QRCode.toDataURL(copyPaste, { margin: 1, width: 320 });
  } catch (err) {
    // QR é best-effort — o copia-e-cola sozinho já resolve o pagamento.
    qrCodeImage = null;
  }
  return {
    copyPaste,
    qrCodeImage,
    amount: Number(amount) || null,
    static: true,
  };
}

module.exports = { buildStaticPix, buildCopyPaste, normalizePixKey, crc16 };
