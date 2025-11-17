const { query } = require('../db');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');

const SCHEMA = process.env.DB_SCHEMA || 'public';

const meses = ['janeiro','fevereiro','marÃ§o','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

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
  pre: `Ol� {{client_name}}, tudo bem?

Gostar�amos de lembrar que o vencimento referente ao {{contract_type}} do m�s de {{reference_month}} est� programado para o dia {{due_date}}, no valor de {{amount}}.

Para sua comodidade, seguem os dados para o pagamento:

PIX: {{pix_key}}

Caso precise de alguma informa��o adicional, n�o hesite em nos procurar. Estamos � disposi��o para ajud�-lo.

Agradecemos pela confian�a em nossos servi�os e seguimos � disposi��o para o que for necess�rio.

Atenciosamente,
Equipe Financeira
{{company_name}}`,
  pre_gateway: `Ol� {{client_name}}, tudo bem?

Seu {{contract_type}} referente ao m�s de {{reference_month}} vencer� em {{due_date}}, no valor de {{amount}}.

Voc� pode pagar acessando o link seguro abaixo:
{{payment_link}}

Se preferir Pix copia e cola:
{{payment_code}}

Ficamos � disposi��o caso precise de algo.

Atenciosamente,
Equipe Financeira
{{company_name}}`,
  due: `Ol� {{client_name}}, tudo bem?

Lembrete: o pagamento referente ao {{contract_type}} do m�s de {{reference_month}} vence HOJE ({{due_date}}), no valor de {{amount}}.

PIX: {{pix_key}}

Qualquer d�vida, fale com a gente.

Atenciosamente,
Equipe Financeira
{{company_name}}`,
  due_gateway: `Ol� {{client_name}}, tudo bem?

Seu pagamento do {{contract_type}} ({{reference_month}}) vence HOJE, {{due_date}}, no valor de {{amount}}.

Pague agora pelo link:
{{payment_link}}

Ou use o Pix copia e cola:
{{payment_code}}

Qualquer d�vida, fale com a gente.

Atenciosamente,
Equipe Financeira
{{company_name}}`,
  late: `Ol� {{client_name}}, tudo bem?

Identificamos que o pagamento referente ao {{contract_type}} do m�s de {{reference_month}} est� em ATRASO desde {{due_date}}. Valor: {{amount}}.

PIX: {{pix_key}}

Se j� realizou o pagamento, por favor desconsidere esta mensagem. Caso contr�rio, estamos � disposi��o para ajudar.

Atenciosamente,
Equipe Financeira
{{company_name}}`,
  late_gateway: `Ol� {{client_name}}, tudo bem?

Percebemos que o pagamento do {{contract_type}} ({{reference_month}}) est� em atraso desde {{due_date}}. Valor: {{amount}}.

Voc� pode regularizar acessando este link:
{{payment_link}}

Ou utilize o Pix copia e cola:
{{payment_code}}

Se j� pagou, desconsidere esta mensagem. Qualquer d�vida, fale conosco.

Atenciosamente,
Equipe Financeira
{{company_name}}`,
  paid: `Olá {{client_name}}, tudo bem?

Recebemos o pagamento referente ao {{contract_type}} de {{reference_month}} (vencimento em {{due_date}}) no valor de {{amount}}.

Pagamento confirmado em {{payment_date}}.

Obrigado pela parceria!

Atenciosamente,
Equipe Financeira
{{company_name}}`,
};

const PLACEHOLDERS = [
  { key: 'client_name', label: 'Nome do destinatário', example: 'Maria Souza' },
  { key: 'client_responsible', label: 'Responsável pelo cliente', example: 'JoÃ£o Pereira' },
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
];

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

async function renderMessage(type, ctx = {}) {
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
  return applyTemplate(template, bindings);
}

function hasGatewayContext(ctx = {}) {
  return Boolean(
    ctx.gatewayPayment ||
    ctx.gatewayPaymentLink ||
    ctx.payment_link ||
    ctx.payment_code
  );
}

async function msgPre(ctx) {
  const type = hasGatewayContext(ctx) ? 'pre_gateway' : 'pre';
  return renderMessage(type, ctx);
}
async function msgDue(ctx) {
  const type = hasGatewayContext(ctx) ? 'due_gateway' : 'due';
  return renderMessage(type, ctx);
}
async function msgLate(ctx) {
  const type = hasGatewayContext(ctx) ? 'late_gateway' : 'late';
  return renderMessage(type, ctx);
}
async function msgPaid(ctx) {
  return renderMessage('paid', ctx);
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

async function upsertTemplate(companyId, type, template) {
  if (!companyId) throw new Error('companyId obrigatÃ³rio');
  const clean = String(template ?? '').trim();
  await query(
    `INSERT INTO ${SCHEMA}.message_templates (company_id, type, template)
     VALUES ($1,$2,$3)
     ON CONFLICT (company_id, type)
     DO UPDATE SET template=EXCLUDED.template, updated_at=now()`,
    [companyId, type, clean]
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
  renderMessage,
  getTemplatesForCompany,
  upsertTemplate,
  clearTemplateCache,
  clearCompanyCache,
};



