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

    await c.query(`ALTER TABLE IF EXISTS clients   ENABLE ROW LEVEL SECURITY`);
    await c.query(`ALTER TABLE IF EXISTS contracts ENABLE ROW LEVEL SECURITY`);
    await c.query(`ALTER TABLE IF EXISTS billings  ENABLE ROW LEVEL SECURITY`);

    await c.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='clients_by_company') THEN
          CREATE POLICY clients_by_company
            ON clients
            USING (company_id = COALESCE(NULLIF(current_setting('app.company_id', true), '')::int, -1))
            WITH CHECK (company_id = COALESCE(NULLIF(current_setting('app.company_id', true), '')::int, -1));
        END IF;
      END $$;
    `);

    await c.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='contracts_by_company') THEN
          CREATE POLICY contracts_by_company
            ON contracts
            USING (company_id = COALESCE(NULLIF(current_setting('app.company_id', true), '')::int, -1))
            WITH CHECK (company_id = COALESCE(NULLIF(current_setting('app.company_id', true), '')::int, -1));
        END IF;
      END $$;
    `);

    await c.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='billings_by_company') THEN
          CREATE POLICY billings_by_company
            ON billings
            USING (EXISTS (
              SELECT 1 FROM contracts c
              WHERE c.id = billings.contract_id
                AND c.company_id = COALESCE(NULLIF(current_setting('app.company_id', true), '')::int, -1)
            ));
        END IF;
      END $$;
    `);

    console.log('✅ RLS policies applied (using app.company_id)');
  } catch (e) {
    console.error('❌ RLS migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
