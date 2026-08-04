const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { requirePermission, requireAnyPermission, getEffectivePermissions } = require('../services/permissions');
const { respondError } = require('../utils/http-error');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');
const { r2, r4, buildKpis, evolucaoPonto, computeProjecao, computeInsights, computeHealthScore } = require('../services/finance-dashboard');

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

// Identidade de uma recorrência: mesma conta = mesmo label + descrição
// (normalizados: sem espaços nas pontas e caixa unificada). Vários meses
// históricos com valores diferentes ("só mudou o valor") são UMA única série —
// não recorrências separadas. O valor NÃO entra na identidade de propósito.
const KEY_LABEL = 'LOWER(TRIM(label))';
const KEY_DESC = "LOWER(TRIM(COALESCE(description,'')))";
const recurrenceKey = (label, description) =>
  `${String(label ?? '').trim().toLowerCase()}${String(description ?? '').trim().toLowerCase()}`;

const AUDIT = `
  (SELECT COALESCE(NULLIF(cu.name,''), cu.email) FROM ${SCHEMA}.users cu WHERE cu.id = f.created_by) AS created_by_name,
  (SELECT COALESCE(NULLIF(eu.name,''), eu.email) FROM ${SCHEMA}.users eu WHERE eu.id = f.updated_by) AS updated_by_name
`;

