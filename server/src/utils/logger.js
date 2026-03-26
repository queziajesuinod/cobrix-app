// server/src/utils/logger.js
//
// Logger estruturado com pino. Em produção emite JSON (ideal para log aggregators).
// Para leitura human-friendly em desenvolvimento, instale pino-pretty como devDep
// e rode: node src/server.js | pino-pretty
//
// Uso:
//   const logger = require('../utils/logger');
//   logger.info({ companyId: 1 }, '[cron] rodando DUE');
//   logger.error({ err, txid }, '[webhook] falha ao processar PIX');

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { pid: process.pid, env: process.env.NODE_ENV || 'production' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Formata err/error automaticamente com stack trace
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

module.exports = logger;
