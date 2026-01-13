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
        evo_instance TEXT,
        clients_limit INTEGER,
        contracts_limit INTEGER,
        efi_client_id_enc TEXT,
        efi_client_secret_enc TEXT,
        efi_cert_base64_enc TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS pix_key TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS evo_instance TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS clients_limit INTEGER;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS contracts_limit INTEGER;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS efi_client_id_enc TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS efi_client_secret_enc TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS efi_cert_base64_enc TEXT;`);
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
        document_cpf TEXT,
        document_cnpj TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await c.query(`ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS responsavel TEXT;`);
    await c.query(`ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS document_cpf TEXT;`);
    await c.query(`ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS document_cnpj TEXT;`);
    await c.query(`ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS contract_types (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        is_recurring BOOLEAN NOT NULL DEFAULT false,
        adjustment_percent NUMERIC(5,2) NOT NULL DEFAULT 0
      );
    `);
    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='${schema}' AND table_name='contract_types' AND column_name='company_id'
        ) THEN
          ALTER TABLE ${schema}.contract_types ADD COLUMN company_id INTEGER REFERENCES ${schema}.companies(id) ON DELETE CASCADE;
        END IF;
      END$$;
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      contract_type_id INTEGER REFERENCES ${schema}.contract_types(id),
      description TEXT NOT NULL,
      value NUMERIC(10, 2) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      billing_day INTEGER NOT NULL,
      billing_interval_months INTEGER NOT NULL DEFAULT 1,
      billing_mode TEXT NOT NULL DEFAULT 'monthly',
      billing_interval_days INTEGER,
      cancellation_date DATE,
      recurrence_of INTEGER REFERENCES ${schema}.contracts(id),
      last_billed_date DATE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS cancellation_date DATE;`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS contract_type_id INTEGER REFERENCES ${schema}.contract_types(id);`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS recurrence_of INTEGER REFERENCES ${schema}.contracts(id);`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS billing_interval_months INTEGER;`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'monthly';`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS billing_interval_days INTEGER;`);
    await c.query(`UPDATE ${schema}.contracts SET billing_mode = 'monthly' WHERE billing_mode IS NULL;`);
    await c.query(`UPDATE ${schema}.contracts SET billing_interval_months = 1 WHERE billing_interval_months IS NULL;`);
    await c.query(`ALTER TABLE ${schema}.contracts ALTER COLUMN billing_interval_months SET DEFAULT 1;`);
    await c.query(`ALTER TABLE ${schema}.contracts ALTER COLUMN billing_interval_months SET NOT NULL;`);
    await c.query(`
      INSERT INTO ${schema}.contract_types (company_id, name, is_recurring, adjustment_percent)
      SELECT c.id, 'Fixo', false, 0
      FROM ${schema}.companies c
      WHERE NOT EXISTS (
        SELECT 1 FROM ${schema}.contract_types ct
        WHERE ct.company_id = c.id AND ct.name = 'Fixo'
      )
    `);
    await c.query(`
      INSERT INTO ${schema}.contract_types (company_id, name, is_recurring, adjustment_percent)
      SELECT c.id, 'Recorrente', true, 5
      FROM ${schema}.companies c
      WHERE NOT EXISTS (
        SELECT 1 FROM ${schema}.contract_types ct
        WHERE ct.company_id = c.id AND ct.name = 'Recorrente'
      )
    `);
    await c.query(`
      WITH base AS (
        SELECT id AS old_id, name
        FROM ${schema}.contract_types
        WHERE company_id IS NULL
      )
      UPDATE ${schema}.contracts c
      SET contract_type_id = ct_new.id
      FROM base b
      JOIN ${schema}.contract_types ct_new
        ON ct_new.company_id = c.company_id AND ct_new.name = b.name
      WHERE c.contract_type_id = b.old_id;
    `);
    await c.query(`DELETE FROM ${schema}.contract_types WHERE company_id IS NULL`);
    await c.query(`
      ALTER TABLE ${schema}.contract_types
      ALTER COLUMN company_id SET NOT NULL
    `);
    await c.query(`
      UPDATE ${schema}.contracts c
      SET contract_type_id = (
        SELECT id FROM ${schema}.contract_types ct
        WHERE ct.company_id = c.company_id AND ct.name = 'Fixo'
        LIMIT 1
      )
      WHERE c.contract_type_id IS NULL
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
        gateway_txid TEXT,
        gateway_paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (contract_id, billing_date)
      );
    `);
    await c.query(`ALTER TABLE ${schema}.billings ADD COLUMN IF NOT EXISTS gateway_txid TEXT;`);
    await c.query(`ALTER TABLE ${schema}.billings ADD COLUMN IF NOT EXISTS gateway_paid_at TIMESTAMPTZ;`);
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
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = '${schema}.billing_notifications'::regclass
            AND conname = 'uq_bn_auto_one_per_kind_month'
            AND contype = 'u'
        ) THEN
          ALTER TABLE ${schema}.billing_notifications DROP CONSTRAINT uq_bn_auto_one_per_kind_month;
        END IF;
      END$$;
    `);
    await c.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bn_auto_one_per_kind_month
      ON ${schema}.billing_notifications (company_id, contract_id, type, due_month)
      WHERE kind = 'auto';
    `);
    await c.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = '${schema}.billing_notifications'::regclass
            AND contype IN ('u','x')
            AND condeferrable = true
        LOOP
          EXECUTE format('ALTER TABLE ${schema}.billing_notifications ALTER CONSTRAINT %I NOT DEFERRABLE', r.conname);
        END LOOP;
      END$$;
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
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.billing_gateway_links (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES ${schema}.contracts(id) ON DELETE CASCADE,
        billing_id INTEGER REFERENCES ${schema}.billings(id) ON DELETE SET NULL,
        due_date DATE NOT NULL,
        txid TEXT,
        loc_id TEXT,
        payment_link TEXT,
        copy_paste TEXT,
        qr_code TEXT,
        amount NUMERIC(14,2),
        status TEXT,
        expires_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        gateway_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (company_id, contract_id, due_date)
      );
    `);
    await c.query(`ALTER TABLE ${schema}.billing_gateway_links ADD COLUMN IF NOT EXISTS billing_id INTEGER REFERENCES ${schema}.billings(id) ON DELETE SET NULL;`);
    await c.query(`ALTER TABLE ${schema}.billing_gateway_links ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.contract_custom_billings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES ${schema}.contracts(id) ON DELETE CASCADE,
        billing_date DATE NOT NULL,
        amount NUMERIC(14,2),
        percentage NUMERIC(6,2),
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (contract_id, billing_date)
      );
    `);
    await c.query(`ALTER TABLE ${schema}.contract_custom_billings ALTER COLUMN amount DROP NOT NULL;`);
    await c.query(`ALTER TABLE ${schema}.contract_custom_billings ADD COLUMN IF NOT EXISTS percentage NUMERIC(6,2);`);
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
    await c.query(`
      DO $$
      BEGIN
        -- limpa unique legada em "name" sem company
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema='${schema}' AND table_name='contract_types' AND constraint_name='contract_types_name_key'
        ) THEN
          EXECUTE 'ALTER TABLE ${schema}.contract_types DROP CONSTRAINT contract_types_name_key';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema='${schema}' AND table_name='contract_types' AND constraint_name='contract_types_company_name_key'
        ) THEN
          ALTER TABLE ${schema}.contract_types ADD CONSTRAINT contract_types_company_name_key UNIQUE (company_id, name);
        END IF;
      END$$;
    `);
