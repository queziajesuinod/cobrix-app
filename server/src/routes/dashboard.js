const express = require('express')
const { requireAuth, companyScope } = require('./auth')
const { query } = require('../db')
const { ensureDateOnly, formatISODate, addDays } = require('../utils/date-only')

const router = express.Router()
const SCHEMA = process.env.DB_SCHEMA || 'public'

router.get('/summary', requireAuth, companyScope(true), async (req, res) => {
  const companyId = req.companyId
  if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' })

  const today = ensureDateOnly(new Date()) || new Date()
  const todayIso = formatISODate(today)
  const horizon = addDays(today, 30)
  const year = today.getFullYear()
  const month = today.getMonth() + 1

  try {
    const [activeStats, contractValueStats, todayDue, contractRows, cmsRows] = await Promise.all([
      query(
        `SELECT
           COUNT(*)::int AS contracts_active,
           COUNT(DISTINCT client_id)::int AS clients_active
         FROM ${SCHEMA}.contracts
         WHERE company_id = $1
           AND start_date <= $2
           AND end_date >= $2
           AND (cancellation_date IS NULL OR cancellation_date >= $2)`,
        [companyId, todayIso]
      ),
      query(
        `WITH active AS (
           SELECT id, COALESCE(value, 0) AS value
           FROM ${SCHEMA}.contracts
           WHERE company_id = $1
             AND start_date <= $2
             AND end_date >= $2
             AND (cancellation_date IS NULL OR cancellation_date >= $2)
         ),
         cms AS (
           SELECT contract_id, status
           FROM ${SCHEMA}.contract_month_status
           WHERE company_id = $1 AND year = $3 AND month = $4
         )
         SELECT
           COALESCE(SUM(CASE WHEN LOWER(COALESCE(cms.status, 'pending')) = 'paid' THEN active.value ELSE 0 END), 0) AS paid_value,
           COALESCE(SUM(CASE WHEN LOWER(COALESCE(cms.status, 'pending')) = 'paid' THEN 0 ELSE active.value END), 0) AS pending_value,
           COALESCE(SUM(active.value), 0) AS total_value
         FROM active
         LEFT JOIN cms ON cms.contract_id = active.id`,
        [companyId, todayIso, year, month]
      ),
      query(
        `SELECT
           COUNT(*)::int AS due_count,
           COALESCE(SUM(amount), 0) AS due_amount
         FROM ${SCHEMA}.billings
         WHERE company_id = $1
           AND billing_date = $2`,
        [companyId, todayIso]
      ),
      query(
        `SELECT id, value, billing_day, start_date, end_date, cancellation_date
         FROM ${SCHEMA}.contracts
         WHERE company_id = $1
           AND start_date <= $2
           AND end_date >= $3
           AND (cancellation_date IS NULL OR cancellation_date >= $3)`,
        [companyId, formatISODate(horizon), todayIso]
      ),
      query(
        `SELECT contract_id, year, month, status
         FROM ${SCHEMA}.contract_month_status
         WHERE company_id = $1
           AND (
             (year > $2 OR (year = $2 AND month >= $3))
             AND (year < $4 OR (year = $4 AND month <= $5))
           )`,
        [companyId, year, month, horizon.getFullYear(), horizon.getMonth() + 1]
      ),
    ])

    const activeRow = activeStats.rows[0] || { contracts_active: 0, clients_active: 0 }
    const contractRow = contractValueStats.rows[0] || { paid_value: 0, pending_value: 0, total_value: 0 }
    const dueRow = todayDue.rows[0] || { due_count: 0, due_amount: 0 }
    const futureReceivables = computeFutureReceivables(contractRows.rows || [], cmsRows.rows || [], today, horizon)

    res.json({
      totals: {
        contractsActive: activeRow.contracts_active,
        clientsActive: activeRow.clients_active,
      },
      billing: {
        paidAmount: Number(contractRow.paid_value || 0),
        pendingAmount: Number(contractRow.pending_value || 0),
        totalAmount: Number(contractRow.total_value || 0),
      },
      today: {
        dueCount: dueRow.due_count || 0,
        dueAmount: Number(dueRow.due_amount || 0),
        date: todayIso,
      },
      futureReceivables,
    })
  } catch (err) {
    console.error('[dashboard] summary failed', err)
    res.status(500).json({ error: 'Falha ao carregar indicadores', details: err.message })
  }
})

function buildDueDate(baseMonth, billingDay) {
  if (!billingDay) return null
  const y = baseMonth.getFullYear()
  const m = baseMonth.getMonth()
  const lastDay = new Date(y, m + 1, 0).getDate()
  const day = Math.min(Math.max(1, Number(billingDay)), lastDay)
  return new Date(y, m, day)
}

function findNextDueDate(contract, fromDate, horizon) {
  const start = ensureDateOnly(contract.start_date)
  const end = ensureDateOnly(contract.end_date)
  const cancellation = ensureDateOnly(contract.cancellation_date)
  if (!start || !end) return null

  for (let i = 0; i < 3; i += 1) {
    const monthBase = new Date(fromDate.getFullYear(), fromDate.getMonth() + i, 1)
    const candidate = buildDueDate(monthBase, contract.billing_day)
    if (!candidate) continue
    if (candidate < fromDate) continue
    if (candidate > horizon) continue
    if (candidate < start) continue
    if (candidate > end) continue
    if (cancellation && candidate > cancellation) continue
    return candidate
  }
  return null
}

function computeFutureReceivables(contracts, cmsRows, today, horizon) {
  const buckets = { next7: 0, next15: 0, next30: 0 }
  if (!contracts.length) return buckets

  const cmsMap = new Map()
  for (const row of cmsRows) {
    const key = `${row.contract_id}:${row.year}:${row.month}`
    cmsMap.set(key, String(row.status || '').toLowerCase())
  }

  const horizonDays = Math.round((horizon - today) / 86400000)

  for (const contract of contracts) {
    const value = Number(contract.value || 0)
    if (!Number.isFinite(value) || value <= 0) continue
    const dueDate = findNextDueDate(contract, today, horizon)
    if (!dueDate) continue
    const diffDays = Math.round((dueDate - today) / 86400000)
    if (diffDays < 0 || diffDays > horizonDays) continue
    const key = `${contract.id}:${dueDate.getFullYear()}:${dueDate.getMonth() + 1}`
    const status = cmsMap.get(key)
    if (status === 'paid' || status === 'canceled') continue
    if (diffDays <= 7) buckets.next7 += value
    if (diffDays <= 15) buckets.next15 += value
    if (diffDays <= 30) buckets.next30 += value
  }

  buckets.next7 = Number(buckets.next7 || 0)
  buckets.next15 = Number(buckets.next15 || 0)
  buckets.next30 = Number(buckets.next30 || 0)
  return buckets
}

module.exports = router
