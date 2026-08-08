// server/scripts/20260807-reconcile-month-status.js
//
// Reconcilia contract_month_status <-> billings. Corrige duas divergências que
// aparecem ao marcar contratos como pagos:
//
//  (A) Cobrança PAGA sem o mês 'paid' em contract_month_status
//      -> o contrato fica "preso" na listagem /notifications/auto.
//
//  (B) Mês 'paid' em contract_month_status SEM nenhuma cobrança paga no mês
//      -> o contrato some da lista automática, mas NÃO gera receita na aba
//         "Contratos pagos" do financeiro (billings.status='paid'). Ocorre ao
//         marcar o mês pago antes de existir cobrança; o cron não gera depois
//         porque pula meses já 'paid'. Aqui marcamos a cobrança existente como
//         paga, ou criamos uma cobrança já paga (valor/dia do contrato).
//
// Uso:
//   node scripts/20260807-reconcile-month-status.js            # dry-run (só lista)
//   node scripts/20260807-reconcile-month-status.js --apply    # aplica as correções
//
// Seguro para rodar mais de uma vez (idempotente). NÃO engole erros.
require('dotenv').config()
const { Pool } = require('pg')

const schema = process.env.DB_SCHEMA || 'public'
const APPLY = process.argv.includes('--apply')

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

function effectiveBillingDate(year, month, billingDay) {
  const lastDay = new Date(year, month, 0).getDate()
  const eff = Math.min(Math.max(Number(billingDay) || 1, 1), lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(eff).padStart(2, '0')}`
}

async function main() {
  const client = await pool.connect()
  try {
    await client.query(`SET search_path TO ${schema}, public`)

    // ===== (A) cobrança PAGA sem contract_month_status='paid' =====
    const divA = await client.query(`
      SELECT b.company_id, b.contract_id,
             EXTRACT(YEAR  FROM b.billing_date)::int AS year,
             EXTRACT(MONTH FROM b.billing_date)::int AS month,
             COALESCE(cms.status, '(sem registro)') AS cms_status
        FROM ${schema}.billings b
        LEFT JOIN ${schema}.contract_month_status cms
          ON cms.contract_id = b.contract_id
         AND cms.year  = EXTRACT(YEAR  FROM b.billing_date)::int
         AND cms.month = EXTRACT(MONTH FROM b.billing_date)::int
       WHERE LOWER(b.status) = 'paid'
         AND (cms.status IS NULL OR LOWER(cms.status) <> 'paid')
       GROUP BY b.company_id, b.contract_id,
                EXTRACT(YEAR FROM b.billing_date), EXTRACT(MONTH FROM b.billing_date), cms.status
       ORDER BY b.company_id, b.contract_id,
                EXTRACT(YEAR FROM b.billing_date), EXTRACT(MONTH FROM b.billing_date)
    `)

    console.log(`\n(A) ${divA.rowCount} mês(es) com cobrança paga sem contract_month_status='paid' (some da lista automática)`)
    if (divA.rowCount) console.table(divA.rows)

    // ===== (B) contract_month_status='paid' SEM cobrança paga no mês =====
    const divB = await client.query(`
      SELECT cms.company_id, cms.contract_id, cms.year, cms.month,
             c.value AS contract_value, c.billing_day,
             (SELECT b.id FROM ${schema}.billings b
               WHERE b.contract_id = cms.contract_id
                 AND EXTRACT(YEAR  FROM b.billing_date)::int = cms.year
                 AND EXTRACT(MONTH FROM b.billing_date)::int = cms.month
               ORDER BY b.id LIMIT 1) AS existing_billing_id
        FROM ${schema}.contract_month_status cms
        JOIN ${schema}.contracts c ON c.id = cms.contract_id
       WHERE LOWER(cms.status) = 'paid'
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.billings b
            WHERE b.contract_id = cms.contract_id
              AND EXTRACT(YEAR  FROM b.billing_date)::int = cms.year
              AND EXTRACT(MONTH FROM b.billing_date)::int = cms.month
              AND LOWER(b.status) = 'paid'
         )
       ORDER BY cms.company_id, cms.contract_id, cms.year, cms.month
    `)

    console.log(`\n(B) ${divB.rowCount} mês(es) marcados 'paid' sem cobrança paga (não gera receita no financeiro)`)
    if (divB.rowCount) {
      console.table(divB.rows.map(r => ({
        contract_id: r.contract_id, year: r.year, month: r.month,
        valor: Number(r.contract_value || 0),
        acao: r.existing_billing_id ? `marcar cobrança #${r.existing_billing_id} como paga` : 'criar cobrança paga',
      })))
    }

    if (divA.rowCount === 0 && divB.rowCount === 0) {
      console.log('\nTudo consistente. ✅')
      return
    }
    if (!APPLY) {
      console.log('\nDry-run: nada foi gravado. Rode com --apply para aplicar as correções.')
      return
    }

    // ---- aplica (A) ----
    let okA = 0, failA = 0
    for (const r of divA.rows) {
      try {
        await client.query(
          `INSERT INTO ${schema}.contract_month_status (company_id, contract_id, year, month, status)
           VALUES ($1,$2,$3,$4,'paid')
           ON CONFLICT (contract_id, year, month)
           DO UPDATE SET status='paid', updated_at=NOW()`,
          [r.company_id, r.contract_id, r.year, r.month]
        )
        okA++
      } catch (e) {
        failA++
        console.error(`  ✗ (A) contrato #${r.contract_id} ${r.year}-${String(r.month).padStart(2, '0')}: ${e.message}`)
      }
    }

    // ---- aplica (B) ----
    let okB = 0, failB = 0
    for (const r of divB.rows) {
      try {
        // Backfill histórico: NÃO define gateway_paid_at (fica NULL). A receita do
        // financeiro usa COALESCE(gateway_paid_at::date, billing_date), então cai no
        // billing_date — a data de REFERÊNCIA do mês, que é DATE puro (imune a fuso).
        // Usar NOW() jogaria tudo no mês atual; usar timestamptz deslocaria o dia sob
        // fuso negativo. Pagamentos reais (marcados na UI) gravam gateway_paid_at=NOW().
        if (r.existing_billing_id) {
          await client.query(
            `UPDATE ${schema}.billings SET status='paid', updated_at=now() WHERE id=$1`,
            [r.existing_billing_id]
          )
        } else {
          const billingDate = effectiveBillingDate(r.year, r.month, r.billing_day)
          await client.query(
            `INSERT INTO ${schema}.billings (company_id, contract_id, billing_date, amount, status)
             VALUES ($1,$2,$3,$4,'paid')
             ON CONFLICT (contract_id, billing_date)
             DO UPDATE SET status='paid', updated_at=now()`,
            [r.company_id, r.contract_id, billingDate, Number(r.contract_value || 0)]
          )
        }
        okB++
      } catch (e) {
        failB++
        console.error(`  ✗ (B) contrato #${r.contract_id} ${r.year}-${String(r.month).padStart(2, '0')}: ${e.message}`)
      }
    }

    console.log(`\nConcluído. (A) corrigidos: ${okA}, falhas: ${failA} | (B) corrigidos: ${okB}, falhas: ${failB}`)
  } catch (e) {
    console.error('❌ Falha na reconciliação:', e.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
