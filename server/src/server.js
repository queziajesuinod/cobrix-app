require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3001;

const cron = require('node-cron');
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


app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Schema do banco: ${process.env.DB_SCHEMA || 'public'}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});