const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');
const { sendWhatsapp } = require('../services/messenger');

const router = express.Router();
const SCHEMA = process.env.DB_SCHEMA || 'public';
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(raw, name) {
  if (raw == null || raw === '') return null;
  const value = String(raw).trim();
  if (!DATE_ONLY_RE.test(value)) {
    const err = new Error(`${name} inválida. Use YYYY-MM-DD`);
    err.status = 400;
    throw err;
  }
  const normalized = formatISODate(ensureDateOnly(value));
  if (!normalized || normalized !== value) {
    const err = new Error(`${name} inválida. Use YYYY-MM-DD`);
    err.status = 400;
    throw err;
  }
  return value;
}

function parseNumberParam(raw, name, { integer = false, min = null } = {}) {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    const err = new Error(`${name} inválido`);
    err.status = 400;
    throw err;
  }
  if (integer && !Number.isInteger(value)) {
    const err = new Error(`${name} inválido`);
    err.status = 400;
    throw err;
  }
  if (min != null && value < min) {
    const err = new Error(`${name} deve ser >= ${min}`);
    err.status = 400;
    throw err;
  }
  return value;
}

function parseFilters(source = {}) {
  const dueDateFrom = parseDateParam(source.dueDateFrom, 'dueDateFrom');
  const dueDateTo = parseDateParam(source.dueDateTo, 'dueDateTo');
  const minAmount = parseNumberParam(source.minAmount, 'minAmount', { min: 0 });
  const maxAmount = parseNumberParam(source.maxAmount, 'maxAmount', { min: 0 });
  const minDaysLate = parseNumberParam(source.minDaysLate, 'minDaysLate', { integer: true, min: 0 });
  const maxDaysLate = parseNumberParam(source.maxDaysLate, 'maxDaysLate', { integer: true, min: 0 });
  const q = String(source.q || '').trim();

  if (dueDateFrom && dueDateTo && dueDateFrom > dueDateTo) {
    const err = new Error('dueDateFrom não pode ser maior que dueDateTo');
    err.status = 400;
    throw err;
  }
  if (minAmount != null && maxAmount != null && minAmount > maxAmount) {
    const err = new Error('minAmount não pode ser maior que maxAmount');
    err.status = 400;
    throw err;
  }
  if (minDaysLate != null && maxDaysLate != null && minDaysLate > maxDaysLate) {
    const err = new Error('minDaysLate não pode ser maior que maxDaysLate');
    err.status = 400;
    throw err;
  }

  return {
    dueDateFrom,
    dueDateTo,
    minAmount,
    maxAmount,
    minDaysLate,
    maxDaysLate,
    q,
  };
}

function parseClientId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('clientId inválido');
    err.status = 400;
    throw err;
  }
  return id;
}

function parseBillingId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('billingId inválido');
    err.status = 400;
    throw err;
  }
  return id;
}

function parseBillingIds(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
  if (!ids.length) return null;
  return [...new Set(ids)];
}

