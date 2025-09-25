require('dotenv').config()
const { Pool } = require('pg')

const schema = process.env.DB_SCHEMA || 'public'
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

async function main() {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    await c.query(`SET search_path TO ${schema}, public`)

    await c.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE
    `)

    await c.query('COMMIT')
    console.log('✅ Migração aplicada: users.active')
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('❌ Falha migração:', e.message)
    process.exitCode = 1
  } finally {
    c.release()
    await pool.end()
  }
}
main()
