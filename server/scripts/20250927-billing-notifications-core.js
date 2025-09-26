// server/scripts/20250927-billing-notifications-core.js
require('dotenv').config();
const { Pool } = require('pg');

const schema = process.env.DB_SCHEMA || 'public';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST,
  port: +(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // garante schema no search_path para esta sessão
    await client.query(`SET search_path TO ${schema}, public`);

    // tabela principal de logs de notificações
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.billing_notifications (
        id                BIGSERIAL PRIMARY KEY,
        company_id        INT NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        billing_id        INT NULL REFERENCES ${schema}.billings(id) ON DELETE SET NULL,
        contract_id       INT NOT NULL REFERENCES ${schema}.contracts(id) ON DELETE CASCADE,
        client_id         INT NOT NULL REFERENCES ${schema}.clients(id) ON DELETE CASCADE,

        -- tipo de notificação
        kind              TEXT NOT NULL CHECK (kind IN ('pre','due','late','manual')),

        -- data de referência da cobrança (ex.: vencimento do mês)
        target_date       DATE NOT NULL,

        -- status do envio
        status            TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),

        -- dados do provider (EVO)
        provider          TEXT NOT NULL DEFAULT 'evo',
        to_number         TEXT,
        message           TEXT,
        provider_status   TEXT,
        provider_response JSONB,
        error             TEXT,

        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        sent_at           TIMESTAMPTZ
      );
    `);

    // índice mais usados
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bn_company_date ON ${schema}.billing_notifications(company_id, target_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bn_contract_date ON ${schema}.billing_notifications(contract_id, target_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bn_billing ON ${schema}.billing_notifications(billing_id)`);

    // evita duplicidade para automáticas (pre/due/late) do mesmo contrato e mês
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'uq_bn_auto_one_per_kind_month'
        ) THEN
          ALTER TABLE ${schema}.billing_notifications
          ADD CONSTRAINT uq_bn_auto_one_per_kind_month
          UNIQUE (company_id, contract_id, target_date, kind)
          DEFERRABLE INITIALLY IMMEDIATE;
        END IF;
      END$$;
    `);

    await client.query('COMMIT');
    console.log(`✅ billing_notifications OK (schema: ${schema})`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Falha migration billing_notifications:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
