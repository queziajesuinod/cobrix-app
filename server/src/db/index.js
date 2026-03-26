const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

// Por padrão o pg converte colunas DATE (OID 1082) para Date objects JavaScript
// definidos como midnight UTC. Com qualquer timezone brasileiro (UTC-3 / UTC-4)
// isso causa um off-by-one: '2024-03-01T00:00:00Z' vira 29/02 no horário local.
// Solução: receber DATE como string 'YYYY-MM-DD' — ensureDateOnly() já trata isso.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  max: 10,
  idleTimeoutMillis: 30000,
});
const schema = (process.env.DB_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g,'');

const als = new AsyncLocalStorage();

async function initDb() {
  await withClient(async (c) => {
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await c.query(`SET search_path TO ${schema}`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS billings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        billing_date DATE NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        gateway_txid TEXT,
        gateway_paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(contract_id, billing_date)
      );
    `);
    await c.query(`ALTER TABLE ${schema}.billings ADD COLUMN IF NOT EXISTS gateway_txid TEXT;`);
    await c.query(`ALTER TABLE ${schema}.billings ADD COLUMN IF NOT EXISTS gateway_paid_at TIMESTAMPTZ;`);
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
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'monthly';`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS billing_interval_days INTEGER;`);
    await c.query(`UPDATE ${schema}.contracts SET billing_mode = 'monthly' WHERE billing_mode IS NULL;`);
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

    // Tabela de notificações (criada aqui caso não exista ainda)
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.billing_notifications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        billing_id INTEGER REFERENCES ${schema}.billings(id) ON DELETE SET NULL,
        contract_id INTEGER NOT NULL REFERENCES ${schema}.contracts(id) ON DELETE CASCADE,
        client_id INTEGER REFERENCES ${schema}.clients(id) ON DELETE SET NULL,
        kind TEXT NOT NULL,
        target_date DATE,
        status TEXT NOT NULL DEFAULT 'pending',
        provider TEXT,
        to_number TEXT,
        message TEXT,
        provider_status INTEGER,
        provider_response TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sent_at TIMESTAMPTZ,
        type TEXT,
        due_date DATE,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TIMESTAMPTZ
      );
    `);
    // Colunas de retry em tabelas já existentes (idempotente — precisa vir antes do índice)
    await c.query(`ALTER TABLE ${schema}.billing_notifications ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;`);
    await c.query(`ALTER TABLE ${schema}.billing_notifications ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;`);

    // Backfill: preenche type=NULL com o valor de kind quando kind é 'pre','due','late'.
    // Isso acontece quando a coluna 'type' foi adicionada depois dos registros existirem.
    // Sem esse fix, o overview agrupa por type=NULL e os chips nunca pintam.
    await c.query(`
      UPDATE ${schema}.billing_notifications
         SET type = kind
       WHERE type IS NULL
         AND kind IN ('pre','due','late');
    `);

    // Antes de criar o índice único, remove duplicatas mantendo o registro mais recente
    // de cada grupo (company_id, contract_id, kind, due_date).
    // Isso é necessário porque registros anteriores podem ter sido inseridos sem constraint.
    await c.query(`
      DELETE FROM ${schema}.billing_notifications
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY company_id, contract_id, kind, due_date
                   ORDER BY id DESC
                 ) AS rn
          FROM ${schema}.billing_notifications
          WHERE due_date IS NOT NULL
        ) sub
        WHERE rn > 1
      );
    `);

    // Índice único: uma notificação por (empresa, contrato, tipo, data_vencimento)
    await c.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bn_company_contract_kind_due
        ON ${schema}.billing_notifications (company_id, contract_id, kind, due_date)
        WHERE due_date IS NOT NULL;
    `);
    // Índice para queries de retry
    await c.query(`
      CREATE INDEX IF NOT EXISTS idx_bn_retry
        ON ${schema}.billing_notifications (status, retry_count, created_at)
        WHERE status = 'failed';
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
  // withClient garante que SET search_path e a query usam a mesma conexão
  return withClient((client) => client.query(text, params));
}

// Middleware: attach request-scoped client + set app.company_id
async function dbRequestContext(req, res, next) {
  const cidHeader = req.header('X-Company-Id');
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
      res.on('finish', async () => {
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
