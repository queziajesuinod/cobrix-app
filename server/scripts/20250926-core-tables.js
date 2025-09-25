/**
 * Cria tabelas base se não existirem (idempotente).
 * Usa DB_SCHEMA do .env (default public).
 * Execute com:
 *   node -r dotenv/config scripts/20250926-core-tables.js dotenv_config_path=server/.env
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { Pool } = require('pg');

// tenta carregar .env do server/ ou raiz
const candidates = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '.env'),
];
for (const p of candidates) {
  if (fs.existsSync(p)) { dotenv.config({ path: p, override: true }); break; }
}

const schema = process.env.DB_SCHEMA || 'public';
const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl })
  : new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'postgres',
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
      ssl,
    });

(async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await c.query(`SET search_path TO ${schema}, public`);

    // companies
    await c.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        evo_api_url TEXT,
        evo_api_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // users
    await c.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // clients
    await c.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // contracts
    await c.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        value NUMERIC(14,2) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        billing_day INTEGER NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
        last_billed_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // billings (histórico de cobranças)
    await c.query(`
      CREATE TABLE IF NOT EXISTS billings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        billing_date DATE NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending|paid|canceled
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(contract_id, billing_date)
      )
    `);

    // notification logs (opcional, se usar)
    await c.query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        billing_date DATE NOT NULL,
        kind TEXT NOT NULL, -- pre|due|late
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        payload JSONB,
        UNIQUE(contract_id, billing_date, kind)
      )
    `);

    console.log(`✅ Core tables OK (schema: ${schema})`);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('❌ Falha core tables:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
