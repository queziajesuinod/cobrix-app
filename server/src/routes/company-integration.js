const express = require('express')
const { query } = require('../db')
const { requireAuth } = require('./auth')
const { sendWhatsapp } = require('../services/messenger')
const { getConnectionState, restartInstance, connectInstance } = require('../services/evo-api')

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

// GET evo status
router.get('/:id/integration/evo', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, name, evo_instance FROM companies WHERE id=$1', [id])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  if (!row.evo_instance) {
    return res.json({ instance: null, connectionStatus: 'missing', state: null })
  }
  try {
    const state = await getConnectionState(row.evo_instance)
    res.json({
      instance: state?.instance?.instanceName || row.evo_instance,
      connectionStatus: state?.connectionStatus || state?.instance?.state || 'unknown',
      state
    })
  } catch (err) {
    console.error('[integration] connectionState failed', {
      companyId: id,
      instance: row.evo_instance,
      status: err.status,
      message: err.message,
      data: err.data,
    })
    res.status(err.status || 502).json({ error: err.message || 'Falha ao consultar estado', data: err.data || null })
  }
})

// POST evo restart (gera novo QR code)
router.post('/:id/integration/evo/restart', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, name, evo_instance FROM companies WHERE id=$1', [id])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  if (!row.evo_instance) return res.status(400).json({ error: 'Instância EVO não configurada' })
  try {
    const data = await restartInstance(row.evo_instance)
    res.json({
      instance: data?.instance?.instanceName || row.evo_instance,
      qrcode: data?.qrcode ?? null,
      connectionStatus: data?.connectionStatus || data?.instance?.state || 'pending',
      code: data?.code ?? null,
      pairingCode: data?.pairingCode ?? null,
      data,
    })
  } catch (err) {
    console.error('[integration] restart failed', {
      companyId: id,
      instance: row.evo_instance,
      status: err.status,
      message: err.message,
      data: err.data,
    })
    res.status(err.status || 502).json({ error: err.message || 'Falha ao reiniciar instância', data: err.data || null })
  }
})

// POST evo connect (gera QR quando status CLOSED)
router.post('/:id/integration/evo/connect', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, name, evo_instance FROM companies WHERE id=$1', [id])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  if (!row.evo_instance) return res.status(400).json({ error: 'Instância EVO não configurada' })
  try {
    const data = await connectInstance(row.evo_instance)
    res.json({
      instance: data?.instance?.instanceName || row.evo_instance,
      qrcode: data?.qrcode ?? null,
      connectionStatus: data?.connectionStatus || data?.instance?.state || 'pending',
      code: data?.code ?? null,
      pairingCode: data?.pairingCode ?? null,
      data,
    })
  } catch (err) {
    console.error('[integration] connect failed', {
      companyId: id,
      instance: row.evo_instance,
      status: err.status,
      message: err.message,
      data: err.data,
    })
    res.status(err.status || 502).json({ error: err.message || 'Falha ao conectar instância', data: err.data || null })
  }
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
