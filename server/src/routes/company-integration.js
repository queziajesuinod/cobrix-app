const express = require('express')
const { query } = require('../db')
const { requireAuth } = require('./auth')
const { sendWhatsapp } = require('../services/messenger')
const { getConnectionState, restartInstance, connectInstance, getQrCode, fetchInstances, resolveBase, createInstance, formatInstanceName, buildSendUrl } = require('../services/evo-api')
const { encryptSecret } = require('../utils/secret-box')
const { sendEmail } = require('../services/mailer')

const SCHEMA = process.env.DB_SCHEMA || 'public'
const router = express.Router()

function isMaster(u){ return u?.role === 'master' }
function canWrite(user, selectedCompanyId, targetCompanyId){
  if (isMaster(user)) return true
  if (user?.role === 'admin') return Number(selectedCompanyId) === Number(targetCompanyId)
  return false
}
function canRead(user, selectedCompanyId, targetCompanyId){
  // Integração (QR do WhatsApp, status/host SMTP, teste de envio) é dado
  // sensível de administração — restrito a admin/master, não a qualquer usuário
  // comum da empresa. Escrita já usava canWrite; leitura agora tem o mesmo gate.
  if (isMaster(user)) return true
  if (user?.role === 'admin') return Number(selectedCompanyId) === Number(targetCompanyId)
  return false
}

function formatEvoResponse(row, data) {
  return {
    instance: data?.instance?.instanceName || row.evo_instance,
    qrcode: data?.qrcode ?? null,
    connectionStatus: data?.connectionStatus || data?.instance?.state || 'pending',
    code: data?.code ?? null,
    pairingCode: data?.pairingCode ?? null,
    data,
  };
}

// GET evo status
router.get('/:id/integration/evo', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, name, evo_instance, evo_api_url, evo_api_key FROM companies WHERE id=$1', [id])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  if (!row.evo_instance) {
    return res.json({ instance: null, connectionStatus: 'missing', state: null })
  }
  const evoOptions = {
    baseOverride: resolveBase(row.evo_api_url) || null,
    apiKeyOverride: row.evo_api_key || null,
  }
  try {
    const state = await getConnectionState(row.evo_instance, evoOptions)
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

// POST evo create — cria a instância Evolution para a empresa e persiste a config.
// Necessário para empresas provisionadas pelo signup público (que não criam
// instância). Reaproveita o mesmo padrão de companies.js (createInstance +
// buildSendUrl + EVO_API_KEY). No-op idempotente se a instância já existir.
router.post('/:id/integration/evo/create', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canWrite(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, name, evo_instance FROM companies WHERE id=$1', [id])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  if (row.evo_instance) {
    return res.status(409).json({ error: 'A empresa já possui uma instância configurada', instance: row.evo_instance })
  }
  if (!process.env.EVO_API_URL || !process.env.EVO_API_KEY) {
    return res.status(500).json({ error: 'EVO_API_URL/EVO_API_KEY não configuradas no servidor' })
  }
  const requested = typeof req.body?.instanceName === 'string' && req.body.instanceName.trim()
    ? formatInstanceName(req.body.instanceName, id)
    : formatInstanceName(row.name, id)
  try {
    await createInstance(requested)
    const sendUrl = buildSendUrl(requested)
    await query(
      'UPDATE companies SET evo_instance=$1, evo_api_url=$2, evo_api_key=$3 WHERE id=$4',
      [requested, sendUrl || null, process.env.EVO_API_KEY || null, id]
    )
    res.status(201).json({ ok: true, instance: requested, connectionStatus: 'created' })
  } catch (err) {
    console.error('[integration] create instance failed', {
      companyId: id,
      instance: requested,
      status: err.status,
      message: err.message,
      data: err.data,
    })
    res.status(err.status || 502).json({ error: err.message || 'Falha ao criar instância', data: err.data || null })
  }
})

