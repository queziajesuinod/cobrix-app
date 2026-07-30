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
  const year = today.getFullYear()
  const month = today.getMonth() + 1
  const day = today.getDate()
  const daysInMonth = new Date(year, month, 0).getDate()
  const mm = String(month).padStart(2, '0')
  const monthStart = `${year}-${mm}-01`
  const monthEnd = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`

  try {
    const [contractStats, clientStats] = await Promise.all([
      // "Ativos no mês" = período do contrato SOBREPÕE o mês vigente (mesma regra dos KPIs
      // de /billings/kpis, para os números baterem). Pendentes = ativos-no-mês sem status
      // pago/cancelado. Vence hoje = dia de cobrança == hoje E vigente hoje.
      query(
        `WITH active_month AS (
           SELECT c.id, c.billing_day, c.start_date, c.end_date, c.cancellation_date,
                  LOWER(COALESCE(cms.status, 'pending')) AS mstatus
           FROM ${SCHEMA}.contracts c
           LEFT JOIN ${SCHEMA}.contract_month_status cms
             ON cms.contract_id = c.id AND cms.year = $3 AND cms.month = $4
           WHERE c.company_id = $1
             AND c.active = true
             AND DATE(c.start_date) <= DATE($7)
             AND DATE(c.end_date) >= DATE($8)
             AND (c.cancellation_date IS NULL OR DATE(c.cancellation_date) >= DATE($8))
         )
         SELECT
           COUNT(*)::int AS contracts_active,
           COUNT(*) FILTER (WHERE mstatus NOT IN ('paid','canceled'))::int AS contracts_pending,
           COUNT(*) FILTER (
             WHERE mstatus NOT IN ('paid','canceled')
               AND LEAST(billing_day, $5::int) = $6::int
               AND DATE(start_date) <= DATE($2) AND DATE(end_date) >= DATE($2)
               AND (cancellation_date IS NULL OR DATE(cancellation_date) >= DATE($2))
           )::int AS contracts_due_today
         FROM active_month`,
        [companyId, todayIso, year, month, daysInMonth, day, monthEnd, monthStart]
      ),
      // Clientes ativos (independe de contrato) + novos clientes criados no mês vigente.
      query(
        `SELECT
           COUNT(*) FILTER (WHERE active = true)::int AS clients_active,
           COUNT(*) FILTER (
             WHERE created_at >= $2::date AND created_at < ($2::date + INTERVAL '1 month')
           )::int AS clients_new_month
         FROM ${SCHEMA}.clients
         WHERE company_id = $1`,
        [companyId, monthStart]
      ),
    ])

    const c = contractStats.rows[0] || { contracts_active: 0, contracts_pending: 0, contracts_due_today: 0 }
    const cl = clientStats.rows[0] || { clients_active: 0, clients_new_month: 0 }

    res.json({
      totals: {
        contractsActive: c.contracts_active,
        clientsActive: cl.clients_active,
        contractsPending: c.contracts_pending,
        contractsDueToday: c.contracts_due_today,
        clientsNewMonth: cl.clients_new_month,
      },
      date: todayIso,
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
