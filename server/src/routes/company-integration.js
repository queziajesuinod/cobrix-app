const express = require('express')
const { query } = require('../db')
const { requireAuth } = require('./auth')
const { getCompanyEvoConfig, sendWhatsapp } = require('../services/messenger')

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

// GET evo config
router.get('/:id/integration/evo', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, name, evo_api_url, evo_api_key FROM companies WHERE id=$1', [id])
  if (!r.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' })
  res.json({ evo_api_url: r.rows[0].evo_api_url || '', evo_api_key: r.rows[0].evo_api_key || '' })
})

// PUT evo config
router.put('/:id/integration/evo', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canWrite(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const { evo_api_url, evo_api_key } = req.body || {}
  await query('UPDATE companies SET evo_api_url=$1, evo_api_key=$2 WHERE id=$3', [evo_api_url || null, evo_api_key || null, id])
  res.json({ ok: true })
})

// POST evo test
router.post('/:id/integration/evo/test', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const { number, text } = req.body || {}
  if (!number || !text) return res.status(400).json({ error: 'number e text são obrigatórios' })
  try{
    const r = await sendWhatsapp(id, { number, text })
    res.json(r)
  }catch(e){
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
