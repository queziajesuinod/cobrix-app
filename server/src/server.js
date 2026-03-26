// =========================
// server.js
// =========================

// 1) Variáveis de ambiente
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const ENV_CANDIDATES = [
  '/app/server/.env',                       // caminho dentro do container
  path.resolve(__dirname, '../.env'),       // server/.env (execução local)
  path.resolve(__dirname, '../../.env'),    // raíz do projeto
];

for (const candidate of ENV_CANDIDATES) {
  try {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      break;
    }
  } catch (err) {
    console.warn('[env] Falha ao carregar', candidate, err.message);
  }
}

const express = require('express');
const cron = require('node-cron');

// 2) App base
const app = require('./app');

// 3) CRON JOBS
const { runDueOnly, runPreOnly, runLateOnly, runRenewOnly } = require('./jobs/billing-cron');
const { runGatewayReconcile } = require('./jobs/gateway-reconcile');
const { runNotificationRetry } = require('./jobs/notification-retry');
const { withCronLock } = require('./utils/cron-lock');
const logger = require('./utils/logger');

function scheduleCronJob(label, expression, job) {
  if (!expression) return;
  const options = process.env.CRON_TZ ? { timezone: process.env.CRON_TZ } : undefined;
  const tzLabel = options?.timezone ? ` tz=${options.timezone}` : '';
  logger.info({ job: label, expression, tz: options?.timezone }, `[CRON] agendando ${label} (${expression}${tzLabel})`);

  cron.schedule(expression, async () => {
    const start = Date.now();
    logger.info({ job: label }, `[CRON] iniciando ${label}`);
    try {
      // withCronLock garante que apenas 1 instância executa o job por vez
      await withCronLock(label, job);
      logger.info({ job: label, ms: Date.now() - start }, `[CRON] concluído ${label}`);
    } catch (err) {
      logger.error({ err, job: label, ms: Date.now() - start }, `[CRON] erro em ${label}`);
    }
  }, options);
}

// D0 - Due
scheduleCronJob('DUE',   process.env.CRON_DUE,               runDueOnly);
// D-4 - Pre
scheduleCronJob('PRE',   process.env.CRON_PRE,               runPreOnly);
// D+3 - Late
scheduleCronJob('LATE',  process.env.CRON_LATE,              runLateOnly);
// Renovação de contratos recorrentes
scheduleCronJob('RENEW', process.env.CRON_RENEW,             runRenewOnly);
// Retry de notificações falhas (padrão: a cada 30 min)
scheduleCronJob('RETRY', process.env.CRON_RETRY || '*/30 * * * *', runNotificationRetry);

// Polling de pagamentos como fallback do webhook.
// Com webhook ativo, este intervalo pode ser maior (padrão: 5 min).
// Sem webhook, mantenha em 20-60s para reconciliação rápida.
const gatewayPollMs = Number(process.env.GATEWAY_POLL_MS || 300000); // padrão 5 min
if (!Number.isNaN(gatewayPollMs) && gatewayPollMs > 0) {
  logger.info({ intervalMs: gatewayPollMs }, '[gateway-reconcile] poll de fallback ativo');
  setInterval(() => {
    runGatewayReconcile().catch(err =>
      logger.error({ err }, '[gateway-reconcile] erro no poll de fallback')
    );
  }, gatewayPollMs);
}

// 4) Servir o frontend buildado (procura dist/local public)
const candidateDirs = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../public'),
];

const staticDir = candidateDirs.find((dir) => {
  try { return fs.existsSync(path.join(dir, 'index.html')); } catch { return false; }
});

if (staticDir) {
  console.log('[static] Servindo frontend de', staticDir);
  app.use(express.static(staticDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(staticDir, 'index.html'));
  });
} else {
  console.warn('[static] Nenhum build do frontend encontrado. Rotas SPA podem falhar em refresh.');
}




// 5) Start do servidor
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  logger.info({
    port: PORT,
    schema: process.env.DB_SCHEMA || 'public',
    env: process.env.NODE_ENV || 'production',
    tz: process.env.TZ,
    webhook: process.env.EFI_WEBHOOK_SECRET ? 'configurado' : 'sem secret (inseguro)',
  }, `Servidor rodando na porta ${PORT}`);
});
