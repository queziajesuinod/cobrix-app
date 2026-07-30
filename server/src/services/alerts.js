// server/src/services/alerts.js
// Alerta operacional push, agnóstico de canal. Se ALERT_WEBHOOK_URL estiver
// definido, faz POST de um JSON (compatível com Slack/Discord/n8n/Zapier).
// Sem a env, é no-op (o erro já é logado via pino no chamador).
const axios = require('axios');
const logger = require('../utils/logger');

async function sendOpsAlert(title, context = {}) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const payload = {
    // "text" é o campo que Slack/Discord usam para a mensagem principal.
    text: `[cobrix] ${title}`,
    title,
    source: 'cobrix',
    env: process.env.NODE_ENV || 'production',
    ...context,
    ts: new Date().toISOString(),
  };
  try {
    await axios.post(url, payload, { timeout: 5000 });
  } catch (err) {
    logger.warn({ err }, '[alert] falha ao enviar alerta operacional');
  }
}

module.exports = { sendOpsAlert };
