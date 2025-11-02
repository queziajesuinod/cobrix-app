const { Pool } = require("pg");
const { AsyncLocalStorage } = require("async_hooks");

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  max: 10,
  idleTimeoutMillis: 30000,
});
const schema = (process.env.DB_SCHEMA || "public").replace(/[^a-zA-Z0-9_]/g,"");

const als = new AsyncLocalStorage();

async function initDb() {
  await withClient(async (c) => {
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await c.query(`SET search_path TO ${schema}`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        evo_api_url TEXT,
        evo_api_key TEXT,
        pix_key TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS pix_key TEXT;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    // Remover company_id da tabela users se existir
    await c.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'users' AND column_name = 'company_id') THEN
          ALTER TABLE users DROP COLUMN company_id;
        END IF;
      END
      $$;
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS user_companies (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, company_id)
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        responsavel TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await c.query(`ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS responsavel TEXT;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        value NUMERIC(10, 2) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        billing_day INTEGER NOT NULL,
        last_billed_date DATE,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS contract_month_status (
        id SERIAL PRIMARY KEY,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, paid, canceled
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (contract_id, year, month)
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS billings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        billing_date DATE NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, paid, canceled
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (contract_id, billing_date)
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS billing_notifications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        billing_id INTEGER REFERENCES billings(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, -- 'auto' or 'manual'
        target_date DATE NOT NULL,
        status TEXT NOT NULL, -- 'sent', 'failed'
        provider TEXT NOT NULL,
        to_number TEXT,
        message TEXT,
        provider_status TEXT,
        provider_response TEXT,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        sent_at TIMESTAMPTZ,
        type TEXT, -- 'pre', 'due', 'late'
        due_date DATE,
        due_month TEXT GENERATED ALWAYS AS (EXTRACT(YEAR FROM due_date) || '-' || LPAD(EXTRACT(MONTH FROM due_date)::text, 2, '0')) STORED,
        UNIQUE (company_id, contract_id, type, due_month)
      );
    `);
    await c.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bn_auto_one_per_kind_month
      ON ${schema}.billing_notifications (company_id, contract_id, type, due_month)
      WHERE kind = 'auto';
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        template TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (company_id, type)
      );
    `);
  });
}

function getStoreClient() {
  const store = als.getStore();
  return store?.client || null;
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${schema}`);
    return await fn(client);
  } finally {
    client.release();
  }
}

async function query(text, params) {
  const c = getStoreClient();
  if (c) return c.query(text, params);
  // Fallback to set search_path then run query
  await pool.query(`SET search_path TO ${schema}`);
  return pool.query(text, params);
}

// Middleware: attach request-scoped client + set app.company_id
async function dbRequestContext(req, res, next) {
  const cidHeader = req.header("X-Company-Id");
  const companyId = cidHeader ? parseInt(cidHeader, 10) : null;

  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${schema}`);
    if (companyId && Number.isInteger(companyId)) {
      await client.query(`SELECT set_config('app.company_id', $1, false)`, [String(companyId)]);
      req.companyId = companyId;
    } else {
      await client.query(`RESET app.company_id`);
      req.companyId = null;
    }

    als.run({ client }, () => {
      res.on("finish", async () => {
        try { await client.query('RESET app.company_id'); } catch {}
        client.release();
      });
      next();
    });
  } catch (e) {
    client.release();
    next(e);
  }
}

module.exports = { pool, initDb, withClient, query, dbRequestContext };
