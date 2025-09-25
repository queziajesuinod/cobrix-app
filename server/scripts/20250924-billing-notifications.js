// scripts/20250924-billing-notifications.js
require('dotenv').config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env' });
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  max: 5,
});
const schema = (process.env.DB_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g,'');

(async () => {
  const c = await pool.connect();
  try {
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await c.query(`SET search_path TO ${schema}`);

    // Unique index to prevent duplicate billings per (contract_id, billing_date)
    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE schemaname='${schema}' AND indexname='ux_billings_contract_date'
        ) THEN
          CREATE UNIQUE INDEX ux_billings_contract_date ON billings (contract_id, billing_date);
        END IF;
      END$$;
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS billing_notifications (
        id SERIAL PRIMARY KEY,
        contract_id INT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        due_date DATE NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('pre','due','late')),
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (contract_id, due_date, type)
      );
    `);

    console.log('✅ Migration 20250924 applied');
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();