const express = require('express')
const { query } = require('../db')
const { requireAuth, companyScope } = require('./auth')
const { z } = require('zod')

const router = express.Router()
const SCHEMA = process.env.DB_SCHEMA || 'public'
const typeSchema = z.object({
  name: z.string().min(2),
  is_recurring: z.boolean(),
  adjustment_percent: z.number().min(0)
})

router.get('/', requireAuth, companyScope(true), async (req, res) => {
  const companyId = Number(req.companyId)
  if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' })
  try {
    const rows = await query(
      `SELECT id, name, is_recurring, adjustment_percent
       FROM ${SCHEMA}.contract_types
       WHERE company_id = $1
       ORDER BY name ASC`,
      [companyId]
    )
    res.json(rows.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', requireAuth, companyScope(true), async (req, res) => {
  const companyId = Number(req.companyId)
  if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' })
  const parse = typeSchema.safeParse({
    name: req.body?.name,
    is_recurring: Boolean(req.body?.is_recurring),
    adjustment_percent: Number(req.body?.adjustment_percent ?? 0)
  })
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() })
  }
  const { name, is_recurring, adjustment_percent } = parse.data
  try {
    const r = await query(
      `INSERT INTO ${SCHEMA}.contract_types (company_id, name, is_recurring, adjustment_percent)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, is_recurring, adjustment_percent`,
      [companyId, name.trim(), is_recurring, adjustment_percent]
    )
    res.status(201).json(r.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id', requireAuth, companyScope(true), async (req, res) => {
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: 'id inválido' })
  const companyId = Number(req.companyId)
  if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa' })
  const parse = typeSchema.safeParse({
    name: req.body?.name,
    is_recurring: Boolean(req.body?.is_recurring),
    adjustment_percent: Number(req.body?.adjustment_percent ?? 0)
  })
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() })
  const { name, is_recurring, adjustment_percent } = parse.data
  try {
    const r = await query(
      `UPDATE ${SCHEMA}.contract_types
       SET name=$1, is_recurring=$2, adjustment_percent=$3
       WHERE id=$4 AND company_id=$5
       RETURNING id, name, is_recurring, adjustment_percent`,
      [name.trim(), is_recurring, adjustment_percent, id, companyId]
    )
    if (!r.rows[0]) return res.status(404).json({ error: 'Tipo não encontrado' })
    res.json(r.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', requireAuth, companyScope(true), async (req, res) => {
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