// Gera as ocorrências mensais faltantes das despesas recorrentes ativas, até o
// mês atual. A recorrência é POR IDENTIDADE (label+descrição): mesmo que existam
// vários lançamentos recorrentes da mesma conta (histórico com valores diferentes),
// eles formam UMA série e geram só 1 ocorrência por mês. Idempotente: nunca cria
// um mês que já tenha lançamento daquela identidade — então não duplica.
async function generateRecurringExpenses(companyId, now = new Date()) {
  const curKey = now.getFullYear() * 100 + (now.getMonth() + 1);
  // Uma "fonte" por identidade: o lançamento recorrente ativo mais recente. Serve
  // de âncora para o recurrence_of das ocorrências geradas.
  const sources = await query(
    `SELECT DISTINCT ON (${KEY_LABEL}, ${KEY_DESC})
            id, label, description
       FROM ${SCHEMA}.finance_expenses
      WHERE company_id = $1 AND is_recurring = true AND recurrence_active = true
      ORDER BY ${KEY_LABEL}, ${KEY_DESC}, paid_at DESC, id DESC`,
    [companyId]
  );
  for (const src of sources.rows) {
    // Todos os lançamentos desta identidade (histórico + já gerados), do mais
    // recente para o mais antigo.
    const all = await query(
      `SELECT id, label, description, amount, paid_at, expense_type, created_by
         FROM ${SCHEMA}.finance_expenses
        WHERE company_id = $1
          AND LOWER(TRIM(label)) = LOWER(TRIM($2))
          AND LOWER(TRIM(COALESCE(description,''))) = LOWER(TRIM(COALESCE($3,'')))
        ORDER BY paid_at DESC, id DESC`,
      [companyId, src.label, src.description]
    );
    const rows = all.rows;
    if (!rows.length) continue;

    // Template das novas ocorrências = lançamento mais recente (último valor/dia).
    const latest = rows[0];
    const latestDate = ensureDateOnly(latest.paid_at);
    if (!latestDate) continue;
    const dayRef = latestDate.getDate();

    // Meses (AAAAMM) que já têm lançamento desta identidade — não gera de novo.
    const existing = new Set(rows.map((r) => {
      const d = ensureDateOnly(r.paid_at);
      return d.getFullYear() * 100 + (d.getMonth() + 1);
    }));

    let cursor = latestDate;
    let guard = 0;
    while (guard++ < 240) {
      const next = addOneMonth(cursor, dayRef);
      const nextKey = next.getFullYear() * 100 + (next.getMonth() + 1);
      if (nextKey > curKey) break;
      if (!existing.has(nextKey)) {
        // Nasce como 'pending' (a pagar): a ocorrência do mês ainda não foi paga,
        // então não deve descontar do saldo até ser confirmada como paga.
        await query(
          `INSERT INTO ${SCHEMA}.finance_expenses
             (company_id, label, description, amount, paid_at, is_recurring, recurrence_active, expense_type, recurrence_of, status, created_by)
           VALUES ($1,$2,$3,$4,$5,false,false,$6,$7,'pending',$8)`,
          [companyId, latest.label, latest.description, latest.amount, formatISODate(next), latest.expense_type || 'variable', src.id, latest.created_by]
        );
        existing.add(nextKey);
      }
      cursor = next;
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
    // Por padrão a despesa lançada manualmente já é 'paid' (o usuário está
    // registrando algo pago); pode marcar como pendente ('a pagar').
    const status = req.body?.status === 'pending' ? 'pending' : 'paid';
    const r = await query(
      `INSERT INTO ${SCHEMA}.finance_expenses
         (company_id, label, description, amount, paid_at, is_recurring, recurrence_active, expense_type, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) RETURNING *`,
      [req.companyId, label, description, amount, paidAt, isRecurring, expenseType, status, req.user.id]
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

    // Força a inclusão sem checagem de duplicados: o usuário revisou o resultado e
    // decidiu manter linhas que "já existiam" (ex.: várias "Taxas/Impostos" no mesmo
    // mês são lançamentos legítimos, não duplicatas). Insere cada item como veio.
    if (req.body?.force === true) {
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
      return res.json({ imported, skipped: items.length - imported, duplicates: 0, duplicateSamples: [], recurringSeries: 0, forced: true, errors: errors.slice(0, 50) });
    }

    const ymOfDate = (paidAt) => { const d = ensureDateOnly(paidAt); return d ? d.getFullYear() * 100 + (d.getMonth() + 1) : null; };
    const dedupKey = (label, description, ym) => `${recurrenceKey(label, description)}${ym}`;

    // Anti-duplicação: um mesmo mês da MESMA conta (label+descrição) não é importado
    // duas vezes — nem contra o que já existe no banco, nem repetido na planilha.
    // Reimportar meses anteriores (ou uma ocorrência já gerada pela recorrência) é
    // justamente o que duplicava. Guardamos o valor atual p/ sinalizar quando difere.
    const existing = new Map(); // "identidade\x01AAAAMM" -> valor atual no banco
    const ex = await query(
      `SELECT LOWER(TRIM(label)) AS l, LOWER(TRIM(COALESCE(description,''))) AS d,
              (EXTRACT(YEAR FROM paid_at) * 100 + EXTRACT(MONTH FROM paid_at))::int AS ym,
              amount
         FROM ${SCHEMA}.finance_expenses WHERE company_id = $1`,
      [req.companyId]
    );
    for (const r of ex.rows) existing.set(`${r.l}${r.d}${r.ym}`, Number(r.amount));

    // Marca as linhas duplicadas (mês já existente no banco OU repetido na planilha).
    const seen = new Set();
    const dup = items.map((it) => {
      const ym = ymOfDate(it?.paid_at);
      if (ym == null) return false; // data inválida segue o fluxo de erro normal
      const k = dedupKey(it.label, it.description, ym);
      if (existing.has(k) || seen.has(k)) return true;
      seen.add(k);
      return false;
    });

    // Recorrência é por identidade (label+descrição). Entre as linhas recorrentes
    // NÃO duplicadas, só a de mês mais recente por identidade vira a "fonte"; os
    // meses anteriores entram como histórico (is_recurring=false). E se já existir
    // uma fonte ativa no banco, nenhuma nova é criada.
    const latestByKey = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      if (!it.is_recurring || dup[i]) continue;
      const d = String(it.paid_at || '');
      if (!DATE_RE.test(d)) continue;
      const key = recurrenceKey(it.label, it.description);
      const prev = latestByKey.get(key);
      if (prev == null || d > String(items[prev].paid_at || '')) latestByKey.set(key, i);
    }
    const sourceIdx = new Set();
    for (const [, idx] of latestByKey) {
      const it = items[idx];
      const exists = await query(
        `SELECT 1 FROM ${SCHEMA}.finance_expenses
          WHERE company_id = $1 AND is_recurring = true AND recurrence_active = true
            AND LOWER(TRIM(label)) = LOWER(TRIM($2))
            AND LOWER(TRIM(COALESCE(description,''))) = LOWER(TRIM(COALESCE($3,'')))
          LIMIT 1`,
        [req.companyId, it.label, it.description]
      );
      if (!exists.rows.length) sourceIdx.add(idx);
    }

    let imported = 0;
    let recurringSeries = 0;
    let duplicates = 0;
    const duplicateSamples = [];
    const errors = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      try {
        const label = parseLabel(it.label);
        const amount = parseAmount(it.amount);
        const paidAt = parseDate(it.paid_at, 'Data de pagamento');
        const description = it.description ? String(it.description).trim() || null : null;
        if (dup[i]) {
          duplicates++;
          const atual = existing.get(dedupKey(label, description, ymOfDate(paidAt)));
          if (duplicateSamples.length < 500) {
            duplicateSamples.push({ line: i + 2, label, mes: paidAt.slice(0, 7), valor: amount, valorAtual: atual ?? null, valorDiferente: atual != null && Number(atual.toFixed(2)) !== amount });
          }
          continue;
        }
        // Só a "fonte" de cada identidade fica recorrente; os demais meses são histórico.
        const isRecurring = sourceIdx.has(i);
        if (isRecurring) recurringSeries++;
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
    res.json({ imported, skipped: items.length - imported, duplicates, duplicateSamples, recurringSeries, errors: errors.slice(0, 50) });
  } catch (e) { respondError(res, e); }
});

// Liga/encerra a recorrência (mantém os lançamentos retroativos). Como a série é
// por identidade (label+descrição), aplica a TODA a série — assim "encerrar" de
// fato para de gerar, mesmo que existam vários lançamentos-fonte da mesma conta.
router.patch('/expenses/:id/recurrence', requireAuth, companyScope(true), requirePermission('finance.expenses.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const active = Boolean(req.body?.active);
    const target = await query(
      `SELECT label, description FROM ${SCHEMA}.finance_expenses
        WHERE id=$1 AND company_id=$2 AND is_recurring=true`,
      [id, req.companyId]
    );
    if (!target.rows[0]) return res.status(404).json({ error: 'Despesa recorrente não encontrada' });
    const { label, description } = target.rows[0];
    const r = await query(
      `UPDATE ${SCHEMA}.finance_expenses
          SET recurrence_active=$1, updated_by=$2, updated_at=now()
        WHERE company_id=$3 AND is_recurring=true
          AND LOWER(TRIM(label)) = LOWER(TRIM($4))
          AND LOWER(TRIM(COALESCE(description,''))) = LOWER(TRIM(COALESCE($5,'')))
        RETURNING *`,
      [active, req.user.id, req.companyId, label, description]
    );
    res.json(r.rows.find((x) => x.id === id) || r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// Marca a despesa como paga ('paid') ou volta para pendente ('pending'). Só ao
// pagar ela passa a descontar do saldo. Opcionalmente atualiza a data de pagamento.
router.patch('/expenses/:id/pay', requireAuth, companyScope(true), requirePermission('finance.expenses.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const paid = Boolean(req.body?.paid);
    const status = paid ? 'paid' : 'pending';
    const paidAt = paid && req.body?.paid_at ? parseDate(req.body.paid_at, 'Data de pagamento') : null;
    const r = await query(
      `UPDATE ${SCHEMA}.finance_expenses
          SET status=$1, paid_at=COALESCE($2::date, paid_at), updated_by=$3, updated_at=now()
        WHERE id=$4 AND company_id=$5 RETURNING *`,
      [status, paidAt, req.user.id, id, req.companyId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Despesa não encontrada' });
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
    // Despesas no período. Só as PAGAS descontam do saldo; as pendentes (a pagar)
    // são reportadas à parte. Quebra por tipo (fixa/variável) considera as pagas.
    const exp = await query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE status = 'paid'),0)::numeric(14,2) AS total,
         COALESCE(SUM(amount) FILTER (WHERE status = 'paid' AND expense_type = 'fixed'),0)::numeric(14,2) AS fixed,
         COALESCE(SUM(amount) FILTER (WHERE status = 'paid' AND expense_type <> 'fixed'),0)::numeric(14,2) AS variable,
         COALESCE(SUM(amount) FILTER (WHERE status = 'pending'),0)::numeric(14,2) AS pending
       FROM ${SCHEMA}.finance_expenses
        WHERE company_id=$1 ${ranged ? 'AND paid_at >= $2::date AND paid_at < $3::date' : ''}`,
      params
    );

    const revenuesManual = Number(rev.rows[0].total || 0);
    const revenuesContracts = Number(contracts.rows[0].total || 0);
    const totalRevenues = Number((revenuesManual + revenuesContracts).toFixed(2));
    const totalExpenses = Number(exp.rows[0].total || 0);
    const pendingExpenses = Number(exp.rows[0].pending || 0);

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
      pendingExpenses: canExp ? pendingExpenses : null,
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
// calculadas no cliente a partir destes valores-base. O Resumo é um DRE
// consolidado com permissão própria.
router.get('/summary/annual', requireAuth, companyScope(true),
  requirePermission('finance.resumo.view'),
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
            WHERE fe.company_id = $1 AND fe.status = 'paid' AND fe.paid_at >= m.som AND fe.paid_at < m.nextm
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

// ===================== DASHBOARD FINANCEIRO =====================
// Fuso usado para derivar o "mês corrente" (competência aberta). As colunas de data
// no banco são DATE (sem hora), então só o "agora" precisa do fuso.
const TZ = 'America/Campo_Grande';

function parseAno(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) { const e = new Error('ano inválido'); e.status = 400; throw e; }
  return n;
}
function parseMes(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 12) { const e = new Error('mês inválido (use 1..12)'); e.status = 400; throw e; }
  return n;
}
const ymOf = (ano, mes) => `${ano}-${String(mes).padStart(2, '0')}`;
const isoFirst = (ano, mes) => formatISODate(new Date(ano, mes - 1, 1));
const wantsPrevisto = (q) => String(q.base || '').toUpperCase() === 'REALIZADO_E_PREVISTO';

// Agrega EM SQL os valores-base de cada mês em [fromDate, toDate] (datas no dia 1):
// receitas lançadas, contratos pagos, contratos previstos (a vencer), contratos ativos
// (snapshot no fim do mês), despesas fixas/variáveis e contadores de lançamento.
async function monthlyFinanceBase(companyId, fromDate, toDate) {
  const r = await query(
    `WITH months AS (
       SELECT gs::date AS som, (gs + INTERVAL '1 month')::date AS nextm, (gs + INTERVAL '1 month - 1 day')::date AS eom
         FROM generate_series($2::date, $3::date, INTERVAL '1 month') gs
     )
     SELECT to_char(m.som, 'YYYY-MM') AS ym,
            EXTRACT(MONTH FROM m.som)::int AS mes,
            (m.som < date_trunc('month', (now() AT TIME ZONE '${TZ}'))) AS closed,
            COALESCE(rev.total, 0) AS rev_manual, COALESCE(rev.n, 0) AS n_rev,
            COALESCE(paid.total, 0) AS con_paid, COALESCE(paid.n, 0) AS n_paid,
            COALESCE(prev.total, 0) AS con_previsto, COALESCE(prev.n, 0) AS n_previsto,
            COALESCE(ct.n, 0) AS contratos_ativos,
            COALESCE(e.fixed, 0) AS despesas_fixas, COALESCE(e.variable, 0) AS despesas_variaveis, COALESCE(e.n, 0) AS n_exp
       FROM months m
       LEFT JOIN LATERAL (
         SELECT SUM(fr.amount) total, COUNT(*) n FROM ${SCHEMA}.finance_revenues fr
          WHERE fr.company_id = $1 AND fr.received_at >= m.som AND fr.received_at < m.nextm
       ) rev ON true
       LEFT JOIN LATERAL (
         SELECT SUM(b.amount) total, COUNT(*) n FROM ${SCHEMA}.billings b
          WHERE b.company_id = $1 AND LOWER(b.status) = 'paid'
            AND COALESCE(b.gateway_paid_at::date, b.billing_date) >= m.som
            AND COALESCE(b.gateway_paid_at::date, b.billing_date) < m.nextm
       ) paid ON true
       LEFT JOIN LATERAL (
         SELECT SUM(b.amount) total, COUNT(*) n FROM ${SCHEMA}.billings b
          WHERE b.company_id = $1 AND LOWER(b.status) NOT IN ('paid', 'canceled')
            AND b.billing_date >= m.som AND b.billing_date < m.nextm
       ) prev ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) n FROM ${SCHEMA}.contracts c
          WHERE c.company_id = $1 AND c.start_date <= m.eom AND c.end_date >= m.som
            AND (c.cancellation_date IS NULL OR c.cancellation_date >= m.som)
       ) ct ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(fe.amount) FILTER (WHERE fe.expense_type = 'fixed'), 0) fixed,
                COALESCE(SUM(fe.amount) FILTER (WHERE fe.expense_type <> 'fixed'), 0) variable, COUNT(*) n
           FROM ${SCHEMA}.finance_expenses fe
          WHERE fe.company_id = $1 AND fe.status = 'paid' AND fe.paid_at >= m.som AND fe.paid_at < m.nextm
       ) e ON true
       ORDER BY m.som`,
    [companyId, fromDate, toDate]
  );
  return r.rows.map((row) => ({
    ym: row.ym,
    mes: Number(row.mes),
    closed: Boolean(row.closed),
    revManual: Number(row.rev_manual || 0),
    conPaid: Number(row.con_paid || 0),
    conPrevisto: Number(row.con_previsto || 0),
    contratosAtivos: Number(row.contratos_ativos || 0),
    despesasFixas: Number(row.despesas_fixas || 0),
    despesasVariaveis: Number(row.despesas_variaveis || 0),
    nRealizado: Number(row.n_rev || 0) + Number(row.n_paid || 0) + Number(row.n_exp || 0),
    nPrevisto: Number(row.n_previsto || 0),
  }));
}

// O Dashboard é uma visão consolidada (DRE) com permissão própria.
const dashGuard = [requireAuth, companyScope(true), requirePermission('finance.dashboard.view')];

// GET /dashboard/kpis?ano=&mes=&base= — os 8 indicadores do mês + variação vs. mês anterior.
router.get('/dashboard/kpis', ...dashGuard, async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const mes = parseMes(req.query.mes);
    const includePrevisto = wantsPrevisto(req.query);
    const prev = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
    const rows = await monthlyFinanceBase(req.companyId, isoFirst(prev.ano, prev.mes), isoFirst(ano, mes));
    const empty = { ym: ymOf(ano, mes), mes, closed: false, revManual: 0, conPaid: 0, conPrevisto: 0, contratosAtivos: 0, despesasFixas: 0, despesasVariaveis: 0, nRealizado: 0, nPrevisto: 0 };
    const curRow = rows.find((r) => r.ym === ymOf(ano, mes)) || empty;
    const prevRow = rows.find((r) => r.ym === ymOf(prev.ano, prev.mes));
    res.json({ competencia: ymOf(ano, mes), ...buildKpis(curRow, prevRow, includePrevisto) });
  } catch (e) { respondError(res, e); }
});

// GET /dashboard/despesas-categoria?ano=&mes= — uma linha por categoria (label+tipo), dinâmico.
router.get('/dashboard/despesas-categoria', ...dashGuard, async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const mes = parseMes(req.query.mes);
    const from = isoFirst(ano, mes);
    const to = isoFirst(mes === 12 ? ano + 1 : ano, mes === 12 ? 1 : mes + 1);
    const cat = await query(
      `SELECT fe.label AS nome, fe.expense_type,
              SUM(fe.amount)::numeric(14,2) AS valor
         FROM ${SCHEMA}.finance_expenses fe
        WHERE fe.company_id = $1 AND fe.status = 'paid' AND fe.paid_at >= $2::date AND fe.paid_at < $3::date
        GROUP BY fe.label, fe.expense_type
       HAVING SUM(fe.amount) <> 0
        ORDER BY SUM(fe.amount) DESC`,
      [req.companyId, from, to]
    );
    const [monthRow] = await monthlyFinanceBase(req.companyId, from, from);
    const honorarios = monthRow ? r2(monthRow.revManual + monthRow.conPaid) : 0;
    const total = r2(cat.rows.reduce((a, c) => a + Number(c.valor || 0), 0));
    const itens = cat.rows.map((c) => {
      const valor = r2(Number(c.valor || 0));
      return {
        categoria_id: null, // não há catálogo de categorias nesta fase; agrupado por label
        categoria_nome: c.nome,
        tipo: c.expense_type === 'fixed' ? 'FIXA' : 'VARIAVEL',
        valor,
        av_sobre_receita: honorarios ? r4(valor / honorarios) : null,
        participacao_na_despesa: total ? r4(valor / total) : null,
      };
    });
    res.json({ competencia: ymOf(ano, mes), total, itens });
  } catch (e) { respondError(res, e); }
});

// GET /dashboard/evolucao?ano=&base= — série SEMPRE com 12 pontos (jan..dez).
router.get('/dashboard/evolucao', ...dashGuard, async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const includePrevisto = wantsPrevisto(req.query);
    const rows = await monthlyFinanceBase(req.companyId, isoFirst(ano, 1), isoFirst(ano, 12));
    res.json({ ano, pontos: rows.map((row) => evolucaoPonto(row, includePrevisto)) });
  } catch (e) { respondError(res, e); }
});

// GET /dashboard/projecao?ano= — faturamento/despesa/lucro estimados a partir dos meses fechados.
router.get('/dashboard/projecao', ...dashGuard, async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const rows = await monthlyFinanceBase(req.companyId, isoFirst(ano, 1), isoFirst(ano, 12));
    res.json({ ano, ...computeProjecao(rows) });
  } catch (e) { respondError(res, e); }
});

// GET /dashboard/inadimplencia?ano= — cobranças de contrato (billings) por competência
// de vencimento: faturado × recebido × vencido × a vencer; + aging da carteira em aberto
// hoje. Só receitas de contrato (não há "inadimplência" de despesa), então basta a view
// de receitas — mas mantemos o guard comum do dashboard por coesão.
router.get('/dashboard/inadimplencia', ...dashGuard, async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const HOJE = `(now() AT TIME ZONE '${TZ}')::date`;
    // Coorte mensal pela data de vencimento (billing_date).
    const coh = await query(
      `WITH months AS (
         SELECT gs::date AS som, (gs + INTERVAL '1 month')::date AS nextm
           FROM generate_series($2::date, $3::date, INTERVAL '1 month') gs
       )
       SELECT to_char(m.som,'YYYY-MM') AS ym, EXTRACT(MONTH FROM m.som)::int AS mes,
              COALESCE(b.faturado,0) AS faturado, COALESCE(b.recebido,0) AS recebido,
              COALESCE(b.vencido,0) AS vencido, COALESCE(b.a_vencer,0) AS a_vencer
         FROM months m
         LEFT JOIN LATERAL (
           SELECT
             SUM(bi.amount) FILTER (WHERE LOWER(bi.status) <> 'canceled') AS faturado,
             SUM(bi.amount) FILTER (WHERE LOWER(bi.status) = 'paid') AS recebido,
             SUM(bi.amount) FILTER (WHERE LOWER(bi.status) NOT IN ('paid','canceled') AND bi.billing_date <  ${HOJE}) AS vencido,
             SUM(bi.amount) FILTER (WHERE LOWER(bi.status) NOT IN ('paid','canceled') AND bi.billing_date >= ${HOJE}) AS a_vencer
           FROM ${SCHEMA}.billings bi
           WHERE bi.company_id = $1 AND bi.billing_date >= m.som AND bi.billing_date < m.nextm
         ) b ON true
         ORDER BY m.som`,
      [req.companyId, isoFirst(ano, 1), isoFirst(ano, 12)]
    );
    // Aging da carteira em aberto HOJE (independente do ano), por dias de atraso.
    const ag = await query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE d BETWEEN 1 AND 30),0) AS b1,
         COALESCE(SUM(amount) FILTER (WHERE d BETWEEN 31 AND 60),0) AS b2,
         COALESCE(SUM(amount) FILTER (WHERE d BETWEEN 61 AND 90),0) AS b3,
         COALESCE(SUM(amount) FILTER (WHERE d > 90),0) AS b4,
         COALESCE(SUM(amount),0) AS total, COUNT(*) AS n
       FROM (
         SELECT amount, (${HOJE} - billing_date) AS d
           FROM ${SCHEMA}.billings
          WHERE company_id = $1 AND LOWER(status) NOT IN ('paid','canceled') AND billing_date < ${HOJE}
       ) x`,
      [req.companyId]
    );
    const meses = coh.rows.map((r) => {
      const faturado = Number(r.faturado || 0);
      const vencido = Number(r.vencido || 0);
      return {
        mes: Number(r.mes),
        competencia: r.ym,
        faturado: r2(faturado),
        recebido: r2(Number(r.recebido || 0)),
        vencido: r2(vencido),
        a_vencer: r2(Number(r.a_vencer || 0)),
        inadimplencia: faturado ? r4(vencido / faturado) : null,
      };
    });
    const a = ag.rows[0];
    res.json({
      ano,
      meses,
      aging: {
        b0_30: r2(Number(a.b1 || 0)),
        b31_60: r2(Number(a.b2 || 0)),
        b61_90: r2(Number(a.b3 || 0)),
        b90_plus: r2(Number(a.b4 || 0)),
        total: r2(Number(a.total || 0)),
        titulos: Number(a.n || 0),
      },
    });
  } catch (e) { respondError(res, e); }
});

