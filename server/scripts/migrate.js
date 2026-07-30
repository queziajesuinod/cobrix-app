// server/scripts/migrate.js
// Runner de migrations simples e rastreável:
//  - aplica os arquivos .sql de server/migrations/ em ordem alfabética
//  - registra os aplicados em schema_migrations (idempotente)
//  - cada arquivo roda em sua própria transação (BEGIN/COMMIT/ROLLBACK)
// Uso: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const schema = (process.env.DB_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g, '');
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 3,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedRes = await client.query('SELECT id FROM schema_migrations');
    const applied = new Set(appliedRes.rows.map((r) => r.id));

    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
      : [];

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`▶ aplicando ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(`SET search_path TO ${schema}, public`);
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
        console.log(`✅ ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`❌ ${file}: ${e.message}`);
        process.exitCode = 1;
        return;
      }
    }

    console.log(ran === 0 ? `Nada a aplicar — schema "${schema}" atualizado.` : `${ran} migration(s) aplicada(s) no schema "${schema}".`);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