// POST evo restart (gera novo QR code)
router.post('/:id/integration/evo/restart', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, name, evo_instance, evo_api_url, evo_api_key FROM companies WHERE id=$1', [id])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  if (!row.evo_instance) return res.status(400).json({ error: 'Instância EVO não configurada' })
  const evoOptions = {
    baseOverride: resolveBase(row.evo_api_url) || null,
    apiKeyOverride: row.evo_api_key || null,
  }
  try {
    const data = await restartInstance(row.evo_instance, evoOptions)
    res.json(formatEvoResponse(row, data))
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
  const r = await query('SELECT id, name, evo_instance, evo_api_url, evo_api_key FROM companies WHERE id=$1', [id])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  if (!row.evo_instance) return res.status(400).json({ error: 'Instância EVO não configurada' })
  const evoOptions = {
    baseOverride: resolveBase(row.evo_api_url) || null,
    apiKeyOverride: row.evo_api_key || null,
  }
  try {
    const data = await connectInstance(row.evo_instance, evoOptions)
    let fetched = null
    try {
      fetched = await fetchInstances(row.evo_instance, evoOptions)
    } catch (fetchErr) {
      console.warn('[integration] fetchInstances after connect failed', {
        companyId: id,
        instance: row.evo_instance,
        status: fetchErr.status,
        message: fetchErr.message,
      })
    }
    const payload = formatEvoResponse(row, data)
    payload.fetchInstances = fetched
    res.json(payload)
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

// GET evo qr code (polling)
router.get('/:id/integration/evo/qrcode', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query('SELECT id, name, evo_instance, evo_api_url, evo_api_key FROM companies WHERE id=$1', [id])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  if (!row.evo_instance) return res.status(400).json({ error: 'Instância EVO não configurada' })
  const evoOptions = {
    baseOverride: resolveBase(row.evo_api_url) || null,
    apiKeyOverride: row.evo_api_key || null,
  }
  try {
    let data = await getQrCode(row.evo_instance, evoOptions)
    if ((!data?.qrcode && !data?.pairingCode) || data?.connectionStatus === 'close') {
      data = await connectInstance(row.evo_instance, evoOptions)
    }
    res.json(formatEvoResponse(row, data))
  } catch (err) {
    if (err.status === 425 || err.status === 404) {
      try {
        const regenerated = await connectInstance(row.evo_instance, evoOptions)
        return res.json(formatEvoResponse(row, regenerated))
      } catch (inner) {
        console.error('[integration] qrcode connect fallback failed', {
          companyId: id,
          instance: row.evo_instance,
          status: inner.status,
          message: inner.message,
          data: inner.data,
        })
        return res.status(inner.status || 502).json({ error: inner.message || 'Falha ao gerar novo QR Code', data: inner.data || null })
      }
    }
    console.error('[integration] qrcode failed', {
      companyId: id,
      instance: row.evo_instance,
      status: err.status,
      message: err.message,
      data: err.data,
    })
    res.status(err.status || 502).json({ error: err.message || 'Falha ao consultar QR Code', data: err.data || null })
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

// ===== Integração de E-mail (SMTP por empresa) =====

// GET config de e-mail (nunca devolve a senha em claro — só flag has_password).
router.get('/:id/integration/email', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const r = await query(
    `SELECT email_provider, email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc,
            email_from, email_secure, email_enabled
       FROM ${SCHEMA}.companies WHERE id=$1`,
    [id]
  )
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Empresa não encontrada' })
  res.json({
    provider: row.email_provider || 'smtp',
    host: row.email_smtp_host || '',
    port: row.email_smtp_port || null,
    user: row.email_smtp_user || '',
    from: row.email_from || '',
    secure: Boolean(row.email_secure),
    enabled: Boolean(row.email_enabled),
    has_password: Boolean(row.email_smtp_pass_enc),
  })
})

// PUT config de e-mail. A senha só é atualizada quando enviada (não vazia);
// deixar o campo em branco mantém a senha atual.
router.put('/:id/integration/email', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canWrite(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const b = req.body || {}
  const provider = b.provider === 'gmail' ? 'gmail' : 'smtp'
  const user = b.user != null ? String(b.user).trim() : ''
  const enabled = Boolean(b.enabled)

  // No modo Gmail o servidor é fixo (smtp.gmail.com:465/SSL) e o "from" cai no
  // próprio endereço quando não informado. No modo SMTP tudo vem do formulário.
  let host, port, secure, from
  if (provider === 'gmail') {
    host = 'smtp.gmail.com'
    port = 465
    secure = true
    from = (b.from != null && String(b.from).trim()) || user
  } else {
    host = b.host != null ? String(b.host).trim() : ''
    port = b.port ? Number(b.port) : null
    secure = Boolean(b.secure)
    from = b.from != null ? String(b.from).trim() : ''
    if (port != null && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
      return res.status(400).json({ error: 'Porta SMTP inválida' })
    }
  }
  try {
    // Atualiza a senha apenas se veio uma nova (não vazia).
    if (typeof b.password === 'string' && b.password.length > 0) {
      const enc = encryptSecret(b.password)
      await query(
        `UPDATE ${SCHEMA}.companies
            SET email_provider=$1, email_smtp_host=$2, email_smtp_port=$3, email_smtp_user=$4,
                email_smtp_pass_enc=$5, email_from=$6, email_secure=$7, email_enabled=$8
          WHERE id=$9`,
        [provider, host || null, port, user || null, enc, from || null, secure, enabled, id]
      )
    } else {
      await query(
        `UPDATE ${SCHEMA}.companies
            SET email_provider=$1, email_smtp_host=$2, email_smtp_port=$3, email_smtp_user=$4,
                email_from=$5, email_secure=$6, email_enabled=$7
          WHERE id=$8`,
        [provider, host || null, port, user || null, from || null, secure, enabled, id]
      )
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST teste de e-mail — envia um e-mail simples para validar o SMTP.
router.post('/:id/integration/email/test', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!canRead(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' })
  const to = req.body?.to ? String(req.body.to).trim() : null
  if (!to) return res.status(400).json({ error: 'Informe um e-mail de destino' })
  try {
    const result = await sendEmail(id, {
      to,
      subject: 'Teste de e-mail — GERO',
      html: '<p>Se você recebeu esta mensagem, a integração de e-mail da empresa está funcionando. 🎉</p>',
      text: 'Se você recebeu esta mensagem, a integração de e-mail da empresa está funcionando.',
    })
    if (!result.ok) return res.status(result.skipped ? 400 : 502).json({ error: result.error || 'Falha ao enviar e-mail' })
    res.json({ ok: true, result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