// GET /dashboard/receita-tipo-contrato?ano=&mes= — receita por tipo de contrato,
// no mês selecionado (donut) e ao longo do ano (evolução empilhada). Junta contratos
// pagos + receitas manuais vinculadas a contrato; receita sem contrato = "Avulso".
router.get('/dashboard/receita-tipo-contrato', ...dashGuard, async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const mes = parseMes(req.query.mes);
    const from = isoFirst(ano, 1);
    const toEnd = isoFirst(ano + 1, 1); // exclusivo: 1º de janeiro do ano seguinte
    const r = await query(
      `WITH src AS (
         SELECT to_char(COALESCE(b.gateway_paid_at::date, b.billing_date), 'YYYY-MM') AS ym,
                COALESCE(ct.name, 'Sem tipo') AS tipo_nome, b.amount AS valor
           FROM ${SCHEMA}.billings b
           JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
           LEFT JOIN ${SCHEMA}.contract_types ct ON ct.id = c.contract_type_id
          WHERE b.company_id = $1 AND LOWER(b.status) = 'paid'
            AND COALESCE(b.gateway_paid_at::date, b.billing_date) >= $2::date
            AND COALESCE(b.gateway_paid_at::date, b.billing_date) <  $3::date
         UNION ALL
         SELECT to_char(fr.received_at, 'YYYY-MM') AS ym,
                COALESCE(ct.name, CASE WHEN fr.contract_id IS NULL THEN 'Avulso' ELSE 'Sem tipo' END) AS tipo_nome,
                fr.amount AS valor
           FROM ${SCHEMA}.finance_revenues fr
           LEFT JOIN ${SCHEMA}.contracts c ON c.id = fr.contract_id
           LEFT JOIN ${SCHEMA}.contract_types ct ON ct.id = c.contract_type_id
          WHERE fr.company_id = $1 AND fr.received_at >= $2::date AND fr.received_at < $3::date
       )
       SELECT ym, tipo_nome, SUM(valor)::numeric(14,2) AS valor
         FROM src GROUP BY ym, tipo_nome ORDER BY ym`,
      [req.companyId, from, toEnd]
    );

    const alvoYm = ymOf(ano, mes);
    // Tipos ordenados por total anual (desc) — define a ordem das séries/fatias.
    const totalPorTipo = new Map();
    for (const row of r.rows) totalPorTipo.set(row.tipo_nome, (totalPorTipo.get(row.tipo_nome) || 0) + Number(row.valor || 0));
    const tipos = [...totalPorTipo.entries()].sort((a, b) => b[1] - a[1]).map(([nome]) => nome);

    // Donut do mês selecionado.
    const mesRows = r.rows.filter((row) => row.ym === alvoYm);
    const totalMes = r2(mesRows.reduce((a, row) => a + Number(row.valor || 0), 0));
    const itensMes = mesRows
      .map((row) => ({ tipo_nome: row.tipo_nome, valor: r2(Number(row.valor || 0)) }))
      .sort((a, b) => b.valor - a.valor)
      .map((it) => ({ ...it, participacao: totalMes ? r4(it.valor / totalMes) : null }));

    // Evolução anual: 12 meses, cada um com o valor por tipo.
    const byYm = new Map();
    for (const row of r.rows) {
      if (!byYm.has(row.ym)) byYm.set(row.ym, {});
      byYm.get(row.ym)[row.tipo_nome] = r2(Number(row.valor || 0));
    }
    const meses = Array.from({ length: 12 }, (_, i) => {
      const ym = ymOf(ano, i + 1);
      return { mes: i + 1, competencia: ym, valores: byYm.get(ym) || {} };
    });

    res.json({ competencia: alvoYm, tipos, mes: { total: totalMes, itens: itensMes }, anual: { ano, tipos, meses } });
  } catch (e) { respondError(res, e); }
});

