// server/src/utils/http-error.js
// Resposta de erro padronizada que NÃO vaza detalhes internos (mensagens do
// Postgres, nomes de coluna, SQL). Loga o erro completo no servidor e devolve
// uma mensagem segura ao cliente.
const logger = require('./logger');

function respondError(res, err, fallbackStatus = 500) {
  const status = Number.isInteger(err?.status) ? err.status : fallbackStatus;
  // 4xx são erros esperados do cliente (log em warn); 5xx são falhas do servidor.
  if (status >= 500) logger.error({ err }, '[http] erro interno na requisição');
  else logger.warn({ err: err?.message || err, status }, '[http] requisição rejeitada');
  // Erros de negócio/validação (4xx) podem expor a mensagem; 5xx viram genéricos.
  const message = status < 500 && err?.message ? err.message : 'Erro interno. Tente novamente.';
  if (!res.headersSent) res.status(status).json({ error: message });
}

// Middleware final do Express — captura throws e next(err) não tratados.
function errorHandler(err, _req, res, _next) {
  respondError(res, err);
}

module.exports = { respondError, errorHandler };