function formatCurrencyBRL(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBr(value) {
  if (!value) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [y, m, d] = String(value).split('-');
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleDateString('pt-BR');
}

function buildOverdueWhere({ companyId, todayIso, filters, clientId = null, billingIds = null }) {
  const params = [companyId, todayIso];
  const where = [
    'b.company_id = $1',
    'c.company_id = $1',
    "LOWER(COALESCE(b.status, 'pending')) = 'pending'",
    'b.billing_date < $2::date',
  ];

  if (clientId != null) {
    params.push(clientId);
    where.push(`cl.id = $${params.length}`);
  }

  if (filters.dueDateFrom) {
    params.push(filters.dueDateFrom);
    where.push(`b.billing_date >= $${params.length}::date`);
  }
  if (filters.dueDateTo) {
    params.push(filters.dueDateTo);
    where.push(`b.billing_date <= $${params.length}::date`);
  }

  if (filters.q) {
    const like = `%${filters.q}%`;
    params.push(like);
    const pos = params.length;
    where.push(`(
      cl.name ILIKE $${pos}
      OR COALESCE(cl.responsavel, '') ILIKE $${pos}
      OR COALESCE(cl.email, '') ILIKE $${pos}
      OR COALESCE(cl.phone, '') ILIKE $${pos}
      OR COALESCE(cl.document_cpf, cl.document_cnpj, '') ILIKE $${pos}
      OR COALESCE(c.description, '') ILIKE $${pos}
      OR CAST(b.id AS TEXT) ILIKE $${pos}
    )`);
  }

  if (billingIds && billingIds.length) {
    params.push(billingIds);
    where.push(`b.id = ANY($${params.length}::int[])`);
  }

  return { params, whereSql: where.join(' AND ') };
}

function appendPostFilters(params, filters) {
  const post = [];
  if (filters.minAmount != null) {
    params.push(filters.minAmount);
    post.push(`o.amount >= $${params.length}`);
  }
  if (filters.maxAmount != null) {
    params.push(filters.maxAmount);
    post.push(`o.amount <= $${params.length}`);
  }
  if (filters.minDaysLate != null) {
    params.push(filters.minDaysLate);
    post.push(`o.days_late >= $${params.length}`);
  }
  if (filters.maxDaysLate != null) {
    params.push(filters.maxDaysLate);
    post.push(`o.days_late <= $${params.length}`);
  }
  return post.length ? `WHERE ${post.join(' AND ')}` : '';
}

function overdueCte(whereSql) {
  return `
    WITH overdue AS (
      SELECT
        b.id AS billing_id,
        b.contract_id,
        c.description AS contract_description,
        b.billing_date,
        COALESCE(b.amount, c.value, 0)::numeric(14,2) AS amount,
        ($2::date - b.billing_date)::int AS days_late,
        cl.id AS client_id,
        cl.name AS client_name,
        cl.responsavel AS client_responsavel,
        cl.email AS client_email,
        cl.phone AS client_phone,
        COALESCE(cl.document_cpf, cl.document_cnpj) AS client_document
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      LEFT JOIN ${SCHEMA}.contract_month_status cms
        ON cms.contract_id = b.contract_id
        AND cms.year = EXTRACT(YEAR FROM b.billing_date)::int
        AND cms.month = EXTRACT(MONTH FROM b.billing_date)::int
      WHERE ${whereSql}
        AND LOWER(COALESCE(cms.status, 'pending')) NOT IN ('paid', 'canceled')
    )
  `;
}

async function listOverdueBillings({
  companyId,
  filters,
  clientId = null,
  billingIds = null,
  all = false,
  page = 1,
  pageSize = 20,
}) {
  const today = ensureDateOnly(new Date()) || new Date();
  const todayIso = formatISODate(today);

  const base = buildOverdueWhere({ companyId, todayIso, filters, clientId, billingIds });
  const countParams = [...base.params];
  const countPostWhere = appendPostFilters(countParams, filters);

  const summarySql = `
    ${overdueCte(base.whereSql)}
    SELECT
      COUNT(*)::int AS total_billings,
      COUNT(DISTINCT o.client_id)::int AS total_clients,
      COALESCE(SUM(o.amount), 0)::numeric(14,2) AS total_overdue_amount
    FROM overdue o
    ${countPostWhere}
  `;
  const summaryResult = await query(summarySql, countParams);
  const summaryRow = summaryResult.rows[0] || {};

  const totalBillings = Number(summaryRow.total_billings || 0);
  const totalClients = Number(summaryRow.total_clients || 0);
  const totalOverdueAmount = Number(summaryRow.total_overdue_amount || 0);

  const dataParams = [...base.params];
  const dataPostWhere = appendPostFilters(dataParams, filters);
  let pagingSql = '';

  if (!all) {
    const safePage = Math.max(Number(page) || 1, 1);
    const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 500);
    const offset = (safePage - 1) * safePageSize;
    dataParams.push(safePageSize, offset);
    pagingSql = `LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
  }

  const rowsSql = `
    ${overdueCte(base.whereSql)}
    SELECT o.*
    FROM overdue o
    ${dataPostWhere}
    ORDER BY o.days_late DESC, o.billing_date ASC, o.billing_id ASC
    ${pagingSql}
  `;

  const rowsResult = await query(rowsSql, dataParams);

  return {
    generatedAt: todayIso,
    page: all ? 1 : Math.max(Number(page) || 1, 1),
    pageSize: all ? rowsResult.rowCount : Math.min(Math.max(Number(pageSize) || 20, 1), 500),
    total: totalBillings,
    summary: {
      totalBillings,
      totalClients,
      totalOverdueAmount,
      referenceDate: todayIso,
    },
    data: rowsResult.rows,
  };
}

function buildOverdueMessage(clientName, rows) {
  const sorted = [...rows].sort((a, b) => {
    if (a.billing_date !== b.billing_date) return String(a.billing_date).localeCompare(String(b.billing_date));
    return Number(a.billing_id || 0) - Number(b.billing_id || 0);
  });

  const total = sorted.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const maxLines = 40;
  const displayed = sorted.slice(0, maxLines);

  const lines = displayed.map((row, index) => {
    const contractLabel = row.contract_description || `Contrato #${row.contract_id}`;
    return `${index + 1}) ${contractLabel} | Venc: ${formatDateBr(row.billing_date)} | Valor: ${formatCurrencyBRL(row.amount)} | ${row.days_late} dia(s) em atraso`;
  });

  if (sorted.length > displayed.length) {
    lines.push(`... e mais ${sorted.length - displayed.length} cobrança(s) em atraso.`);
  }

  const greetingName = String(clientName || 'cliente').trim();
  return [
    `Olá ${greetingName},`,
    '',
    `Identificamos ${sorted.length} cobrança(s) em atraso:`,
    ...lines,
    '',
    `Total em aberto: ${formatCurrencyBRL(total)}.`,
    'Por favor, regularize os pagamentos ou envie o comprovante para baixa.',
  ].join('\n');
}

