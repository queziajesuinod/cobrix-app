// server/src/app.js
require('dotenv').config()
process.env.TZ = 'America/Sao_Paulo'
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const { initDb } = require('./db/index')
const app = express()


app.use(helmet())
const allowlist = [
  'http://localhost:5173',      // Frontend local
  'http://localhost:3006',      // API local
  'http://62.72.63.137:3002',     // IP público (opcional)
  'https://cobrix.aleftec.com.br' // Domínio em produção (HTTPS)
]
app.use(cors({
  origin: (origin, cb) => { if (!origin || allowlist.includes(origin)) return cb(null, true); return cb(new Error('Not allowed by CORS')) },
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

// novas rotas (fixpack v7)
app.use('/api/companies', require('./routes/companies'))
app.use('/api/companies', require('./routes/company-integration'))
app.use('/api/companies', require('./routes/company-users'))
app.use('/api/companies', require('./routes/company-users-management'))
// health
app.get('/api/status', (_req, res) => res.json({ status: 'OK', schema: process.env.DB_SCHEMA || 'public', time: new Date().toISOString() }))
app.get('/healthz', (_req, res) => res.json({ ok: true }))

module.exports = app
