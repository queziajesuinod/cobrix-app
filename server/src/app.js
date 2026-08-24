// server/src/app.js
require('dotenv').config()
// TZ deve coincidir com CRON_TZ para que new Date() dentro dos cron jobs
// retorne a hora local correta. Hardcode anterior 'America/Sao_Paulo' (UTC-3)
// conflitava com CRON_TZ=America/Campo_Grande (UTC-4) causando datas erradas.
process.env.TZ = process.env.CRON_TZ || 'America/Campo_Grande'
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const { initDb } = require('./db/index')
const app = express()


app.use(helmet())
// Allowlist de CORS. localhost é sempre permitido (não é explorável via CORS —
// um site atacante não consegue forjar Origin: localhost no navegador da vítima)
// e é necessário para rodar o build localmente. Origens extras (domínios/IPs de
// produção) vêm de ALLOWED_ORIGINS. O domínio de produção entra por padrão.
const baseAllowlist = [
  'http://localhost:5173',
  'http://localhost:3002',
  'https://cobrix.aleftec.com.br',
]
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((val) => val.trim())
  .filter(Boolean)
const allowlist = [...new Set([...baseAllowlist, ...envOrigins])]
app.use(cors({
  origin: (origin, cb) => {
    // Sem Origin (mesma origem, curl, apps nativos) → permite.
    if (!origin) return cb(null, true)
    if (allowlist.includes(origin)) return cb(null, true)
    console.warn('[cors] rejection origin', origin)
    // 403 explícito em vez de estourar como erro 500 no handler global.
    const err = new Error('Origem não permitida por CORS')
    err.status = 403
    return cb(err)
  },
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300 }))

// Limite mais estrito para o login (mitiga brute force). Fica ANTES do mount de
// /api/auth para valer só nas rotas de autenticação.
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }))

// Endpoints públicos NÃO autenticados que criam recursos ou enumeram dados
// (signup cria empresa+usuário+PIX; validação de cupom). Limite estrito para
// mitigar abuso/spam/enumeração. Fica ANTES do mount de /api/public.
app.use('/api/public/signup', rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false }))
app.use('/api/public/coupon', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }))

// Row-Level Security (opcional, DESLIGADO por padrão). Quando ENABLE_RLS=true,
// cada request roda num cliente de banco com app.company_id setado, permitindo
// que as policies RLS filtrem por empresa no nível do banco (defesa em
// profundidade além dos filtros `WHERE company_id`).
// Pré-requisitos para habilitar (ver RUNBOOK.md):
//   1. Aplicar as policies (migration rls-policies);
//   2. Rodar o app como role NÃO-owner das tabelas + FORCE ROW LEVEL SECURITY;
//   3. Ajustar os cron jobs para setar app.company_id por empresa (ainda não
//      fazem isso — habilitar sem esse passo bloquearia as cobranças).
if (process.env.ENABLE_RLS === 'true') {
  const { dbRequestContext } = require('./db')
  app.use('/api', dbRequestContext)
  console.log('[rls] ENABLE_RLS=true — dbRequestContext montado (app.company_id por request)')
}

// init DB + seed dos perfis-modelo de permissão
const { seedPermissions } = require('./services/permissions')
initDb()
  .then(async () => {
    console.log('DB ok')
    try { await seedPermissions() } catch (e) { console.error('Falha ao semear permissões:', e.message) }
  })
  .catch(err => {
    console.error('Falha init DB:', err)
    process.exit(1)
  })

// rotas base já existentes no seu projeto
app.use('/api/auth', require('./routes/auth'))
app.use('/api/master', require('./routes/master'))
app.use('/api/master', require('./routes/master-subscriptions'))
app.use('/api/subscriptions', require('./routes/subscriptions'))
app.use('/api/clients', require('./routes/clients'))
app.use('/api/contracts', require('./routes/contracts'))
app.use('/api/billings', require('./routes/billings'))
app.use('/api/message-templates', require('./routes/message-templates'))
app.use('/api/contract-types', require('./routes/contract-types'))
app.use('/api/dashboard', require('./routes/dashboard'))
app.use('/api/reports', require('./routes/reports'))
app.use('/api/system', require('./routes/system-health'))
app.use('/api/billing-backfill', require('./routes/billing-backfill'))
app.use('/api/notifications', require('./routes/notifications'))
app.use('/api/public', require('./routes/public'))
app.use('/api/permissions', require('./routes/permissions'))
app.use('/api/plans', require('./routes/plans'))
app.use('/api/coupons', require('./routes/coupons'))
app.use('/api/partner-commissions', require('./routes/partner-commissions'))
app.use('/api/finance', require('./routes/finance'))
app.use('/api/tasks', require('./routes/tasks'))
app.use('/api/menu', require('./routes/menu'))

// novas rotas (fixpack v7)
app.use('/api/companies', require('./routes/companies'))
app.use('/api/companies', require('./routes/company-integration'))
app.use('/api/companies', require('./routes/company-users'))
app.use('/api/companies', require('./routes/company-users-management'))
// webhook PIX EFI (sem autenticação JWT — chamado pela EFI externamente)
app.use('/api/webhooks', require('./routes/webhooks'))
// health
app.get('/api/status', (_req, res) => res.json({ status: 'OK', schema: process.env.DB_SCHEMA || 'public', time: new Date().toISOString() }))
// Liveness: o processo está de pé (barato, sem dependências).
app.get('/healthz', (_req, res) => res.json({ ok: true }))
// Readiness: valida conectividade com o banco — para uptime monitor / orquestrador.
app.get('/readyz', async (_req, res) => {
  const { query } = require('./db')
  try {
    await query('SELECT 1')
    res.json({ ok: true, db: true })
  } catch (err) {
    res.status(503).json({ ok: false, db: false, error: 'db unreachable' })
  }
})

// Middleware final de erro — captura throws/next(err) não tratados e responde
// sem vazar detalhes internos. Deve ser o último `app.use`.
app.use(require('./utils/http-error').errorHandler)

module.exports = app
