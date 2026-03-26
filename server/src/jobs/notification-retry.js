// server/src/jobs/notification-retry.js
//
// Worker que reprocessa notificações WhatsApp que falharam (status='failed').
// Executa a cada CRON_RETRY (padrão: a cada 30 min). Respeita os limites:
//   - NOTIFICATION_MAX_RETRIES: máximo de tentativas por notificação (padrão: 3)
//   - NOTIFICATION_RETRY_WINDOW_HOURS: janela de tempo para tentar (padrão: 48h)
//   - NOTIFICATION_RETRY_BATCH: máximo de registros por execução (padrão: 50)
//
// Para não perder nenhuma mensagem, a mensagem já está salva no campo `message`
// da tabela billing_notifications — sem precisar reconstruí-la.

const { query } = require('../db');
const { sendWhatsapp } = require('../services/messenger');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const MAX_RETRIES = Number(process.env.NOTIFICATION_MAX_RETRIES || 3);
const RETRY_WINDOW_HOURS = Number(process.env.NOTIFICATION_RETRY_WINDOW_HOURS || 48);
const RETRY_BATCH = Number(process.env.NOTIFICATION_RETRY_BATCH || 50);

// Backoff exponencial: 1ª retry = 30 min, 2ª = 60 min, 3ª = 120 min
function retryDelayMinutes(retryCount) {
  return 30 * Math.pow(2, retryCount);
}

let running = false;

async function fetchFailedNotifications() {
  const r = await query(
    `SELECT id, company_id, contract_id, to_number, message, type, kind, due_date, retry_count
       FROM ${SCHEMA}.billing_notifications
      WHERE status = 'failed'
        AND retry_count < $1
        AND to_number IS NOT NULL AND to_number <> ''
        AND message   IS NOT NULL AND message   <> ''
        AND created_at > NOW() - ($2 * INTERVAL '1 hour')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at ASC
      LIMIT $3`,
    [MAX_RETRIES, RETRY_WINDOW_HOURS, RETRY_BATCH]
  );
  return r.rows;
}

async function markRetried(id, retryCount, evoResult) {
  const ok = Boolean(evoResult?.ok);
  const delayMin = retryDelayMinutes(retryCount);

  await query(
    `UPDATE ${SCHEMA}.billing_notifications
        SET status         = $2,
            retry_count    = retry_count + 1,
            sent_at        = CASE WHEN $3 THEN NOW() ELSE sent_at END,
            next_retry_at  = CASE WHEN $3 THEN NULL
                                  ELSE NOW() + ($4 * INTERVAL '1 minute')
                             END,
            error          = $5,
            provider_status = $6
      WHERE id = $1`,
    [
      id,
      ok ? 'sent' : 'failed',
      ok,
      delayMin,
      ok ? null : (evoResult?.error || null),
      evoResult?.status ?? null,
    ]
  );
}

async function runNotificationRetry() {
  if (running) return;
  running = true;
  try {
    const failed = await fetchFailedNotifications();
    if (failed.length === 0) return;

    console.log(`[RETRY] ${failed.length} notificação(ões) para reenviar`);

    for (const n of failed) {
      let evo = { ok: false, error: 'unknown' };
      try {
        evo = await sendWhatsapp(n.company_id, { number: n.to_number, text: n.message });
      } catch (err) {
        evo = { ok: false, error: err.message };
      }

      await markRetried(n.id, Number(n.retry_count), evo).catch((err) =>
        console.error(`[RETRY] Falha ao salvar retry #${n.id}:`, err.message)
      );

      console.log(
        `[RETRY] #${n.id} type=${n.type || n.kind} due=${n.due_date} retry=${Number(n.retry_count) + 1}/${MAX_RETRIES} -> ${evo.ok ? 'sent' : `failed(${evo.error || evo.status})`}`
      );
    }
  } catch (err) {
    console.error('[RETRY] Erro no worker de retry:', err.message);
  } finally {
    running = false;
  }
}

module.exports = { runNotificationRetry };