// GET /dashboard/metas?ano= — orçado anual vs. realizado (YTD) e projeção.
router.get('/dashboard/metas', ...dashGuard, async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const metaRow = await query(
      `SELECT meta_honorarios, meta_despesas FROM ${SCHEMA}.finance_metas WHERE company_id = $1 AND ano = $2`,
      [req.companyId, ano]
    );
    const rows = await monthlyFinanceBase(req.companyId, isoFirst(ano, 1), isoFirst(ano, 12));
    // Realizado do ano (YTD) = soma de todos os meses com lançamento realizado.
    const realizados = rows.filter((m) => m.nRealizado > 0);
    const realHon = r2(realizados.reduce((a, m) => a + m.revManual + m.conPaid, 0));
    const realDesp = r2(realizados.reduce((a, m) => a + m.despesasFixas + m.despesasVariaveis, 0));
    const proj = computeProjecao(rows).projecao;
    const meta = metaRow.rows[0]
      ? { honorarios: Number(metaRow.rows[0].meta_honorarios || 0), despesas: Number(metaRow.rows[0].meta_despesas || 0) }
      : null;
    res.json({
      ano,
      definida: Boolean(metaRow.rows[0]),
      meta: meta ? { ...meta, lucro: r2(meta.honorarios - meta.despesas) } : null,
      realizado: { honorarios: realHon, total_despesas: realDesp, lucro_operacional: r2(realHon - realDesp) },
      projecao: proj,
    });
  } catch (e) { respondError(res, e); }
});

