const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { requirePermission, requireAnyPermission, getEffectivePermissions } = require('../services/permissions');
const { respondError } = require('../utils/http-error');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value, name) {
  const v = String(value || '').trim();
  if (!DATE_RE.test(v)) { const e = new Error(`${name} inválida (use AAAA-MM-DD)`); e.status = 400; throw e; }
  return v;
}
function parseAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) { const e = new Error('Valor inválido'); e.status = 400; throw e; }
  return Number(n.toFixed(2));
}
function parseLabel(value) {
  const v = String(value || '').trim();
  if (v.length < 2) { const e = new Error('Nomenclatura obrigatória'); e.status = 400; throw e; }
  return v;
}
function optId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function parseExpenseType(value) {
  const t = String(value || '').trim().toLowerCase();
  return (t === 'fixed' || t === 'fixo' || t === 'fixa') ? 'fixed' : 'variable';
}

// Intervalo [from, to) a partir de from/to (AAAA-MM-DD) ou ym (AAAA-MM).
function parseRange(q = {}) {
  const from = q.from && DATE_RE.test(q.from) ? q.from : null;
  const to = q.to && DATE_RE.test(q.to) ? q.to : null;
  if (from && to) return { from, to };
  if (/^\d{4}-\d{2}$/.test(String(q.ym || ''))) {
    const [y, m] = q.ym.split('-').map(Number);
    return { from: formatISODate(new Date(y, m - 1, 1)), to: formatISODate(new Date(y, m, 1)) };
  }
  return { from: null, to: null };
}

// Soma 1 mês a uma data mantendo o dia (com clamp para o último dia do mês).
function addOneMonth(date, day) {
  const base = ensureDateOnly(date);
  const target = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const d = Math.min(day || base.getDate(), lastDay);
  return new Date(target.getFullYear(), target.getMonth(), d);
}

const AUDIT = `
  (SELECT COALESCE(NULLIF(cu.name,''), cu.email) FROM ${SCHEMA}.users cu WHERE cu.id = f.created_by) AS created_by_name,
  (SELECT COALESCE(NULLIF(eu.name,''), eu.email) FROM ${SCHEMA}.users eu WHERE eu.id = f.updated_by) AS updated_by_name
`;

// Gera as ocorrências mensais faltantes das despesas recorrentes ativas,
// até o mês atual. Idempotente (não duplica meses já gerados).
async function generateRecurringExpenses(companyId, now = new Date()) {
  const curKey = now.getFullYear() * 100 + (now.getMonth() + 1);
  const roots = await query(
    `SELECT id, label, description, amount, paid_at, expense_type, created_by
       FROM ${SCHEMA}.finance_expenses
      WHERE company_id = $1 AND is_recurring = true AND recurrence_active = true`,
    [companyId]
  );
  for (const root of roots.rows) {
    const last = await query(
      `SELECT MAX(paid_at) AS last FROM ${SCHEMA}.finance_expenses
        WHERE company_id = $1 AND (id = $2 OR recurrence_of = $2)`,
      [companyId, root.id]
    );
    let lastDate = ensureDateOnly(last.rows[0]?.last) || ensureDateOnly(root.paid_at);
    if (!lastDate) continue;
    const rootDay = ensureDateOnly(root.paid_at)?.getDate() || lastDate.getDate();
    let guard = 0;
    while (guard++ < 240) {
      const next = addOneMonth(lastDate, rootDay);
      const nextKey = next.getFullYear() * 100 + (next.getMonth() + 1);
      if (nextKey > curKey) break;
      await query(
        `INSERT INTO ${SCHEMA}.finance_expenses
           (company_id, label, description, amount, paid_at, is_recurring, recurrence_active, expense_type, recurrence_of, created_by)
         VALUES ($1,$2,$3,$4,$5,false,false,$6,$7,$8)`,
        [companyId, root.label, root.description, root.amount, formatISODate(next), root.expense_type || 'variable', root.id, root.created_by]
      );
      lastDate = next;
    }
  }
}

