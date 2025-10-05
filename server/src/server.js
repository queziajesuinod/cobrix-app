// =========================
// server.js
// =========================

// 1) Variáveis de ambiente
require('dotenv').config({ path: '/app/server/.env' }); 
const express = require('express');
const path = require('path');
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
app.use(express.static(path.join(__dirname, 'src', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'index.html'));
});


// 5) Start do servidor
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Schema do banco: ${process.env.DB_SCHEMA || 'public'}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'production'}`);
});
