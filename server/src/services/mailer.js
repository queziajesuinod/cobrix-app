// server/src/services/mailer.js
// Canal de e-mail por empresa (SMTP). Espelha o contrato de messenger.sendWhatsapp
// (retorna { ok, status, data, error }) para que o log em billing_notifications
// funcione igual ao WhatsApp. A senha SMTP fica cifrada (secret-box), como as
// credenciais Efí.
const nodemailer = require('nodemailer');
const { query } = require('../db');
const { decryptSecret } = require('../utils/secret-box');
const { buildBillingEmail } = require('./email-templates');

const SCHEMA = process.env.DB_SCHEMA || 'public';

async function getCompanyEmailConfig(companyId) {
  if (!companyId) return null;
  const r = await query(
    `SELECT email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc,
            email_from, email_secure, email_enabled
       FROM ${SCHEMA}.companies WHERE id=$1`,
    [companyId]
  );
  const row = r.rows[0];
  if (!row) return null;
  let pass = null;
  if (row.email_smtp_pass_enc) {
    try { pass = decryptSecret(row.email_smtp_pass_enc); }
    catch (e) { console.error('[mailer] falha ao descriptografar senha SMTP:', e.message); pass = null; }
  }
  return {
    host: row.email_smtp_host || null,
    port: row.email_smtp_port || null,
    user: row.email_smtp_user || null,
    pass,
    from: row.email_from || null,
    secure: Boolean(row.email_secure),
    enabled: Boolean(row.email_enabled),
  };
}

// Configurado = habilitado e com host/user/senha/remetente presentes.
async function isEmailConfigured(companyId) {
  const cfg = await getCompanyEmailConfig(companyId);
  return Boolean(cfg && cfg.enabled && cfg.host && cfg.user && cfg.pass && cfg.from);
}

// Envia um e-mail. Retorno no mesmo formato do sendWhatsapp.
async function sendEmail(companyId, { to, subject, html, text } = {}, options = {}) {
  if (!to) return { ok: false, skipped: true, error: 'destinatário ausente' };
  const cfg = options.config || await getCompanyEmailConfig(companyId);
  if (!cfg || !cfg.host || !cfg.user || !cfg.pass || !cfg.from) {
    return { ok: false, skipped: true, error: 'SMTP não configurado' };
  }
  const port = Number(cfg.port) || (cfg.secure ? 465 : 587);
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port,
      secure: cfg.secure != null ? cfg.secure : port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    const info = await transporter.sendMail({
      from: cfg.from,
      to,
      subject: subject || 'Notificação de cobrança',
      html: html || undefined,
      text: text || undefined,
    });
    return { ok: true, status: 200, data: { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected } };
  } catch (err) {
    console.error('[mailer] falha ao enviar e-mail', { companyId, to, message: err.message });
    return { ok: false, status: err.responseCode || 500, error: err.message };
  }
}

// Envia a cobrança por e-mail montando o HTML a partir do contexto (mesmo ctx
// das mensagens de WhatsApp). Best-effort: retorna { ok, skipped, error }.
// Enriquece com nome/chave PIX da empresa quando não vierem no ctx.
async function sendBillingEmail(companyId, { to, type = 'pre', ctx = {} } = {}) {
  if (!to) return { ok: false, skipped: true, error: 'destinatário sem e-mail' };
  const cfg = await getCompanyEmailConfig(companyId);
  if (!cfg || !cfg.enabled || !cfg.host || !cfg.user || !cfg.pass || !cfg.from) {
    return { ok: false, skipped: true, error: 'SMTP não configurado' };
  }
  let enriched = ctx;
  if (!ctx.company_name || !ctx.pix_key) {
    try {
      const r = await query(`SELECT name, pix_key FROM ${SCHEMA}.companies WHERE id=$1`, [companyId]);
      const row = r.rows[0] || {};
      enriched = { company_name: row.name, pix_key: row.pix_key, ...ctx };
    } catch (_e) { /* usa ctx como veio */ }
  }
  const { subject, html, text } = await buildBillingEmail(enriched, { type, companyId });
  return sendEmail(companyId, { to, subject, html, text }, { config: cfg });
}

module.exports = { sendEmail, sendBillingEmail, isEmailConfigured, getCompanyEmailConfig };