// GET /dashboard/insights?ano=&mes= — alertas automáticos do período.
router.get('/dashboard/insights', ...dashGuard, async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const mes = parseMes(req.query.mes);
    const prev = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };

    const yearRows = await monthlyFinanceBase(req.companyId, isoFirst(ano, 1), isoFirst(ano, 12));
    const cur = yearRows.find((m) => m.ym === ymOf(ano, mes));
    let prevRow = yearRows.find((m) => m.ym === ymOf(prev.ano, prev.mes));
    if (!prevRow && prev.ano !== ano) {
      const pr = await monthlyFinanceBase(req.companyId, isoFirst(prev.ano, prev.mes), isoFirst(prev.ano, prev.mes));
      prevRow = pr[0];
    }
    const curK = cur ? buildKpis(cur, prevRow, false) : null;
    const prevK = prevRow ? buildKpis(prevRow, undefined, false) : null;

    // Média de despesas fixas dos meses fechados com lançamento.
    const fechados = yearRows.filter((m) => m.closed && m.nRealizado > 0);
    const mediaDespFixas = fechados.length ? fechados.reduce((a, m) => a + m.despesasFixas, 0) / fechados.length : null;

    // Aging da carteira vencida em aberto hoje.
    const HOJE = `(now() AT TIME ZONE '${TZ}')::date`;
    const ag = await query(
      `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM ${SCHEMA}.billings
        WHERE company_id = $1 AND LOWER(status) NOT IN ('paid','canceled') AND billing_date < ${HOJE}`,
      [req.companyId]
    );
    // Contratos ativos vencendo nos próximos 30/60 dias.
    const venc = await query(
      `SELECT
         COUNT(*) FILTER (WHERE end_date <= ${HOJE} + 30) AS v30,
         COUNT(*) FILTER (WHERE end_date <= ${HOJE} + 60) AS v60
       FROM ${SCHEMA}.contracts
        WHERE company_id = $1 AND active = true AND cancellation_date IS NULL
          AND end_date >= ${HOJE}`,
      [req.companyId]
    );
    // Meta + projeção do ano.
    const metaRow = await query(`SELECT meta_honorarios FROM ${SCHEMA}.finance_metas WHERE company_id = $1 AND ano = $2`, [req.companyId, ano]);
    const realHon = r2(yearRows.filter((m) => m.nRealizado > 0).reduce((a, m) => a + m.revManual + m.conPaid, 0));
    const projHon = computeProjecao(yearRows).projecao.honorarios;

    const itens = computeInsights({
      lucro_operacional: curK ? curK.lucro_operacional : null,
      margem_operacional: curK ? curK.margem_operacional : null,
      margem_anterior: prevK ? prevK.margem_operacional : null,
      despesas_fixas: cur ? r2(cur.despesasFixas) : 0,
      media_despesas_fixas: mediaDespFixas != null ? r2(mediaDespFixas) : null,
      aging_total: Number(ag.rows[0].total || 0),
      aging_titulos: Number(ag.rows[0].n || 0),
      contratos_vencendo_30: Number(venc.rows[0].v30 || 0),
      contratos_vencendo_60: Number(venc.rows[0].v60 || 0),
      meta_honorarios: metaRow.rows[0] ? Number(metaRow.rows[0].meta_honorarios || 0) : null,
      realizado_honorarios: realHon,
      projecao_honorarios: projHon,
    });
    res.json({ competencia: ymOf(ano, mes), itens });
  } catch (e) { respondError(res, e); }
});

