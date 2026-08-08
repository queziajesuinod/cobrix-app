const express = require('express')
const { query } = require('../db')
const { requireAuth, companyScope } = require('./auth')
const { requirePermission } = require('../services/permissions')
const { z } = require('zod')

const router = express.Router()
const SCHEMA = process.env.DB_SCHEMA || 'public'
const typeSchema = z.object({
  name: z.string().min(2),
  is_recurring: z.boolean(),
  adjustment_percent: z.number().min(0),
  default_task_model_id: z.number().int().positive().nullable().optional()
})
const parseModelId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)

router.get('/', requireAuth, companyScope(true), async (req, res) => {
  const companyId = Number(req.companyId)
  if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' })
  try {
    const rows = await query(
      `SELECT ct.id, ct.name, ct.is_recurring, ct.adjustment_percent, ct.created_at, ct.updated_at,
              ct.default_task_model_id,
              (SELECT m.name FROM ${SCHEMA}.task_models m WHERE m.id = ct.default_task_model_id) AS default_task_model_name,
              (SELECT COALESCE(NULLIF(cu.name,''), cu.email) FROM ${SCHEMA}.users cu WHERE cu.id = ct.created_by) AS created_by_name,
              (SELECT COALESCE(NULLIF(eu.name,''), eu.email) FROM ${SCHEMA}.users eu WHERE eu.id = ct.updated_by) AS updated_by_name
       FROM ${SCHEMA}.contract_types ct
       WHERE ct.company_id = $1
       ORDER BY ct.name ASC`,
      [companyId]
    )
    res.json(rows.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', requireAuth, companyScope(true), requirePermission('contractTypes.manage'), async (req, res) => {
  const companyId = Number(req.companyId)
  if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' })
  const parse = typeSchema.safeParse({
    name: req.body?.name,
    is_recurring: Boolean(req.body?.is_recurring),
    adjustment_percent: Number(req.body?.adjustment_percent ?? 0),
    default_task_model_id: parseModelId(req.body?.default_task_model_id)
  })
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() })
  }
  const { name, is_recurring, adjustment_percent, default_task_model_id } = parse.data
  try {
    const r = await query(
      `INSERT INTO ${SCHEMA}.contract_types (company_id, name, is_recurring, adjustment_percent, default_task_model_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, is_recurring, adjustment_percent, default_task_model_id`,
      [companyId, name.trim(), is_recurring, adjustment_percent, default_task_model_id ?? null, req.user.id]
    )
    res.status(201).json(r.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id', requireAuth, companyScope(true), requirePermission('contractTypes.manage'), async (req, res) => {
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: 'id inválido' })
  const companyId = Number(req.companyId)
  if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' })
  const parse = typeSchema.safeParse({
    name: req.body?.name,
    is_recurring: Boolean(req.body?.is_recurring),
    adjustment_percent: Number(req.body?.adjustment_percent ?? 0),
    default_task_model_id: parseModelId(req.body?.default_task_model_id)
  })
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() })
  const { name, is_recurring, adjustment_percent, default_task_model_id } = parse.data
  try {
    const r = await query(
      `UPDATE ${SCHEMA}.contract_types
       SET name=$1, is_recurring=$2, adjustment_percent=$3, default_task_model_id=$4, updated_by=$5, updated_at=now()
       WHERE id=$6 AND company_id=$7
       RETURNING id, name, is_recurring, adjustment_percent, default_task_model_id`,
      [name.trim(), is_recurring, adjustment_percent, default_task_model_id ?? null, req.user.id, id, companyId]
    )
    if (!r.rows[0]) return res.status(404).json({ error: 'Tipo não encontrado' })
    res.json(r.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', requireAuth, companyScope(true), requirePermission('contractTypes.manage'), async (req, res) => {
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: 'id inválido' })
  const companyId = Number(req.companyId)
  if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' })
  try {
    const inUse = await query(
      `SELECT 1 FROM ${SCHEMA}.contracts WHERE contract_type_id=$1 LIMIT 1`,
      [id]
    )
    if (inUse.rowCount) return res.status(400).json({ error: 'Tipo em uso por contratos' })
    const r = await query(
      `DELETE FROM ${SCHEMA}.contract_types WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, companyId]
    )
    if (!r.rows[0]) return res.status(404).json({ error: 'Tipo não encontrado' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
