// server/src/utils/payment-date.js
// Data de pagamento escolhida pelo usuário ao marcar uma cobrança como paga.
// Aceita 'YYYY-MM-DD' (opcional). Cria a data ao MEIO-DIA local para o
// gateway_paid_at::date ficar estável em qualquer fuso (evita o shift de UTC
// midnight que já mordeu a reconciliação — ver memória paid-contracts-revenue).
// Não permite data futura. Ausente → { date: null } (o chamador cai no NOW()).
function parsePaidAt(raw) {
  if (raw == null || String(raw).trim() === '') return { date: null };
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { error: 'Data de pagamento inválida' };
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return { error: 'Data de pagamento inválida' };
  }
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (date.getTime() > todayEnd.getTime()) return { error: 'A data de pagamento não pode ser futura' };
  return { date };
}

module.exports = { parsePaidAt };