// GET /dashboard/saude?ano= — score de saúde financeira (0–100) e seus fatores.
router.get('/dashboard/saude', ...dashGuard, async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const from = isoFirst(ano, 1);
    const toEnd = isoFirst(ano + 1, 1);
    const yearRows = await monthlyFinanceBase(req.companyId, from, isoFirst(ano, 12));

    const realizados = yearRows.filter((m) => m.nRealizado > 0);
    const honYTD = realizados.reduce((a, m) => a + m.revManual + m.conPaid, 0);
    const despFixaYTD = realizados.reduce((a, m) => a + m.despesasFixas, 0);
    const despVarYTD = realizados.reduce((a, m) => a + m.despesasVariaveis, 0);
    const lucroYTD = honYTD - (despFixaYTD + despVarYTD);
    const margem = honYTD ? lucroYTD / honYTD : null;
    const estrutura_custo = honYTD ? despFixaYTD / honYTD : null;

    // Crescimento: metade recente vs. metade anterior dos meses fechados com lançamento.
    const closed = yearRows.filter((m) => m.closed && m.nRealizado > 0);
    let crescimento = null;
    if (closed.length >= 2) {
      const half = Math.floor(closed.length / 2);
      const first = closed.slice(0, half);
      const second = closed.slice(closed.length - half);
      const avg = (arr) => arr.reduce((a, m) => a + m.revManual + m.conPaid, 0) / arr.length;
      const a0 = avg(first);
      if (a0 > 0) crescimento = (avg(second) - a0) / a0;
    }

    // Inadimplência: carteira vencida em aberto hoje ÷ receita realizada no ano.
    const HOJE = `(now() AT TIME ZONE '${TZ}')::date`;
    const ag = await query(
      `SELECT COALESCE(SUM(amount),0) total FROM ${SCHEMA}.billings
        WHERE company_id = $1 AND LOWER(status) NOT IN ('paid','canceled') AND billing_date < ${HOJE}`,
      [req.companyId]
    );
    const vencido = Number(ag.rows[0].total || 0);
    const inadimplencia = honYTD ? vencido / honYTD : null;

    // Concentração: participação do maior cliente na receita do ano.
    const conc = await query(
      `WITH rc AS (
         SELECT cid, SUM(v) AS total FROM (
           SELECT c.client_id AS cid, b.amount AS v
             FROM ${SCHEMA}.billings b JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
            WHERE b.company_id = $1 AND LOWER(b.status) = 'paid'
              AND COALESCE(b.gateway_paid_at::date, b.billing_date) >= $2::date
              AND COALESCE(b.gateway_paid_at::date, b.billing_date) <  $3::date
           UNION ALL
           SELECT fr.client_id AS cid, fr.amount AS v
             FROM ${SCHEMA}.finance_revenues fr
            WHERE fr.company_id = $1 AND fr.client_id IS NOT NULL
              AND fr.received_at >= $2::date AND fr.received_at < $3::date
         ) x WHERE cid IS NOT NULL GROUP BY cid
       )
       SELECT COALESCE(MAX(total),0) AS maior, COALESCE(SUM(total),0) AS total FROM rc`,
      [req.companyId, from, toEnd]
    );
    const totalCli = Number(conc.rows[0].total || 0);
    const concentracao = totalCli ? Number(conc.rows[0].maior || 0) / totalCli : null;

    const metrics = {
      margem: margem == null ? null : r4(margem),
      inadimplencia: inadimplencia == null ? null : r4(inadimplencia),
      crescimento: crescimento == null ? null : r4(crescimento),
      concentracao: concentracao == null ? null : r4(concentracao),
      estrutura_custo: estrutura_custo == null ? null : r4(estrutura_custo),
    };
    res.json({ ano, ...computeHealthScore(metrics), metrics });
  } catch (e) { respondError(res, e); }
});

