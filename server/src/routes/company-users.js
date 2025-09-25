const express = require('express')
const bcrypt = require('bcryptjs')
const { query } = require('../db')
const { requireAuth } = require('./auth')

const router = express.Router()

function isMaster(u){ return u?.role === 'master' }
function canWrite(user, selectedCompanyId, targetCompanyId){
  if (isMaster(user)) return true
  if (user?.role === 'admin') return Number(selectedCompanyId) === Number(targetCompanyId)
  return false
}
function canRead(user, selectedCompanyId, targetCompanyId){
  if (isMaster(user)) return true
  return Number(selectedCompanyId) === Number(targetCompanyId)
}

// GET users by company
router.get('/:id/users', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, email, role, active FROM users WHERE company_id=$1 ORDER BY id DESC', [id])
  res.json(r.rows)
})

// POST create user in company
router.post('/:id/users', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canWrite(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const { email, password, role } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email e password obrigatórios' })
const hash = await bcrypt.hash(password + `::company:${companyId}`, 12);

  const r = await query(
    'INSERT INTO users (email, password_hash, role, company_id, active) VALUES ($1,$2,$3,$4,true) RETURNING id, email, role, active',
    [String(email).trim(), hash, role || 'user', id]
  )
  res.status(201).json(r.rows[0])
})

// PUT update user (role/active)
router.put('/:id/users/:userId', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const userId = Number(req.params.userId)
  if (!canWrite(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const { role, active } = req.body || {}
  const r = await query(
    'UPDATE users SET role=COALESCE($1, role), active=COALESCE($2, active) WHERE id=$3 AND company_id=$4 RETURNING id, email, role, active',
    [role || null, typeof active === 'boolean' ? active : null, userId, id]
  )
  if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' })
  res.json(r.rows[0])
})

// DELETE (soft delete -> active=false)
router.delete('/:id/users/:userId', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const userId = Number(req.params.userId)
  if (!canWrite(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('UPDATE users SET active=false WHERE id=$1 AND company_id=$2 RETURNING id', [userId, id])
  if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' })
  res.json({ ok: true })
})

module.exports = router
