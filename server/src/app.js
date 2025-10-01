// server/src/app.js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const { initDb } = require('./db')
const app = express()


app.use(helmet())
const allowlist = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean)
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

// novas rotas (fixpack v7)
app.use('/api/companies', require('./routes/companies'))
app.use('/api/companies', require('./routes/company-integration'))
app.use('/api/companies', require('./routes/company-users'))
// health
app.get('/api/status', (_req, res) => res.json({ status: 'OK', schema: process.env.DB_SCHEMA || 'public', time: new Date().toISOString() }))
app.get('/healthz', (_req, res) => res.json({ ok: true }))

module.exports = app