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
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        evo_api_url TEXT,
        evo_api_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    await c.query(`
      DO $$ BEGIN
        BEGIN
          ALTER TABLE users ADD COLUMN company_id INTEGER;
        EXCEPTION WHEN duplicate_column THEN
          -- ignore
        END;
      END $$;
    `)

    await c.query(`
      DO $$ BEGIN
        ALTER TABLE users
          ADD CONSTRAINT fk_users_company
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN
        -- ignore
      END $$;
    `)

    await c.query('COMMIT')
    console.log('✅ companies core OK (schema: ' + schema + ')')
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
