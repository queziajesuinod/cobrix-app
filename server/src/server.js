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

function scheduleCronJob(label, expression, job) {
  if (!expression) return;
  const options = process.env.CRON_TZ ? { timezone: process.env.CRON_TZ } : undefined;
  const tzLabel = options?.timezone ? ` tz=${options.timezone}` : '';
  console.log(`[CRON] Agendando ${label} (${expression}${tzLabel})`);
  cron.schedule(expression, async () => {
    console.log(`[CRON] Executando ${label} em ${new Date().toISOString()}`);
    try {
      await job();
    } catch (err) {
      console.error(`[CRON_${label}] erro:`, err);
    }
  }, options);
}

// D0 - Due
scheduleCronJob('DUE', process.env.CRON_DUE, runDueOnly);

// D-3 - Pre
scheduleCronJob('PRE', process.env.CRON_PRE, runPreOnly);

// D+4 - Late
scheduleCronJob('LATE', process.env.CRON_LATE, runLateOnly);

scheduleCronJob('RENEW', process.env.CRON_RENEW, runRenewOnly);

const gatewayPollMs = Number(process.env.GATEWAY_POLL_MS || 20000);
if (!Number.isNaN(gatewayPollMs) && gatewayPollMs > 0) {
  console.log('[gateway-reconcile] Poll ativo a cada %d ms', gatewayPollMs);
  setInterval(() => {
    runGatewayReconcile().catch(err => console.error('[gateway-reconcile] erro:', err));
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
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Schema do banco: ${process.env.DB_SCHEMA || 'public'}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'production'}`);
});
