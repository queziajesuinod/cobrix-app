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
const baseAllowlist = [
  'http://localhost:5173',      // Frontend local
  'http://localhost:3002',      // API local
  'http://62.72.63.137:3002',   // IP público (opcional)
  'https://cobrix.aleftec.com.br' // Domínio em produção (HTTPS)
]
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((val) => val.trim())
  .filter(Boolean)
const allowlist = [...new Set([...baseAllowlist, ...envOrigins])]
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (allowlist.includes(origin)) return cb(null, true)
    console.warn('[cors] rejection origin', origin)
    return cb(new Error('Not allowed by CORS'))
  },
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300 }))

// init DB
initDb().then(() => console.log('DB ok')).catch(err => {
  console.error('Falha init DB:', err)
  process.exit(1)
})

// rotas base já existentes no seu projeto
app.use('/api/auth', require('./routes/auth'))
app.use('/api/master', require('./routes/master'))
app.use('/api/clients', require('./routes/clients'))
app.use('/api/contracts', require('./routes/contracts'))
app.use('/api/billings', require('./routes/billings'))
app.use('/api/message-templates', require('./routes/message-templates'))
app.use('/api/contract-types', require('./routes/contract-types'))
app.use('/api/dashboard', require('./routes/dashboard'))
app.use('/api/reports', require('./routes/reports'))
app.use('/api/system', require('./routes/system-health'))

// novas rotas (fixpack v7)
app.use('/api/companies', require('./routes/companies'))
app.use('/api/companies', require('./routes/company-integration'))
app.use('/api/companies', require('./routes/company-users'))
app.use('/api/companies', require('./routes/company-users-management'))
// webhook PIX EFI (sem autenticação JWT — chamado pela EFI externamente)
app.use('/api/webhooks', require('./routes/webhooks'))
// health
app.get('/api/status', (_req, res) => res.json({ status: 'OK', schema: process.env.DB_SCHEMA || 'public', time: new Date().toISOString() }))
app.get('/healthz', (_req, res) => res.json({ ok: true }))

module.exports = app
