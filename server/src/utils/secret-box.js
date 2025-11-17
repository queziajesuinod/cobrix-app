const crypto = require('crypto');

const RAW_SECRET =
  process.env.CREDENTIALS_SECRET ||
  process.env.SECRET_BOX_KEY ||
  process.env.APP_CREDENTIALS_KEY ||
  '';

function getKey() {
  const base = String(RAW_SECRET || '').trim();
  if (!base) {
    throw new Error('CREDENTIALS_SECRET n\u00e3o configurada para criptografar credenciais sens\u00edveis');
  }
  return crypto.createHash('sha256').update(base).digest();
}

function encryptSecret(value) {
  if (value == null || value === '') return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptSecret(payload, { allowMissingKey = false } = {}) {
  if (!payload) return null;
  let key;
  try {
    key = getKey();
  } catch (err) {
    if (allowMissingKey) return null;
    throw err;
  }
  const buffer = Buffer.from(String(payload), 'base64');
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = {
  encryptSecret,
  decryptSecret,
};
