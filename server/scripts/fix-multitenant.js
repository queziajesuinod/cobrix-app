// server/scripts/fix-multitenant.js
require('dotenv').config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env' });
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  max: 5
});

const schema = (process.env.DB_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g,'');

async function run() {
  const c = await pool.connect();
  try {
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await c.query(`SET search_path TO ${schema}`);

    // 1) Tabelas base
    await c.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      );
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('master','user')),
        company_id INT REFERENCES companies(id) ON DELETE SET NULL
      );
    `);

    // 2) Garantir colunas company_id em clients e contracts
    await c.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_id INT;`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS company_id INT;`);

    // 3) Empresa default, caso não exista nenhuma
    const cmp = await c.query(`SELECT id FROM companies ORDER BY id LIMIT 1`);
    let defaultCompanyId = cmp.rows[0]?.id;
    if (!defaultCompanyId) {
      const ins = await c.query(`INSERT INTO companies (name) VALUES ('Default Company') RETURNING id`);
      defaultCompanyId = ins.rows[0].id;
      console.log('Criada empresa default id=', defaultCompanyId);
    }

    // 4) Preencher company_id em clients/ contracts já existentes
    await c.query(`UPDATE clients SET company_id=$1 WHERE company_id IS NULL`, [defaultCompanyId]);
    await c.query(`
      UPDATE contracts c
      SET company_id = cl.company_id
      FROM clients cl
      WHERE c.client_id = cl.id AND c.company_id IS NULL
    `);

    // 5) FKs e NOT NULL
    await c.query(`ALTER TABLE clients DROP CONSTRAINT IF EXISTS fk_clients_company;`);
    await c.query(`ALTER TABLE clients ADD CONSTRAINT fk_clients_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;`);
    await c.query(`ALTER TABLE clients ALTER COLUMN company_id SET NOT NULL;`);

    await c.query(`ALTER TABLE contracts DROP CONSTRAINT IF EXISTS fk_contracts_company;`);
    await c.query(`ALTER TABLE contracts ADD CONSTRAINT fk_contracts_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;`);
    await c.query(`ALTER TABLE contracts ALTER COLUMN company_id SET NOT NULL;`);

    // garantir FK client_id -> clients
    await c.query(`ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_client_id_fkey;`);
    await c.query(`ALTER TABLE contracts ADD CONSTRAINT contracts_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT;`);

    // 6) Índices
    await c.query(`CREATE INDEX IF NOT EXISTS ix_clients_company ON clients (company_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_contracts_company ON contracts (company_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_billings_contract ON billings (contract_id);`);

    console.log('Migração multi-tenant concluída ✅');
  } catch (e) {
    console.error('Falha na migração:', e.message);
  } finally {
    c.release();
    await pool.end();
  }
}

run();