async function setContractMonthStatusPaid(contractId, companyId, billingDate) {
  if (!contractId || !companyId || !billingDate) return;
  const date = ensureDateOnly(billingDate);
  if (!date) return;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  await query(
    `INSERT INTO ${SCHEMA}.contract_month_status (contract_id, company_id, year, month, status)
     VALUES ($1,$2,$3,$4,'paid')
     ON CONFLICT (contract_id, year, month)
     DO UPDATE SET status='paid', updated_at=NOW()`,
    [Number(contractId), Number(companyId), year, month]
  ).catch(() => {});
}

async function markBillingsPaid(companyId, billings) {
  const ids = [...new Set((billings || []).map((item) => Number(item.billing_id)).filter((item) => Number.isInteger(item) && item > 0))];
  if (!ids.length) {
    return { updatedCount: 0, totalPaidAmount: 0, rows: [] };
  }

  const updated = await query(
    `UPDATE ${SCHEMA}.billings
       SET status='paid',
           gateway_paid_at = COALESCE(gateway_paid_at, NOW())
     WHERE company_id = $1
       AND id = ANY($2::int[])
       AND LOWER(COALESCE(status, 'pending')) = 'pending'
     RETURNING id, contract_id, billing_date, amount`,
    [companyId, ids]
  );

  for (const row of updated.rows) {
    await setContractMonthStatusPaid(row.contract_id, companyId, row.billing_date);
  }

  const totalPaidAmount = updated.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return {
    updatedCount: updated.rowCount,
    totalPaidAmount,
    rows: updated.rows,
  };
}

router.get('/overdue-clients', requireAuth, companyScope(true), async (req, res) => {
  try {
    const companyId = req.companyId;
    if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' });

    const filters = parseFilters(req.query || {});
    const all = ['1', 'true', 'yes'].includes(String(req.query.all || '').toLowerCase());
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 500);

    const data = await listOverdueBillings({
      companyId,
      filters,
      all,
      page,
      pageSize,
    });

    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/overdue-clients/client/:clientId/notify', requireAuth, companyScope(true), async (req, res) => {
  try {
    const companyId = req.companyId;
    if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' });

    const clientId = parseClientId(req.params.clientId);
    const filters = parseFilters(req.body || {});
    const billingIds = parseBillingIds(req.body?.billingIds);

    const report = await listOverdueBillings({
      companyId,
      clientId,
      filters,
      billingIds,
      all: true,
      pageSize: 5000,
    });

    if (!report.data.length) {
      return res.status(409).json({ error: 'Cliente sem cobranças em atraso para notificar' });
    }

    const first = report.data[0];
    if (!first.client_phone) {
      return res.status(400).json({ error: 'Cliente sem telefone cadastrado para envio' });
    }

    const recipientName = first.client_responsavel || first.client_name || 'cliente';
    const text = buildOverdueMessage(recipientName, report.data);
    const evo = await sendWhatsapp(companyId, { number: first.client_phone, text });

    if (!evo.ok) {
      return res.status(502).json({
        error: evo.error || 'Falha ao enviar notificação de atraso',
        details: evo.data || null,
      });
    }

    return res.json({
      ok: true,
      clientId,
      clientName: first.client_name || null,
      clientPhone: first.client_phone || null,
      billingsCount: report.data.length,
      totalOverdueAmount: report.summary.totalOverdueAmount,
      provider: {
        status: evo.status,
        data: evo.data,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/overdue-clients/client/:clientId/mark-paid', requireAuth, companyScope(true), async (req, res) => {
  try {
    const companyId = req.companyId;
    if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' });

    const clientId = parseClientId(req.params.clientId);
    const filters = parseFilters(req.body || {});
    const billingIds = parseBillingIds(req.body?.billingIds);

    const report = await listOverdueBillings({
      companyId,
      clientId,
      filters,
      billingIds,
      all: true,
      pageSize: 5000,
    });

    if (!report.data.length) {
      return res.json({ ok: true, updated: 0, totalPaidAmount: 0 });
    }

    const result = await markBillingsPaid(companyId, report.data);

    return res.json({
      ok: true,
      clientId,
      updated: result.updatedCount,
      totalPaidAmount: result.totalPaidAmount,
      billings: result.rows,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/overdue-clients/billing/:billingId/mark-paid', requireAuth, companyScope(true), async (req, res) => {
  try {
    const companyId = req.companyId;
    if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' });

    const billingId = parseBillingId(req.params.billingId);
    const lookup = await query(
      `SELECT
         b.id AS billing_id,
         b.contract_id,
         b.billing_date,
         b.amount,
         b.status,
         cl.id AS client_id,
         cl.name AS client_name
       FROM ${SCHEMA}.billings b
       JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
       JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE b.company_id = $1
        AND c.company_id = $1
        AND b.id = $2`,
      [companyId, billingId]
    );

    const row = lookup.rows[0];
    if (!row) return res.status(404).json({ error: 'Cobrança não encontrada' });

    const status = String(row.status || '').toLowerCase();
    if (status === 'paid') {
      return res.json({ ok: true, updated: 0, alreadyPaid: true, billingId });
    }

    const result = await markBillingsPaid(companyId, [row]);

    return res.json({
      ok: true,
      updated: result.updatedCount,
      totalPaidAmount: result.totalPaidAmount,
      billing: result.rows[0] || null,
      client: {
        id: row.client_id,
        name: row.client_name,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
