const { query } = require('../db');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');

const SCHEMA = process.env.DB_SCHEMA || 'public';

const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function dd(n) { return String(n).padStart(2, '0'); }
function formatPtDate(value) {
  const d = ensureDateOnly(value);
  if (!d) return '';
  const dia = dd(d.getDate());
  const mes = meses[d.getMonth()] || '';
  const ano = d.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

function moneyBR(v) {
  if (v == null || Number.isNaN(Number(v))) return '';
  const fixed = Number(v).toFixed(2);
  return `R$ ${fixed.replace('.', ',')}`;
}

function formatPtDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${dd(date.getDate())}/${dd(date.getMonth() + 1)}/${date.getFullYear()} ${dd(date.getHours())}:${dd(date.getMinutes())}`;
}

const DEFAULT_TEMPLATES = {
  pre: `Olá {{client_name}}, tudo bem?

Gostaríamos de lembrar que o vencimento referente ao {{contract_type}} do mês de {{reference_month}} está programado para o dia {{due_date}}, no valor de {{amount}}.

Para sua comodidade, seguem os dados para o pagamento:

PIX: {{pix_key}}

Caso precise de alguma informação adicional, não hesite em nos procurar. Estamos à disposição para ajudá-lo.

Agradecemos pela confiança em nossos serviços e seguimos à disposição para o que for necessário.

Atenciosamente,
Equipe Financeira
{{company_name}}`,

  pre_gateway: `Olá {{client_name}}, tudo bem?

Seu {{contract_type}} referente ao mês de {{reference_month}} vencerá em {{due_date}}, no valor de {{amount}}.

Para sua comodidade, o código Pix copia e cola vai na próxima mensagem — é só copiar e pagar. 🙂

Ficamos à disposição caso precise de algo.

Atenciosamente,
Equipe Financeira
{{company_name}}

{{quebra}}

{{payment_code}}`,

  due: `Olá {{client_name}}, tudo bem?

Lembrete: o pagamento referente ao {{contract_type}} do mês de {{reference_month}} vence HOJE ({{due_date}}), no valor de {{amount}}.

PIX: {{pix_key}}

Qualquer dúvida, fale com a gente.

Atenciosamente,
Equipe Financeira
{{company_name}}`,

  due_gateway: `Olá {{client_name}}, tudo bem?

Seu pagamento do {{contract_type}} ({{reference_month}}) vence HOJE, {{due_date}}, no valor de {{amount}}.

Envio o código Pix copia e cola na próxima mensagem — é só copiar e pagar.

Qualquer dúvida, fale com a gente.

Atenciosamente,
Equipe Financeira
{{company_name}}

{{quebra}}

{{payment_code}}`,

  late: `Olá {{client_name}}, tudo bem?

Identificamos que o pagamento referente ao {{contract_type}} do mês de {{reference_month}} está em ATRASO desde {{due_date}}. Valor: {{amount}}.

PIX: {{pix_key}}

Se já realizou o pagamento, por favor desconsidere esta mensagem. Caso contrário, estamos à disposição para ajudar.

Atenciosamente,
Equipe Financeira
{{company_name}}`,

  late_gateway: `Olá {{client_name}}, tudo bem?

Percebemos que o pagamento do {{contract_type}} ({{reference_month}}) está em atraso desde {{due_date}}. Valor: {{amount}}.

Para regularizar, o código Pix copia e cola vai na próxima mensagem. Se já pagou, desconsidere esta mensagem.

Qualquer dúvida, fale conosco.

Atenciosamente,
Equipe Financeira
{{company_name}}

{{quebra}}

{{payment_code}}`,

  paid: `Olá {{client_name}}, tudo bem?

Recebemos o pagamento referente ao {{contract_type}} de {{reference_month}} (vencimento em {{due_date}}) no valor de {{amount}}.

Pagamento confirmado em {{payment_date}}.

Obrigado pela parceria!

Atenciosamente,
Equipe Financeira
{{company_name}}`,

  // ===== Corpo (texto) dos e-mails de cobrança. O valor, vencimento, PIX e QR
  // Code são adicionados automaticamente pelo layout HTML — aqui é só a mensagem.
  pre_email: `Olá {{client_name}}, tudo bem?

Passando para lembrar que a sua cobrança referente ao {{contract_type}} ({{reference_month}}) vence em {{due_date}}.

Você pode pagar de forma rápida pelo PIX abaixo. Qualquer dúvida, é só responder este e-mail.

Atenciosamente,
{{company_name}}`,

  due_email: `Olá {{client_name}}, tudo bem?

Sua cobrança referente ao {{contract_type}} ({{reference_month}}) vence HOJE, {{due_date}}.

Para manter tudo em dia, pague pelo PIX abaixo. Estamos à disposição!

Atenciosamente,
{{company_name}}`,

  late_email: `Olá {{client_name}}, tudo bem?

Identificamos que a cobrança referente ao {{contract_type}} ({{reference_month}}), vencida em {{due_date}}, ainda está em aberto.

Para regularizar, pague pelo PIX abaixo. Se já tiver pago, por favor desconsidere este e-mail.

Atenciosamente,
{{company_name}}`,

  paid_email: `Olá {{client_name}}, tudo bem?

Confirmamos o recebimento do pagamento referente ao {{contract_type}} ({{reference_month}}).

Obrigado pela parceria! 💚

Atenciosamente,
{{company_name}}`,
};

DEFAULT_TEMPLATES.due_weekly = DEFAULT_TEMPLATES.due;
DEFAULT_TEMPLATES.due_weekly_gateway = DEFAULT_TEMPLATES.due_gateway;
DEFAULT_TEMPLATES.late_weekly = DEFAULT_TEMPLATES.late;
DEFAULT_TEMPLATES.late_weekly_gateway = DEFAULT_TEMPLATES.late_gateway;
DEFAULT_TEMPLATES.due_custom = DEFAULT_TEMPLATES.due;
DEFAULT_TEMPLATES.due_custom_gateway = DEFAULT_TEMPLATES.due_gateway;
DEFAULT_TEMPLATES.late_custom = DEFAULT_TEMPLATES.late;
DEFAULT_TEMPLATES.late_custom_gateway = DEFAULT_TEMPLATES.late_gateway;

const PLACEHOLDERS = [
  { key: 'client_name', label: 'Nome do destinatário', example: 'Maria Souza' },
  { key: 'client_responsible', label: 'Responsável pelo cliente', example: 'João Pereira' },
  { key: 'client_legal_name', label: 'Nome oficial do cliente', example: 'Empresa XPTO Ltda' },
  { key: 'contract_type', label: 'Descrição do contrato', example: 'Consultoria Contábil' },
  { key: 'reference_month', label: 'Mês de referência (extenso)', example: 'setembro' },
  { key: 'reference_month_number', label: 'Mês de referência (número)', example: '09' },
  { key: 'reference_year', label: 'Ano de referência', example: '2024' },
  { key: 'due_date', label: 'Data de vencimento (dd/mês/aaaa)', example: '25/setembro/2024' },
  { key: 'due_date_iso', label: 'Data de vencimento (YYYY-MM-DD)', example: '2024-09-25' },
  { key: 'amount', label: 'Valor formatado (R$)', example: 'R$ 1234,56' },
  { key: 'pix_key', label: 'Chave PIX', example: '11.222.333/0001-44' },
  { key: 'company_name', label: 'Nome da empresa', example: 'Teifelt Contabilidade' },
  { key: 'payment_date', label: 'Data em que o pagamento foi confirmado', example: '26/setembro/2024' },
  { key: 'payment_date_iso', label: 'Data ISO do pagamento', example: '2024-09-26' },
  { key: 'payment_amount', label: 'Valor pago formatado', example: 'R$ 123,45' },
  { key: 'payment_txid', label: 'TXID informado pelo Pix', example: '123e4567...' },
  { key: 'current_date', label: 'Data de hoje (dd/mês/aaaa)', example: '10/setembro/2024' },
  { key: 'current_date_iso', label: 'Data de hoje (YYYY-MM-DD)', example: '2024-09-10' },
  { key: 'payment_link', label: 'Link de pagamento (gateway)', example: 'https://pagamento.seusite.com/pix/abc123' },
  { key: 'payment_code', label: 'Pix copia e cola', example: '0002010102122687...' },
  { key: 'payment_qrcode', label: 'QR Code em base64', example: 'data:image/png;base64,...' },
  { key: 'payment_expires_at', label: 'Expira em (dd/mm/aaaa hh:mm)', example: '25/09/2025 23:59' },
  { key: 'payment_expires_at_iso', label: 'Expira em (ISO8601)', example: '2025-09-25T23:59:00Z' },
  { key: 'quebra', label: 'Quebra de mensagem (inicia um novo balão no WhatsApp)', example: '' },
];

// Marcador que divide o template em vários balões de WhatsApp. Cada trecho entre
// marcadores vira uma mensagem separada, enviada em sequência com um pequeno
// atraso — útil para mandar o Pix copia e cola sozinho, fácil de copiar.
// No e-mail e em qualquer render de string única o marcador é apenas removido.
const SEGMENT_TOKEN_RE = /\{\{\s*quebra\s*\}\}/gi;

const CACHE_TTL_MS = 60_000;
const templateCache = new Map();
const companyNameCache = new Map();
const companyPixCache = new Map();
const DEFAULT_PIX_KEY = process.env.PIX_CHAVE || 'SUA_CHAVE_PIX';

function makeCacheKey(companyId, type) {
  const cid = companyId ? Number(companyId) : 0;
  return `${cid}:${type}`;
}

function storeCache(map, key, value) {
  map.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

function readCache(map, key) {
  const entry = map.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  map.delete(key);
  return null;
}

function clearTemplateCache(companyId, type) {
  if (type) templateCache.delete(makeCacheKey(companyId, type));
  else {
    const cid = companyId ? Number(companyId) : 0;
    for (const key of templateCache.keys()) {
      if (key.startsWith(`${cid}:`)) templateCache.delete(key);
    }
  }
}

function clearCompanyCache(companyId) {
  if (!companyId) return;
  companyNameCache.delete(`company:${companyId}`);
  companyPixCache.delete(`pix:${companyId}`);
}

async function getCompanyName(companyId) {
  if (!companyId) return 'Teifelt Contabilidade';
  const cached = readCache(companyNameCache, `company:${companyId}`);
  if (cached) return cached;
  const r = await query(`SELECT name FROM ${SCHEMA}.companies WHERE id=$1`, [companyId]);
  const name = r.rows[0]?.name || 'Teifelt Contabilidade';
  storeCache(companyNameCache, `company:${companyId}`, name);
  return name;
}

async function getCompanyPix(companyId) {
  if (!companyId) return DEFAULT_PIX_KEY;
  const cached = readCache(companyPixCache, `pix:${companyId}`);
  if (cached != null) return cached;
  const r = await query(`SELECT pix_key FROM ${SCHEMA}.companies WHERE id=$1`, [companyId]);
  const pix = r.rows[0]?.pix_key || DEFAULT_PIX_KEY;
  storeCache(companyPixCache, `pix:${companyId}`, pix);
  return pix;
}

async function loadTemplate(companyId, type) {
  const cacheKey = makeCacheKey(companyId, type);
  const cached = readCache(templateCache, cacheKey);
  if (cached != null) return cached;

  if (companyId) {
    const r = await query(
      `SELECT template FROM ${SCHEMA}.message_templates WHERE company_id=$1 AND type=$2`,
      [companyId, type]
    );
    if (r.rowCount) {
      const tpl = r.rows[0].template;
      storeCache(templateCache, cacheKey, tpl);
      return tpl;
    }
  }
  const fallback = DEFAULT_TEMPLATES[type] || '';
  storeCache(templateCache, cacheKey, fallback);
  return fallback;
}

function applyTemplate(template, values = {}) {
  if (!template) return '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key] ?? '';
    }
    return '';
  });
}

function buildBindings(ctx = {}) {
  const mesRefDate = ensureDateOnly(ctx.mesRefDate || ctx.referenceDate);
  const vencimentoDate = ensureDateOnly(ctx.vencimentoDate || ctx.dueDate);
  const now = ensureDateOnly(ctx.now) || new Date();
  const responsible = ctx.responsavel || ctx.client_responsavel || ctx.client_responsible || ctx.nome || ctx.client_name;
  const clientLegalName =
    ctx.client_legal_name ||
    ctx.client_name ||
    ctx.nome_cliente ||
    ctx.contractClientName ||
    ctx.clientName ||
    '';

  const paymentLink =
    ctx.payment_link ||
    ctx.paymentLink ||
    ctx.gateway_payment_link ||
    '';
  const paymentCode =
    ctx.payment_code ||
    ctx.paymentCode ||
    ctx.payment_copy_paste ||
    ctx.payment_code_payload ||
    '';
  const paymentQr =
    ctx.payment_qrcode ||
    ctx.payment_qr_code ||
    ctx.gateway_payment_qrcode ||
    '';
  const paymentExpiresIso =
    ctx.payment_expires_at_iso ||
    ctx.gateway_payment_expires_at_iso ||
    '';
  const paymentExpiresDisplay =
    ctx.payment_expires_at ||
    (paymentExpiresIso ? formatPtDateTime(paymentExpiresIso) : '');
  const paymentDateValue =
    ctx.payment_date ||
    ctx.paymentDate ||
    ctx.payment_date_iso ||
    ctx.paymentDateIso ||
    ctx.payment_datetime ||
    ctx.paymentDateTime ||
    ctx.payment_confirmed_at ||
    ctx.payment_confirmed_at_iso ||
    ctx.gateway_payment_paid_at ||
    '';
  let paymentDateObj = null;
  if (paymentDateValue) {
    if (paymentDateValue instanceof Date) {
      paymentDateObj = paymentDateValue;
    } else {
      const parsedPaymentDate = new Date(paymentDateValue);
      if (!Number.isNaN(parsedPaymentDate.getTime())) paymentDateObj = parsedPaymentDate;
    }
  }

  return {
    client_name: responsible || clientLegalName || '',
    client_responsible: responsible || '',
    client_legal_name: clientLegalName || '',
    contract_type: ctx.tipoContrato || ctx.contract_type || '',
    reference_month: mesRefDate ? (meses[mesRefDate.getMonth()] || '') : '',
    reference_month_number: mesRefDate ? dd(mesRefDate.getMonth() + 1) : '',
    reference_year: mesRefDate ? String(mesRefDate.getFullYear()) : '',
    due_date: vencimentoDate ? formatPtDate(vencimentoDate) : '',
    due_date_iso: vencimentoDate ? formatISODate(vencimentoDate) : '',
    amount: ctx.valor != null ? moneyBR(ctx.valor) : '',
    pix_key: ctx.pix || ctx.pix_key || '',
    company_name: ctx.empresa || ctx.company_name || '',
    current_date: formatPtDate(now),
    current_date_iso: now.toISOString().slice(0, 10),
    payment_link: paymentLink,
    payment_code: paymentCode,
    payment_qrcode: paymentQr,
    payment_expires_at: paymentExpiresDisplay,
    payment_expires_at_iso: paymentExpiresIso,
    payment_date: paymentDateObj ? formatPtDateTime(paymentDateObj) : '',
    payment_date_iso: paymentDateObj ? paymentDateObj.toISOString() : '',
    payment_amount: ctx.payment_amount != null ? moneyBR(ctx.payment_amount) : (ctx.valor != null ? moneyBR(ctx.valor) : ''),
    payment_txid: ctx.payment_txid || ctx.gateway_payment_txid || ctx.txid || '',
  };
}

// Carrega o template do tipo e monta os bindings a partir do contexto. Reusado
// tanto pelo render de string única quanto pelo render segmentado (balões).
async function prepareRender(type, ctx = {}) {
  const companyId =
    ctx.companyId ??
    ctx.company_id ??
    ctx.contractCompanyId ??
    ctx.company ??
    null;

  const companyName = ctx.empresa || ctx.company_name || await getCompanyName(companyId);
  const pix = ctx.pix || ctx.pix_key || await getCompanyPix(companyId);
  const template = await loadTemplate(companyId, type);
  const gatewayPayment = ctx.gatewayPayment || null;
  const paymentCtx = {};
  if (gatewayPayment) {
    if (!ctx.payment_link && gatewayPayment.paymentUrl) paymentCtx.payment_link = gatewayPayment.paymentUrl;
    if (!ctx.payment_code && gatewayPayment.copyPaste) paymentCtx.payment_code = gatewayPayment.copyPaste;
    if (!ctx.payment_qrcode && gatewayPayment.qrCodeImage) paymentCtx.payment_qrcode = gatewayPayment.qrCodeImage;
    if (!ctx.payment_expires_at_iso && gatewayPayment.expiresAtIso) paymentCtx.payment_expires_at_iso = gatewayPayment.expiresAtIso;
  }
  const bindings = buildBindings({ ...ctx, ...paymentCtx, empresa: companyName, pix, pix_key: pix });
  return { template, bindings };
}

// Divide o template no marcador {{quebra}} ANTES de aplicar as variáveis (o
// applyTemplate apagaria o token por ser uma variável desconhecida). Aplica os
// bindings em cada trecho, remove espaços nas pontas e descarta segmentos
// vazios (ex.: balão do Pix quando não há copia e cola disponível).
function splitTemplateSegments(template, bindings) {
  if (!template) return [];
  return String(template)
    .split(SEGMENT_TOKEN_RE)
    .map((part) => applyTemplate(part, bindings).trim())
    .filter((part) => part.length > 0);
}

// Junta segmentos já renderizados preservando o marcador {{quebra}}, para gravar
// uma única coluna `message` de onde o retry consegue reconstruir os balões.
function joinSegmentsWithMarker(segments) {
  return (segments || []).filter(Boolean).join('\n\n{{quebra}}\n\n');
}

// Divide uma mensagem JÁ renderizada (com o marcador literal {{quebra}}) de volta
// em balões. Usado pelo worker de retry, que reenvia o texto salvo no banco.
// Sem marcador (mensagens antigas) retorna um único balão.
function splitRenderedSegments(message) {
  if (!message) return [];
  return String(message)
    .split(SEGMENT_TOKEN_RE)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// Render em texto único (compatível com o comportamento antigo). Se o template
// tiver {{quebra}}, os segmentos são unidos por linha em branco.
async function renderMessage(type, ctx = {}) {
  const { template, bindings } = await prepareRender(type, ctx);
  const segments = splitTemplateSegments(template, bindings);
  return segments.join('\n\n');
}

// Render em segmentos: um item por balão de WhatsApp, na ordem do template.
async function renderMessageSegments(type, ctx = {}) {
  const { template, bindings } = await prepareRender(type, ctx);
  return splitTemplateSegments(template, bindings);
}

function hasGatewayContext(ctx = {}) {
  return Boolean(
    ctx.gatewayPayment ||
    ctx.gatewayPaymentLink ||
    ctx.payment_link ||
    ctx.payment_code
  );
}

function normalizeBillingMode(value) {
  const mode = String(value || '').toLowerCase();
  if (mode === 'interval_days') return 'interval_days';
  if (mode === 'custom_dates') return 'custom_dates';
  return 'monthly';
}

function resolveTemplateType(kind, ctx = {}) {
  const mode = normalizeBillingMode(ctx.billing_mode || ctx.billingMode || ctx.mode);
  const hasGateway = hasGatewayContext(ctx);
  let suffix = '';
  if (kind !== 'pre') {
    if (mode === 'interval_days') suffix = '_weekly';
    else if (mode === 'custom_dates') suffix = '_custom';
  }
  return `${kind}${suffix}${hasGateway ? '_gateway' : ''}`;
}

async function msgPre(ctx) {
  const type = resolveTemplateType('pre', ctx);
  return renderMessage(type, ctx);
}
async function msgDue(ctx) {
  const type = resolveTemplateType('due', ctx);
  return renderMessage(type, ctx);
}
async function msgLate(ctx) {
  const type = resolveTemplateType('late', ctx);
  return renderMessage(type, ctx);
}
async function msgPaid(ctx) {
  return renderMessage('paid', ctx);
}

// Variantes segmentadas (uma mensagem por balão) para o envio em camadas no
// WhatsApp. Mesma resolução de tipo das versões de string única.
async function msgPreSegments(ctx) {
  return renderMessageSegments(resolveTemplateType('pre', ctx), ctx);
}
async function msgDueSegments(ctx) {
  return renderMessageSegments(resolveTemplateType('due', ctx), ctx);
}
async function msgLateSegments(ctx) {
  return renderMessageSegments(resolveTemplateType('late', ctx), ctx);
}

async function getTemplatesForCompany(companyId) {
  const result = { ...DEFAULT_TEMPLATES };
  if (!companyId) return result;

  const rows = await query(
    `SELECT type, template FROM ${SCHEMA}.message_templates WHERE company_id=$1`,
    [companyId]
  );
  for (const row of rows.rows) {
    if (row.type && row.template != null) result[row.type] = row.template;
  }
  return result;
}

async function upsertTemplate(companyId, type, template, userId = null) {
  if (!companyId) throw new Error('companyId obrigatório');
  const clean = String(template ?? '').trim();
  await query(
    `INSERT INTO ${SCHEMA}.message_templates (company_id, type, template, created_by, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$4,now())
     ON CONFLICT (company_id, type)
     DO UPDATE SET template=EXCLUDED.template, updated_by=$4, updated_at=now()`,
    [companyId, type, clean, userId]
  );
  clearTemplateCache(companyId, type);
}

module.exports = {
  meses,
  formatPtDate,
  DEFAULT_TEMPLATES,
  PLACEHOLDERS,
  msgPre,
  msgDue,
  msgLate,
  msgPaid,
  msgPreSegments,
  msgDueSegments,
  msgLateSegments,
  renderMessage,
  renderMessageSegments,
  joinSegmentsWithMarker,
  splitRenderedSegments,
  getTemplatesForCompany,
  upsertTemplate,
  clearTemplateCache,
  clearCompanyCache,
  buildBindings,
  applyTemplate,
};