// ===================== METAS (orçado anual) =====================
router.get('/metas', requireAuth, companyScope(true), requirePermission('finance.dashboard.view'), async (req, res) => {
  try {
    const ano = parseAno(req.query.ano);
    const r = await query(
      `SELECT ano, meta_honorarios, meta_despesas FROM ${SCHEMA}.finance_metas WHERE company_id = $1 AND ano = $2`,
      [req.companyId, ano]
    );
    const row = r.rows[0];
    res.json({ ano, meta_honorarios: row ? Number(row.meta_honorarios) : null, meta_despesas: row ? Number(row.meta_despesas) : null });
  } catch (e) { respondError(res, e); }
});

router.put('/metas/:ano', requireAuth, companyScope(true), requirePermission('finance.metas.manage'), async (req, res) => {
  try {
    const ano = parseAno(req.params.ano);
    const metaHon = parseAmount(req.body?.meta_honorarios);
    const metaDesp = parseAmount(req.body?.meta_despesas);
    await query(
      `INSERT INTO ${SCHEMA}.finance_metas (company_id, ano, meta_honorarios, meta_despesas, created_by, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$5, now())
       ON CONFLICT (company_id, ano)
       DO UPDATE SET meta_honorarios = EXCLUDED.meta_honorarios, meta_despesas = EXCLUDED.meta_despesas,
                     updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [req.companyId, ano, metaHon, metaDesp, req.user.id]
    );
    res.json({ ok: true, ano, meta_honorarios: metaHon, meta_despesas: metaDesp });
  } catch (e) { respondError(res, e); }
});

module.exports = router;
