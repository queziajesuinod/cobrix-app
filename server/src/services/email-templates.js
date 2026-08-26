// server/src/services/email-templates.js
// Monta o e-mail de cobrança (assunto + HTML responsivo com CSS inline) a partir
// do mesmo contexto usado nas mensagens de WhatsApp. Reusa buildBindings para
// obter as variáveis (nome, valor, vencimento, PIX copia-e-cola, QR base64).
const { buildBindings, applyTemplate, getTemplatesForCompany, DEFAULT_TEMPLATES } = require('./message-templates');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Resolve o corpo (texto) do e-mail: template customizado da empresa ({tipo}_email)
// com fallback para o padrão. Retorna o texto já com os placeholders aplicados.
async function resolveEmailBody(type, bindings, companyId) {
  const key = `${type}_email`;
  let template = DEFAULT_TEMPLATES[key] || DEFAULT_TEMPLATES.pre_email;
  if (companyId) {
    try {
      const all = await getTemplatesForCompany(companyId);
      if (all && all[key]) template = all[key];
    } catch (_e) { /* usa o padrão */ }
  }
  return applyTemplate(template, bindings);
}

// Converte o texto do corpo em HTML (escapa e preserva quebras de linha).
const bodyToHtml = (text) => esc(text).replace(/\n/g, '<br>');

// Título/linha de acordo com o tipo de cobrança.
function headline(type, b) {
  const base = type === 'late'
    ? 'Cobrança em atraso'
    : type === 'due'
      ? 'Cobrança vence hoje'
      : type === 'paid'
        ? 'Pagamento confirmado'
        : 'Lembrete de cobrança';
  return base;
}

async function buildBillingEmail(ctx = {}, { type = 'pre', companyId = null } = {}) {
  const b = buildBindings(ctx);
  const isPaid = type === 'paid';
  const title = headline(type, b);
  const company = esc(b.company_name || 'GERO');
  const bodyText = await resolveEmailBody(type, b, companyId ?? ctx.companyId ?? ctx.company_id);
  const bodyHtml = bodyToHtml(bodyText);
  const amount = esc(b.payment_amount || b.amount || '');
  const dueDate = esc(b.due_date || '');
  const refMonth = esc([b.reference_month, b.reference_year].filter(Boolean).join('/'));
  const pixCode = b.payment_code || '';
  const pixQr = b.payment_qrcode || '';
  const pixKey = esc(b.pix_key || '');

  const subject = isPaid
    ? `Pagamento confirmado — ${b.company_name || 'GERO'}`
    : `Cobrança${refMonth ? ` ${refMonth}` : ''} — ${b.company_name || 'GERO'}`;

  const accent = isPaid ? '#2e7d32' : (type === 'late' ? '#c62828' : '#2065d1');

  const pixBlock = (!isPaid && (pixCode || pixQr)) ? `
    <tr><td style="padding:8px 24px 0;">
      <div style="border:1px solid #e3e8ef;border-radius:12px;padding:16px;background:#f8fafc;">
        <div style="font-weight:700;font-size:15px;color:#0f172a;margin-bottom:8px;">Pague com PIX</div>
        ${pixQr ? `<div style="text-align:center;margin:12px 0;"><img src="${pixQr}" alt="QR Code PIX" width="200" style="width:200px;max-width:100%;border-radius:8px;" /></div>` : ''}
        ${pixCode ? `
          <div style="font-size:12px;color:#64748b;margin-bottom:4px;">PIX copia e cola:</div>
          <div style="font-family:'Courier New',monospace;font-size:12px;word-break:break-all;background:#fff;border:1px solid #e3e8ef;border-radius:8px;padding:10px;color:#0f172a;">${esc(pixCode)}</div>
        ` : ''}
        ${(!pixQr && !pixCode && pixKey) ? `<div style="font-size:13px;">Chave PIX: <strong>${pixKey}</strong></div>` : ''}
        <div style="font-size:11px;color:#94a3b8;margin-top:8px;">Após o pagamento, a compensação pode levar alguns instantes.</div>
      </div>
    </td></tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
        <tr><td style="background:${accent};padding:20px 24px;">
          <div style="color:#ffffff;font-size:18px;font-weight:800;font-family:Arial,Helvetica,sans-serif;">${company}</div>
        </td></tr>
        <tr><td style="padding:24px 24px 8px;font-family:Arial,Helvetica,sans-serif;">
          <div style="font-size:20px;font-weight:800;color:#0f172a;">${esc(title)}</div>
          <div style="font-size:14px;color:#475569;margin-top:10px;line-height:1.6;">${bodyHtml}</div>
        </td></tr>
        <tr><td style="padding:8px 24px;font-family:Arial,Helvetica,sans-serif;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${amount ? `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Valor</td><td style="padding:6px 0;text-align:right;font-size:18px;font-weight:800;color:#0f172a;">${amount}</td></tr>` : ''}
            ${dueDate ? `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;">${isPaid ? 'Referente a' : 'Vencimento'}</td><td style="padding:6px 0;text-align:right;font-size:14px;font-weight:600;color:#0f172a;">${isPaid ? refMonth : dueDate}</td></tr>` : ''}
          </table>
        </td></tr>
        ${pixBlock}
        <tr><td style="padding:20px 24px 24px;font-family:Arial,Helvetica,sans-serif;">
          <div style="font-size:12px;color:#94a3b8;border-top:1px solid #eef2f7;padding-top:12px;">
            Este é um e-mail automático de ${company}. Em caso de dúvida, responda a esta mensagem.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // Texto simples de fallback (clientes sem HTML) — usa o mesmo corpo do template.
  const text = [
    bodyText,
    amount ? `Valor: ${b.payment_amount || b.amount}` : '',
    dueDate && !isPaid ? `Vencimento: ${b.due_date}` : '',
    pixCode ? `PIX copia e cola: ${pixCode}` : (pixKey ? `Chave PIX: ${b.pix_key}` : ''),
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

module.exports = { buildBillingEmail };