// ===================== RECEITAS =====================
router.get('/revenues', requireAuth, companyScope(true), requirePermission('finance.revenues.view'), async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const params = [req.companyId];
    let where = 'WHERE f.company_id = $1';
    if (from && to) { params.push(from, to); where += ' AND f.received_at >= $2::date AND f.received_at < $3::date'; }
    const r = await query(
      `SELECT f.*, ${AUDIT},
              (SELECT name FROM ${SCHEMA}.clients cl WHERE cl.id = f.client_id) AS client_name,
              (SELECT description FROM ${SCHEMA}.contracts c WHERE c.id = f.contract_id) AS contract_description
         FROM ${SCHEMA}.finance_revenues f ${where} ORDER BY f.received_at DESC, f.id DESC`,
      params
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

router.post('/revenues', requireAuth, companyScope(true), requirePermission('finance.revenues.manage'), async (req, res) => {
  try {
    const label = parseLabel(req.body?.label);
    const amount = parseAmount(req.body?.amount);
    const receivedAt = parseDate(req.body?.received_at, 'Data de recebimento');
    const description = req.body?.description != null ? String(req.body.description).trim() || null : null;
    const clientId = optId(req.body?.client_id);
    const contractId = optId(req.body?.contract_id);
    const r = await query(
      `INSERT INTO ${SCHEMA}.finance_revenues (company_id, label, description, amount, received_at, client_id, contract_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.companyId, label, description, amount, receivedAt, clientId, contractId, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.put('/revenues/:id', requireAuth, companyScope(true), requirePermission('finance.revenues.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const label = parseLabel(req.body?.label);
    const amount = parseAmount(req.body?.amount);
    const receivedAt = parseDate(req.body?.received_at, 'Data de recebimento');
    const description = req.body?.description != null ? String(req.body.description).trim() || null : null;
    const clientId = optId(req.body?.client_id);
    const contractId = optId(req.body?.contract_id);
    const r = await query(
      `UPDATE ${SCHEMA}.finance_revenues
          SET label=$1, description=$2, amount=$3, received_at=$4, client_id=$5, contract_id=$6, updated_by=$7, updated_at=now()
        WHERE id=$8 AND company_id=$9 RETURNING *`,
      [label, description, amount, receivedAt, clientId, contractId, req.user.id, id, req.companyId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Receita não encontrada' });
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.delete('/revenues/:id', requireAuth, companyScope(true), requirePermission('finance.revenues.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await query(`DELETE FROM ${SCHEMA}.finance_revenues WHERE id=$1 AND company_id=$2 RETURNING id`, [id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Receita não encontrada' });
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// Importação em massa de receitas (a partir de planilha). Valida linha a linha
// e reporta quantas entraram / foram ignoradas.
router.post('/revenues/import', requireAuth, companyScope(true), requirePermission('finance.revenues.manage'), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length > 5000) return res.status(400).json({ error: 'Limite de 5000 linhas por importação' });
    let imported = 0;
    const errors = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      try {
        const label = parseLabel(it.label);
        const amount = parseAmount(it.amount);
        const receivedAt = parseDate(it.received_at, 'Data de recebimento');
        const description = it.description ? String(it.description).trim() || null : null;
        await query(
          `INSERT INTO ${SCHEMA}.finance_revenues (company_id, label, description, amount, received_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.companyId, label, description, amount, receivedAt, req.user.id]
        );
        imported++;
      } catch (e) { errors.push({ line: i + 2, error: e.message }); }
    }
    res.json({ imported, skipped: items.length - imported, errors: errors.slice(0, 50) });
  } catch (e) { respondError(res, e); }
});

