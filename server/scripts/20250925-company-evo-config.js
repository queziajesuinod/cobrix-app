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
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    await client.query(`SET search_path TO ${schema}, public`)

    await client.query(`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS evo_api_url TEXT,
        ADD COLUMN IF NOT EXISTS evo_api_key TEXT
    `)

    await client.query('COMMIT')
    console.log(`✅ companies.evo_api_url / evo_api_key criadas no schema ${schema}`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ Falha na migração:', e.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
