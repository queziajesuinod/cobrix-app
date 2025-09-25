// server/scripts/20250925-contract-month-status.js
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
      CREATE TABLE IF NOT EXISTS contract_month_status (
        id           BIGSERIAL PRIMARY KEY,
        company_id   INTEGER NOT NULL,
        contract_id  INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        year         INTEGER NOT NULL,
        month        INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        status       TEXT    NOT NULL CHECK (status IN ('pending','paid','canceled')) DEFAULT 'pending',
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (contract_id, year, month)
      );
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cms_company_month
      ON contract_month_status (company_id, year, month);
    `)

    await client.query('COMMIT')
    console.log(`✅ contract_month_status criada no schema ${schema}`)
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
