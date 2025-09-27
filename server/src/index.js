require('dotenv').config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env' });
const http = require('http');
const app = require('./app');
const { closeDb } = require('./db');

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

// CRON – agendar PRE / DUE / LATE em horários distintos
// npm i node-cron (se ainda não instalou)
const cron = require('node-cron');
const { runPreOnly, runDueOnly, runLateOnly } = require('./jobs/billing-cron');

// Evita agendar 2x em dev (nodemon)
function startCron() {
  if (global.__CRON_STARTED__) return;
  global.__CRON_STARTED__ = true;

  if (process.env.CRON_DISABLED === '1') {
    console.log('[CRON] desabilitado por CRON_DISABLED=1');
    return;
  }

  const TZ = process.env.CRON_TZ || process.env.TZ || 'America/Campo_Grande';

  // Defina os horários via .env se quiser (abaixo são defaults):
  const PRE  = process.env.CRON_PRE  || '0 8 * * *';  // D-3 (08:00)
  const DUE  = process.env.CRON_DUE  || '10 11 * * *'; // D0  (08:16) <- seu pedido
  const LATE = process.env.CRON_LATE || '0 10 * * *'; // D+4 (10:00)

  cron.schedule(PRE,  () => { console.log('[CRON] PRE');  runPreOnly(new Date()); },  { timezone: TZ });
  cron.schedule(DUE,  () => { console.log('[CRON] DUE');  runDueOnly(new Date()); },  { timezone: TZ });
  cron.schedule(LATE, () => { console.log('[CRON] LATE'); runLateOnly(new Date()); }, { timezone: TZ });

  console.log(`[CRON] agendado: PRE=${PRE} DUE=${DUE} LATE=${LATE} TZ=${TZ}`);
}

startCron();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});


function shutdown(sig) {
  console.log(`\nRecebido ${sig}. Encerrando...`);
  server.close(async () => {
    console.log('HTTP server fechado.');
    await closeDb();
    console.log('Pool PG encerrado.');
    process.exit(0);
  });
}
['SIGINT','SIGTERM'].forEach(s => process.on(s, () => shutdown(s)));
