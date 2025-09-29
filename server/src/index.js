const http = require('http');
const cron = require('node-cron');
const app = require('./app');
const { runPreOnly, runDueOnly, runLateOnly, generateBillingsForToday } = require('./jobs/billing-cron');

const PORT = process.env.PORT || 3001;
const TZ   = process.env.CRON_TZ || process.env.TZ || 'America/Campo_Grande';

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});

// ---- CRON SCHEDULES ----
// Você pode controlar por ENV:
// CRON_PRE, CRON_GENERATE, CRON_DUE, CRON_LATE

const CRON_PRE       = process.env.CRON_PRE       || '0 8 * * *';   // D-3, às 08:00
const CRON_GENERATE  = process.env.CRON_GENERATE  || '10 8 * * *';  // gera billing do dia, 08:10
const CRON_DUE       = process.env.CRON_DUE       || '48 11 * * *';  // D0, às 11:40
const CRON_LATE      = process.env.CRON_LATE      || '0 10 * * *';  // D+4, às 10:00

cron.schedule(CRON_PRE, async () => {
  console.log('[CRON] PRE'); 
  await runPreOnly(new Date());
}, { timezone: TZ });

cron.schedule(CRON_GENERATE, async () => {
  console.log('[CRON] GENERATE'); 
  await generateBillingsForToday(new Date());
}, { timezone: TZ });

cron.schedule(CRON_DUE, async () => {
  console.log('[CRON] DUE'); 
  await runDueOnly(new Date());
}, { timezone: TZ });

cron.schedule(CRON_LATE, async () => {
  console.log('[CRON] LATE'); 
  await runLateOnly(new Date());
}, { timezone: TZ });

// Encerramento gracioso (se já existir closeDb, use)
process.on('SIGINT', () => {
  console.log('Recebido SIGINT. Encerrando...');
  server.close(() => {
    console.log('HTTP server fechado.');
    process.exit(0);
  });
});
