// server/src/utils/cron-lock.js
//
// Lock distribuído usando PostgreSQL Advisory Locks.
// Garante que apenas UMA instância do servidor execute cada cron job por vez.
// Sem Redis, sem dependência externa — usa o próprio banco.
//
// Como funciona:
//   - pg_try_advisory_lock(id) tenta adquirir o lock na sessão atual
//   - Retorna true se adquiriu, false se outra sessão já tem o lock
//   - O lock é liberado automaticamente quando a conexão é fechada/liberada
//
// Uso:
//   const { withCronLock } = require('../utils/cron-lock');
//   await withCronLock('DUE', async () => { await runDueOnly(); });

const { pool } = require('../db');
const logger = require('./logger');

// Converte um nome em um inteiro de 32 bits estável (para usar como lock key)
function nameToLockId(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Converte para int32
  }
  // pg_try_advisory_lock aceita bigint — usa o hash como número positivo
  return Math.abs(hash);
}

/**
 * Executa `fn` protegida por advisory lock.
 * Se outra instância já estiver rodando o mesmo job, retorna sem executar.
 *
 * @param {string} name - Nome único do job (ex: 'CRON_DUE')
 * @param {Function} fn  - Função async a executar sob o lock
 */
async function withCronLock(name, fn) {
  const lockId = nameToLockId(`cobrix:cron:${name}`);
  const client = await pool.connect();

  try {
    const r = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [lockId]);
    const acquired = r.rows[0]?.acquired;

    if (!acquired) {
      logger.warn({ job: name, lockId }, '[cron-lock] job já em execução em outra instância, pulando');
      return;
    }

    logger.debug({ job: name, lockId }, '[cron-lock] lock adquirido');

    try {
      await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockId]).catch(() => {});
      logger.debug({ job: name }, '[cron-lock] lock liberado');
    }
  } finally {
    client.release();
  }
}

module.exports = { withCronLock };
