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
const { runDueOnly, runPreOnly, runLateOnly } = require('./jobs/billing-cron');

// D0 - Due
if (process.env.CRON_DUE) {
  cron.schedule(process.env.CRON_DUE, () => {
    console.log(`[CRON] Executando DUE em ${new Date().toISOString()}`);
    runDueOnly().catch(err => console.error('CRON_DUE erro:', err));
  });
}

// D-3 - Pre
if (process.env.CRON_PRE) {
  cron.schedule(process.env.CRON_PRE, () => {
    console.log(`[CRON] Executando PRE em ${new Date().toISOString()}`);
    runPreOnly().catch(err => console.error('CRON_PRE erro:', err));
  });
}

// D+4 - Late
if (process.env.CRON_LATE) {
  cron.schedule(process.env.CRON_LATE, () => {
    console.log(`[CRON] Executando LATE em ${new Date().toISOString()}`);
    runLateOnly().catch(err => console.error('CRON_LATE erro:', err));
  });
}

// 4) Servir o frontend React buildado
// Os arquivos do React foram copiados para /app/server/public no Dockerfile
// 4) Servir o frontend React buildado (compatível com execução via Docker)
// 4) Servir o frontend React buildado (versão final compatível com Docker)
const publicDir = path.resolve(__dirname, '../public');

// Garante que o Express sirva os arquivos estáticos corretamente
app.use(express.static(publicDir));

// Redireciona todas as rotas não-API para o index.html do React
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});




// 5) Start do servidor
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Schema do banco: ${process.env.DB_SCHEMA || 'public'}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'production'}`);
});
