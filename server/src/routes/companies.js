const express = require('express')
const { query } = require('../db')
const { requireAuth } = require('./auth')

const router = express.Router()

function isMaster(user){ return user?.role === 'master' }
function canReadCompany(user, selectedCompanyId, targetCompanyId){
  if (isMaster(user)) return true
  return Number(selectedCompanyId) === Number(targetCompanyId)
}
function canWriteCompany(user, selectedCompanyId, targetCompanyId){
  if (isMaster(user)) return true
  if (user?.role === 'admin') return Number(selectedCompanyId) === Number(targetCompanyId)
  return false
}

// LIST all (master)
router.get('/', requireAuth, async (req, res) => {
  console.log("Usuario Logado:" + req.user)
  if (!isMaster(req.user)) return res.status(403).json({ error: 'Apenas master lista todas as empresas' })
  const r = await query('SELECT id, name, evo_api_url, evo_api_key, created_at FROM companies ORDER BY id DESC')
  res.json(r.rows)
})

// GET by id
router.get('/:id', requireAuth,async (req, res) => {
  const id = Number(req.params.id)
  if (!canReadCompany(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, name, evo_api_url, evo_api_key, created_at FROM companies WHERE id=$1', [id])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  res.json(row)
})

// CREATE (master)
router.post('/', requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: 'Apenas master cria empresa' })
  const { name, evo_api_url, evo_api_key } = req.body || {}
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'Nome obrigatório' })
  const r = await query(
    'INSERT INTO companies (name, evo_api_url, evo_api_key) VALUES ($1,$2,$3) RETURNING id, name',
    [String(name).trim(), evo_api_url || null, evo_api_key || null]
  )
  res.status(201).json(r.rows[0])
})

// UPDATE (master/admin)
router.put('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canWriteCompany(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const { name } = req.body || {}
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'Nome obrigatório' })
  const r = await query('UPDATE companies SET name=$1 WHERE id=$2 RETURNING id, name', [String(name).trim(), id])
  if (!r.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' })
  res.json(r.rows[0])
})

// DELETE (master)
router.delete('/:id', requireAuth, requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: 'Apenas master remove empresa' })
  const id = Number(req.params.id)
  const r = await query('DELETE FROM companies WHERE id=$1 RETURNING id', [id])
  if (!r.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' })
  res.json({ ok: true })
})

module.exports = router
