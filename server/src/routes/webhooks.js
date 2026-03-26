// server/src/routes/webhooks.js
//
// Webhook PIX da EFI (EfiPay).
// A EFI chama este endpoint quando um pagamento PIX é confirmado, eliminando
// o polling de 20s e garantindo confirmação em tempo real.
//
// Configuração na EFI:
//   1. Defina EFI_WEBHOOK_SECRET no .env (ex: um UUID aleatório)
//   2. Registre a URL na EFI via POST /api/companies/:id/gateway/webhook/register
//      O sistema registrará automaticamente: https://{dominio}/api/webhooks/pix/{secret}
//
// Segurança:
//   - A URL contém o secret como path param (obscuro por padrão)
//   - A EFI usa HTTPS com certificado válido do servidor (Traefik/Let's Encrypt)
//   - O secret pode ser rotacionado via .env + restart

const express = require('express');
const { processWebhookPayment } = require('../jobs/gateway-reconcile');
const { registerCompanyWebhook } = require('../services/payment-gateway');
const { requireAuth, companyScope } = require('./auth');
const logger = require('../utils/logger');

const router = express.Router();

// POST /api/webhooks/pix/:secret
// Recebe notificações de pagamento PIX da EFI
router.post('/pix/:secret', async (req, res) => {
  const expectedSecret = process.env.EFI_WEBHOOK_SECRET;

  // Se não há secret configurado, aceita qualquer chamada (menos seguro, mas funcional)
  if (expectedSecret && req.params.secret !== expectedSecret) {
    logger.warn({ ip: req.ip }, '[webhook] tentativa com secret inválido');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { pix } = req.body || {};

  // EFI também envia um request de teste sem body ao registrar — retorna 200
  if (!Array.isArray(pix) || pix.length === 0) {
    return res.status(200).json({ ok: true });
  }

  // Responde IMEDIATAMENTE — EFI aguarda no máximo 5 segundos
  res.status(200).json({ ok: true, received: pix.length });

  // Processa cada evento de forma assíncrona (sem bloquear o response)
  for (const event of pix) {
    const { txid, valor, horario, endToEndId } = event || {};
    if (!txid) continue;
    processWebhookPayment({ txid, valor, horario, endToEndId }).catch((err) =>
      logger.error({ err, txid }, '[webhook] erro ao processar evento PIX')
    );
  }
});

// POST /api/companies/:id/gateway/webhook/register
// Registra (ou re-registra) a URL do webhook na EFI para a empresa
router.post('/register/:companyId', requireAuth, companyScope(true), async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    const secret = process.env.EFI_WEBHOOK_SECRET;

    if (!secret) {
      return res.status(400).json({
        error: 'EFI_WEBHOOK_SECRET não configurado no servidor. Adicione ao .env e reinicie.',
      });
    }

    const baseUrl = process.env.APP_URL || process.env.ALLOWED_ORIGINS?.split(',')[0] || '';
    if (!baseUrl) {
      return res.status(400).json({ error: 'APP_URL não configurado no .env' });
    }

    const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/webhooks/pix/${secret}`;
    const result = await registerCompanyWebhook({ companyId, webhookUrl });

    logger.info({ companyId, webhookUrl }, '[webhook] URL registrada na EFI com sucesso');
    res.json({ ok: true, webhookUrl, result });
  } catch (err) {
    logger.error({ err, companyId: req.params.companyId }, '[webhook] falha ao registrar webhook na EFI');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