// ===================== DESPESAS =====================
router.get('/expenses', requireAuth, companyScope(true), requirePermission('finance.expenses.view'), async (req, res) => {
  try {
    try { await generateRecurringExpenses(req.companyId, new Date()); }
    catch (e) { console.error('[finance] geração de recorrentes falhou:', e.message); }
    const { from, to } = parseRange(req.query);
    const params = [req.companyId];
    let where = 'WHERE f.company_id = $1';
    if (from && to) { params.push(from, to); where += ' AND f.paid_at >= $2::date AND f.paid_at < $3::date'; }
    const r = await query(
      `SELECT f.*, ${AUDIT} FROM ${SCHEMA}.finance_expenses f ${where} ORDER BY f.paid_at DESC, f.id DESC`,
      params
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

router.post('/expenses', requireAuth, companyScope(true), requirePermission('finance.expenses.manage'), async (req, res) => {
  try {
    const label = parseLabel(req.body?.label);
    const amount = parseAmount(req.body?.amount);
    const paidAt = parseDate(req.body?.paid_at, 'Data de pagamento');
    const description = req.body?.description != null ? String(req.body.description).trim() || null : null;
    const isRecurring = Boolean(req.body?.is_recurring);
    const expenseType = parseExpenseType(req.body?.expense_type);
    const r = await query(
      `INSERT INTO ${SCHEMA}.finance_expenses
         (company_id, label, description, amount, paid_at, is_recurring, recurrence_active, expense_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8) RETURNING *`,
      [req.companyId, label, description, amount, paidAt, isRecurring, expenseType, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.put('/expenses/:id', requireAuth, companyScope(true), requirePermission('finance.expenses.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const label = parseLabel(req.body?.label);
    const amount = parseAmount(req.body?.amount);
    const paidAt = parseDate(req.body?.paid_at, 'Data de pagamento');
    const description = req.body?.description != null ? String(req.body.description).trim() || null : null;
    const expenseType = parseExpenseType(req.body?.expense_type);
    const r = await query(
      `UPDATE ${SCHEMA}.finance_expenses
          SET label=$1, description=$2, amount=$3, paid_at=$4, expense_type=$5, updated_by=$6, updated_at=now()
        WHERE id=$7 AND company_id=$8 RETURNING *`,
      [label, description, amount, paidAt, expenseType, req.user.id, id, req.companyId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Despesa não encontrada' });
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// Importação em massa de despesas (a partir de planilha).
router.post('/expenses/import', requireAuth, companyScope(true), requirePermission('finance.expenses.manage'), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length > 5000) return res.status(400).json({ error: 'Limite de 5000 linhas por importação' });
    let imported = 0;
    const errors = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      try {
        const label = parseLabel(it.label);
        const amount = parseAmount(it.amount);
        const paidAt = parseDate(it.paid_at, 'Data de pagamento');
        const description = it.description ? String(it.description).trim() || null : null;
        const isRecurring = Boolean(it.is_recurring);
        const expenseType = parseExpenseType(it.expense_type);
        await query(
          `INSERT INTO ${SCHEMA}.finance_expenses
             (company_id, label, description, amount, paid_at, is_recurring, recurrence_active, expense_type, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8)`,
          [req.companyId, label, description, amount, paidAt, isRecurring, expenseType, req.user.id]
        );
        imported++;
      } catch (e) { errors.push({ line: i + 2, error: e.message }); }
    }
    res.json({ imported, skipped: items.length - imported, errors: errors.slice(0, 50) });
  } catch (e) { respondError(res, e); }
});

// Encerra a recorrência (mantém os lançamentos retroativos).
router.patch('/expenses/:id/recurrence', requireAuth, companyScope(true), requirePermission('finance.expenses.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const active = Boolean(req.body?.active);
    const r = await query(
      `UPDATE ${SCHEMA}.finance_expenses
          SET recurrence_active=$1, updated_by=$2, updated_at=now()
        WHERE id=$3 AND company_id=$4 AND is_recurring=true RETURNING *`,
      [active, req.user.id, id, req.companyId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Despesa recorrente não encontrada' });
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.delete('/expenses/:id', requireAuth, companyScope(true), requirePermission('finance.expenses.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await query(`DELETE FROM ${SCHEMA}.finance_expenses WHERE id=$1 AND company_id=$2 RETURNING id`, [id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Despesa não encontrada' });
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// ===================== CONTRATOS PAGOS (receita de contratos) =====================
router.get('/paid-contracts', requireAuth, companyScope(true), requirePermission('finance.revenues.view'), async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const params = [req.companyId];
    let where = `WHERE b.company_id=$1 AND LOWER(b.status)='paid'`;
    if (from && to) {
      params.push(from, to);
      where += ` AND COALESCE(b.gateway_paid_at::date, b.billing_date) >= $2::date AND COALESCE(b.gateway_paid_at::date, b.billing_date) < $3::date`;
    }
    const r = await query(
      `SELECT b.id AS billing_id, b.contract_id, b.amount, b.billing_date, b.gateway_paid_at,
              c.description AS contract_description, cl.name AS client_name
         FROM ${SCHEMA}.billings b
         JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
         JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
        ${where}
        ORDER BY COALESCE(b.gateway_paid_at::date, b.billing_date) DESC, b.id DESC`,
      params
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

// Edita o valor de uma cobrança paga.
router.put('/paid-contracts/:id', requireAuth, companyScope(true), requirePermission('finance.revenues.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const amount = parseAmount(req.body?.amount);
    const r = await query(
      `UPDATE ${SCHEMA}.billings SET amount=$1, updated_at=now()
        WHERE id=$2 AND company_id=$3 AND LOWER(status)='paid' RETURNING id`,
      [amount, id, req.companyId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Cobrança paga não encontrada' });
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// Estorna a cobrança (volta para pendente e reabre o mês do contrato).
router.patch('/paid-contracts/:id/reverse', requireAuth, companyScope(true), requirePermission('finance.revenues.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const r = await query(
      `UPDATE ${SCHEMA}.billings SET status='pending', gateway_paid_at=NULL, updated_at=now()
        WHERE id=$1 AND company_id=$2 AND LOWER(status)='paid'
        RETURNING contract_id, billing_date`,
      [id, req.companyId]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Cobrança paga não encontrada' });
    const d = ensureDateOnly(row.billing_date);
    if (d) {
      await query(
        `UPDATE ${SCHEMA}.contract_month_status SET status='pending', updated_at=now()
          WHERE contract_id=$1 AND year=$2 AND month=$3 AND status='paid'`,
        [row.contract_id, d.getFullYear(), d.getMonth() + 1]
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// ===================== RESUMO =====================
router.get('/summary', requireAuth, companyScope(true), requireAnyPermission(['finance.revenues.view', 'finance.expenses.view']), async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const ranged = Boolean(from && to);
    const params = ranged ? [req.companyId, from, to] : [req.companyId];

    // Receitas manuais no período.
    const rev = await query(
      `SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS total FROM ${SCHEMA}.finance_revenues
        WHERE company_id=$1 ${ranged ? 'AND received_at >= $2::date AND received_at < $3::date' : ''}`,
      params
    );
    // Receita de contratos pagos no período (billings pagos, pela data de pagamento).
    const contracts = await query(
      `SELECT COALESCE(SUM(b.amount),0)::numeric(14,2) AS total
         FROM ${SCHEMA}.billings b
         JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
        WHERE b.company_id=$1
          AND LOWER(b.status)='paid'
          ${ranged ? 'AND COALESCE(b.gateway_paid_at::date, b.billing_date) >= $2::date AND COALESCE(b.gateway_paid_at::date, b.billing_date) < $3::date' : ''}`,
      params
    );
    // Despesas no período (com quebra por tipo: fixa/variável).
    const exp = await query(
      `SELECT
         COALESCE(SUM(amount),0)::numeric(14,2) AS total,
         COALESCE(SUM(amount) FILTER (WHERE expense_type = 'fixed'),0)::numeric(14,2) AS fixed,
         COALESCE(SUM(amount) FILTER (WHERE expense_type <> 'fixed'),0)::numeric(14,2) AS variable
       FROM ${SCHEMA}.finance_expenses
        WHERE company_id=$1 ${ranged ? 'AND paid_at >= $2::date AND paid_at < $3::date' : ''}`,
      params
    );

    const revenuesManual = Number(rev.rows[0].total || 0);
    const revenuesContracts = Number(contracts.rows[0].total || 0);
    const totalRevenues = Number((revenuesManual + revenuesContracts).toFixed(2));
    const totalExpenses = Number(exp.rows[0].total || 0);

    // Redige a parte que o usuário não tem permissão de ver (receitas ou despesas).
    const perms = req.user.role === 'master' ? null : await getEffectivePermissions(req.user);
    const canRev = !perms || perms.includes('finance.revenues.view');
    const canExp = !perms || perms.includes('finance.expenses.view');

    res.json({
      from: from || null,
      to: to || null,
      revenuesManual: canRev ? revenuesManual : null,
      revenuesContracts: canRev ? revenuesContracts : null,
      totalRevenues: canRev ? totalRevenues : null,
      totalExpenses: canExp ? totalExpenses : null,
      fixedExpenses: canExp ? Number(exp.rows[0].fixed || 0) : null,
      variableExpenses: canExp ? Number(exp.rows[0].variable || 0) : null,
      balance: (canRev && canExp) ? Number((totalRevenues - totalExpenses).toFixed(2)) : null,
    });
  } catch (e) { respondError(res, e); }
});

// ===================== RESUMO GERENCIAL (DRE mensal) =====================
// Valida AAAA-MM e devolve {y, m}.
function parseYm(value, name) {
  const v = String(value || '').trim();
  const mtch = /^(\d{4})-(\d{2})$/.exec(v);
  const y = mtch ? Number(mtch[1]) : NaN;
  const m = mtch ? Number(mtch[2]) : NaN;
  if (!mtch || m < 1 || m > 12 || y < 2000 || y > 2100) {
    const e = new Error(`${name} inválido (use AAAA-MM)`); e.status = 400; throw e;
  }
  return { y, m };
}

// Retorna, para cada mês do intervalo [fromYm, toYm], os valores-BASE do DRE:
// honorários (receitas manuais + contratos pagos), contratos ativos (snapshot no
// fim do mês), despesas fixas e variáveis. As métricas derivadas (honorário médio,
// lucro, margem, AV%) e as colunas transversais (Total/Média/Projeção) são
// calculadas no cliente a partir destes valores-base. Exige ver receitas E
// despesas (é um DRE — mistura as duas áreas em lucro/margem).
router.get('/summary/annual', requireAuth, companyScope(true),
  requirePermission('finance.revenues.view'), requirePermission('finance.expenses.view'),
  async (req, res) => {
    try {
      // Garante que as ocorrências das despesas recorrentes já existam até hoje.
      try { await generateRecurringExpenses(req.companyId, new Date()); }
      catch (e) { console.error('[finance] geração de recorrentes (annual) falhou:', e.message); }

      const now = new Date();
      const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const from = req.query.fromYm ? parseYm(req.query.fromYm, 'fromYm')
        : { y: now.getFullYear(), m: 1 };
      const to = req.query.toYm ? parseYm(req.query.toYm, 'toYm')
        : { y: now.getFullYear(), m: 12 };

      const fromIdx = from.y * 12 + (from.m - 1);
      const toIdx = to.y * 12 + (to.m - 1);
      if (toIdx < fromIdx) return res.status(400).json({ error: 'Intervalo inválido (toYm < fromYm)' });
      if (toIdx - fromIdx > 23) return res.status(400).json({ error: 'Intervalo máximo de 24 meses' });

      const fromDate = formatISODate(new Date(from.y, from.m - 1, 1));
      const toDate = formatISODate(new Date(to.y, to.m - 1, 1));

      const r = await query(
        `WITH months AS (
           SELECT gs::date AS som,
                  (gs + INTERVAL '1 month')::date AS nextm,
                  (gs + INTERVAL '1 month - 1 day')::date AS eom
             FROM generate_series($2::date, $3::date, INTERVAL '1 month') gs
         )
         SELECT
           to_char(m.som, 'YYYY-MM') AS ym,
           (m.som < date_trunc('month', now())::date) AS closed,
           COALESCE(rev.total, 0) + COALESCE(con.total, 0) AS honorarios,
           COALESCE(ct.n, 0) AS contratos_ativos,
           COALESCE(e.fixed, 0) AS despesas_fixas,
           COALESCE(e.variable, 0) AS despesas_variaveis
         FROM months m
         LEFT JOIN LATERAL (
           SELECT SUM(fr.amount) AS total FROM ${SCHEMA}.finance_revenues fr
            WHERE fr.company_id = $1 AND fr.received_at >= m.som AND fr.received_at < m.nextm
         ) rev ON true
         LEFT JOIN LATERAL (
           SELECT SUM(b.amount) AS total FROM ${SCHEMA}.billings b
            WHERE b.company_id = $1 AND LOWER(b.status) = 'paid'
              AND COALESCE(b.gateway_paid_at::date, b.billing_date) >= m.som
              AND COALESCE(b.gateway_paid_at::date, b.billing_date) < m.nextm
         ) con ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS n FROM ${SCHEMA}.contracts c
            WHERE c.company_id = $1
              AND c.start_date <= m.eom AND c.end_date >= m.som
              AND (c.cancellation_date IS NULL OR c.cancellation_date >= m.som)
         ) ct ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(fe.amount) FILTER (WHERE fe.expense_type = 'fixed'), 0) AS fixed,
                  COALESCE(SUM(fe.amount) FILTER (WHERE fe.expense_type <> 'fixed'), 0) AS variable
             FROM ${SCHEMA}.finance_expenses fe
            WHERE fe.company_id = $1 AND fe.paid_at >= m.som AND fe.paid_at < m.nextm
         ) e ON true
         ORDER BY m.som`,
        [req.companyId, fromDate, toDate]
      );

      const months = r.rows.map((row) => ({
        ym: row.ym,
        closed: Boolean(row.closed),
        honorarios: Number(row.honorarios || 0),
        contratosAtivos: Number(row.contratos_ativos || 0),
        despesasFixas: Number(row.despesas_fixas || 0),
        despesasVariaveis: Number(row.despesas_variaveis || 0),
      }));

      res.json({ fromYm: `${from.y}-${String(from.m).padStart(2, '0')}`, toYm: `${to.y}-${String(to.m).padStart(2, '0')}`, currentYm: curYm, months });
    } catch (e) { respondError(res, e); }
  });

module.exports = router;
