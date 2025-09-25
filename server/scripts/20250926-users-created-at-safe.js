/**
 * Garante coluna created_at em users se a tabela existir.
 * Execute com:
 *   node -r dotenv/config scripts/20250926-users-created-at-safe.js dotenv_config_path=server/.env
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { Pool } = require('pg');

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
    await c.query(`SET search_path TO ${schema}, public`);

    const exists = await c.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = 'users'
      LIMIT 1
    `, [schema]);
    if (!exists.rowCount) {
      console.log('ℹ️ Tabela users não existe; nada a fazer.');
      await c.query('ROLLBACK');
      return;
    }

    await c.query(`
      DO $$ BEGIN
        BEGIN
          ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
        EXCEPTION WHEN duplicate_column THEN
          -- ok se já existe
        END;
      END $$;
    `);

    await c.query('COMMIT');
    console.log('✅ users.created_at garantido');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('❌ Falha:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
