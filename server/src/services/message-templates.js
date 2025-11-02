const { query } = require('../db');

const SCHEMA = process.env.DB_SCHEMA || 'public';

const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function dd(n) { return String(n).padStart(2, '0'); }
function formatPtDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
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
  due: `Olá {{client_name}}, tudo bem?

Lembrete: o pagamento referente ao {{contract_type}} do mês de {{reference_month}} vence HOJE ({{due_date}}), no valor de {{amount}}.

PIX: {{pix_key}}

Qualquer dúvida, fale com a gente.

Atenciosamente,
Equipe Financeira
{{company_name}}`,
  late: `Olá {{client_name}}, tudo bem?

Identificamos que o pagamento referente ao {{contract_type}} do mês de {{reference_month}} está em ATRASO desde {{due_date}}. Valor: {{amount}}.

PIX: {{pix_key}}

Se já realizou o pagamento, por favor desconsidere esta mensagem. Caso contrário, estamos à disposição para ajudar.

Atenciosamente,
Equipe Financeira
{{company_name}}`,
};

const PLACEHOLDERS = [
  { key: 'client_name', label: 'Nome do cliente', example: 'Maria Souza' },
  { key: 'contract_type', label: 'Descrição do contrato', example: 'Consultoria Contábil' },
  { key: 'reference_month', label: 'Mês de referência (extenso)', example: 'setembro' },
  { key: 'reference_month_number', label: 'Mês de referência (número)', example: '09' },
  { key: 'reference_year', label: 'Ano de referência', example: '2024' },
  { key: 'due_date', label: 'Data de vencimento (dd/mês/aaaa)', example: '25/setembro/2024' },
  { key: 'due_date_iso', label: 'Data de vencimento (YYYY-MM-DD)', example: '2024-09-25' },
  { key: 'amount', label: 'Valor formatado (R$)', example: 'R$ 1234,56' },
  { key: 'pix_key', label: 'Chave PIX', example: '11.222.333/0001-44' },
  { key: 'company_name', label: 'Nome da empresa', example: 'Teifelt Contabilidade' },
  { key: 'current_date', label: 'Data de hoje (dd/mês/aaaa)', example: '10/setembro/2024' },
  { key: 'current_date_iso', label: 'Data de hoje (YYYY-MM-DD)', example: '2024-09-10' },
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

function ensureDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
  const mesRefDate = ensureDate(ctx.mesRefDate || ctx.referenceDate);
  const vencimentoDate = ensureDate(ctx.vencimentoDate || ctx.dueDate);
  const now = ensureDate(ctx.now) || new Date();

  return {
    client_name: ctx.nome || ctx.client_name || '',
    contract_type: ctx.tipoContrato || ctx.contract_type || '',
    reference_month: mesRefDate ? (meses[mesRefDate.getMonth()] || '') : '',
    reference_month_number: mesRefDate ? dd(mesRefDate.getMonth() + 1) : '',
    reference_year: mesRefDate ? String(mesRefDate.getFullYear()) : '',
    due_date: vencimentoDate ? formatPtDate(vencimentoDate) : '',
    due_date_iso: vencimentoDate ? vencimentoDate.toISOString().slice(0, 10) : '',
    amount: ctx.valor != null ? moneyBR(ctx.valor) : '',
    pix_key: ctx.pix || ctx.pix_key || '',
    company_name: ctx.empresa || ctx.company_name || '',
    current_date: formatPtDate(now),
    current_date_iso: now.toISOString().slice(0, 10),
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
  const bindings = buildBindings({ ...ctx, empresa: companyName, pix, pix_key: pix });
  return applyTemplate(template, bindings);
}

async function msgPre(ctx) { return renderMessage('pre', ctx); }
async function msgDue(ctx) { return renderMessage('due', ctx); }
async function msgLate(ctx) { return renderMessage('late', ctx); }

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
  if (!companyId) throw new Error('companyId obrigatório');
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
  renderMessage,
  getTemplatesForCompany,
  upsertTemplate,
  clearTemplateCache,
  clearCompanyCache,
};
