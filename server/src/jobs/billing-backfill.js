// server/src/jobs/billing-backfill.js
// Verifica contratos e cria cobranças para meses que não tiveram billing gerado.
const { query, withClient } = require('../db');
const { ensureDateOnly, formatISODate, addDays } = require('../utils/date-only');
const {
  effectiveBillingDay,
  dueDateForMonth,
  normalizeBillingIntervalMonths,
  isBillingMonthFor,
} = require('./billing-cron');

const SCHEMA = process.env.DB_SCHEMA || 'public';

function isoDate(value) {
  return formatISODate(value);
}

function computeCustomAmount(entry, contractValue) {
  const amount = entry?.amount != null ? Number(entry.amount) : null;
  const perc = entry?.percentage != null ? Number(entry.percentage) : null;
  if (amount != null && !Number.isNaN(amount) && amount > 0) return Number(amount);
  if (perc != null && !Number.isNaN(perc) && perc > 0) {
    const base = Number(contractValue || 0);
    return Number(((base * perc) / 100).toFixed(2));
  }
  return null;
}

/**
 * Retorna dois conjuntos para um contrato:
 * - dates: Set de billing_dates exatas (YYYY-MM-DD) — usado para interval_days e custom_dates
 * - months: Set de meses (YYYY-MM) — usado para contratos mensais, pois o cron pode ter
 *   rodado em dia diferente do billing_day ideal (ex: billing_day=10 mas cron rodou dia 11)
 */
async function getExistingBillings(contractId) {
  const r = await query(
    `SELECT billing_date FROM ${SCHEMA}.billings WHERE contract_id = $1`,
    [contractId]
  );
  const dates = new Set();
  const months = new Set();
  for (const row of r.rows) {
    const d = ensureDateOnly(row.billing_date);
    if (!d) continue;
    dates.add(isoDate(d));
    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return { dates, months };
}

/**
 * Retorna o conjunto de meses (formato "YYYY-MM") com status paid ou canceled
 * no contract_month_status. Esses meses não devem receber nova cobrança.
 */
async function getClosedMonths(contractId) {
  const r = await query(
    `SELECT year, month FROM ${SCHEMA}.contract_month_status
     WHERE contract_id = $1
       AND LOWER(status) IN ('paid', 'canceled')`,
    [contractId]
  );
  return new Set(
    r.rows.map((row) => `${row.year}-${String(row.month).padStart(2, '0')}`)
  );
}

/**
 * Calcula todas as datas de cobrança esperadas para o contrato até `until`.
 * Retorna array de { billingDate: Date, amount: number }.
 */
async function computeExpectedBillings(contract, until) {
  const mode = String(contract.billing_mode || 'monthly').toLowerCase();
  const start = ensureDateOnly(contract.start_date);
  const end = ensureDateOnly(contract.end_date);
  const cancelled = contract.cancellation_date ? ensureDateOnly(contract.cancellation_date) : null;

  // Limite superior: menor entre end_date, cancellation_date e until (hoje).
  // cancellation_date é inclusivo: cobrança no próprio dia do cancelamento é válida,
  // mas nenhuma cobrança é criada após essa data.
  let upperLimit = until;
  if (end && end < upperLimit) upperLimit = end;
  if (cancelled && cancelled < upperLimit) upperLimit = cancelled;

  if (!start || !upperLimit || start > upperLimit) return [];

  const expected = [];

  if (mode === 'monthly') {
    // Itera mês a mês desde o mês de início até o mês limite
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const limitMonth = new Date(upperLimit.getFullYear(), upperLimit.getMonth(), 1);

    while (cursor <= limitMonth) {
      if (isBillingMonthFor(contract, cursor)) {
        const billingDate = dueDateForMonth(cursor, contract.billing_day);
        // Cobrança deve estar dentro do período válido do contrato
        if (billingDate >= start && billingDate <= upperLimit) {
          expected.push({ billingDate, amount: Number(contract.value || 0) });
        }
      }
      // Avança um mês
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  } else if (mode === 'interval_days') {
    const interval = Number(contract.billing_interval_days || 0);
    if (interval <= 0) return [];

    let cursor = new Date(start);
    while (cursor <= upperLimit) {
      expected.push({ billingDate: new Date(cursor), amount: Number(contract.value || 0) });
      cursor = addDays(cursor, interval);
    }
  } else if (mode === 'custom_dates') {
    const r = await query(
      `SELECT billing_date, amount, percentage
       FROM ${SCHEMA}.contract_custom_billings
       WHERE contract_id = $1
       ORDER BY billing_date`,
      [contract.id]
    );
    for (const entry of r.rows) {
      const billingDate = ensureDateOnly(entry.billing_date);
      if (!billingDate) continue;
      if (billingDate < start || billingDate > upperLimit) continue;
      const amount = computeCustomAmount(entry, contract.value);
      if (!amount || amount <= 0) continue;
      expected.push({ billingDate, amount });
    }
  }

  return expected;
}

/**
 * Cria uma cobrança e atualiza contract_month_status.
 * Se dryRun=true, apenas loga sem inserir.
 */
async function createMissingBilling(contract, billingDate, amount, dryRun) {
  const dateStr = isoDate(billingDate);
  const year = billingDate.getFullYear();
  const month = billingDate.getMonth() + 1;

  if (dryRun) {
    return { contractId: contract.id, billingDate: dateStr, amount, action: 'would_create' };
  }

  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO ${SCHEMA}.billings (company_id, contract_id, billing_date, amount, status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (contract_id, billing_date) DO NOTHING`,
        [contract.company_id, contract.id, dateStr, amount]
      );

      await client.query(
        `INSERT INTO ${SCHEMA}.contract_month_status (company_id, contract_id, year, month, status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (contract_id, year, month)
         DO UPDATE SET status = CASE
           WHEN ${SCHEMA}.contract_month_status.status IN ('paid', 'canceled')
             THEN ${SCHEMA}.contract_month_status.status
           ELSE EXCLUDED.status
         END`,
        [contract.company_id, contract.id, year, month]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });

  return { contractId: contract.id, billingDate: dateStr, amount, action: 'created' };
}

/**
 * Função principal de backfill.
 *
 * @param {object} opts
 * @param {boolean} opts.dryRun       - Se true, apenas lista o que seria criado (padrão: true)
 * @param {number|null} opts.companyId - Filtrar por empresa específica
 * @param {number|null} opts.contractId - Filtrar por contrato específico
 * @param {boolean} opts.includeInactive - Incluir contratos inativos (padrão: false)
 * @param {Date} opts.until            - Data limite (padrão: hoje)
 * @returns {Promise<object>} Relatório com criadas, ignoradas e erros
 */
async function runBillingBackfill(opts = {}) {
  const {
    dryRun = true,
    companyId = null,
    contractId = null,
    includeInactive = false,
    until = new Date(),
  } = opts;

  const untilDate = ensureDateOnly(until) || ensureDateOnly(new Date());

  console.log(`[BACKFILL] Iniciando${dryRun ? ' (DRY RUN)' : ''} até ${isoDate(untilDate)}`);

  // Busca contratos
  const params = [isoDate(untilDate)];
  const filters = [`c.start_date <= $1`];

  if (!includeInactive) {
    // Inclui contratos ativos E contratos cancelados (para backfill do período antes do cancelamento).
    // Contratos inativos sem cancellation_date (desativados manualmente) são excluídos.
    filters.push(`(c.active = true OR c.cancellation_date IS NOT NULL)`);
  }

  if (companyId) {
    params.push(Number(companyId));
    filters.push(`c.company_id = $${params.length}`);
  }

  if (contractId) {
    params.push(Number(contractId));
    filters.push(`c.id = $${params.length}`);
  }

  const contractsResult = await query(
    `SELECT c.*, cl.name AS client_name
     FROM ${SCHEMA}.contracts c
     JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
     WHERE ${filters.join(' AND ')}
     ORDER BY c.id`,
    params
  );

  const contracts = contractsResult.rows;
  console.log(`[BACKFILL] ${contracts.length} contrato(s) encontrado(s)`);

  const report = {
    dryRun,
    until: isoDate(untilDate),
    contractsAnalyzed: contracts.length,
    billingsCreated: [],
    billingsSkipped: 0,
    errors: [],
  };

  for (const contract of contracts) {
    try {
      const { dates: existingDates, months: existingMonths } = await getExistingBillings(contract.id);
      const closedMonths = await getClosedMonths(contract.id);
      const expected = await computeExpectedBillings(contract, untilDate);
      const mode = String(contract.billing_mode || 'monthly').toLowerCase();

      for (const { billingDate, amount } of expected) {
        const dateStr = isoDate(billingDate);
        const monthKey = `${billingDate.getFullYear()}-${String(billingDate.getMonth() + 1).padStart(2, '0')}`;

        // Para contratos mensais: verifica por mês (o cron pode ter rodado em dia diferente do billing_day)
        // Para interval_days e custom_dates: verifica pela data exata
        const alreadyExists = mode === 'monthly'
          ? existingMonths.has(monthKey)
          : existingDates.has(dateStr);

        if (alreadyExists) {
          report.billingsSkipped++;
          continue;
        }

        // Pula se o mês já está fechado (pago ou cancelado no contract_month_status)
        if (closedMonths.has(monthKey)) {
          report.billingsSkipped++;
          continue;
        }

        console.log(
          `[BACKFILL] c#${contract.id} (${contract.client_name}) ${dateStr} R$${amount.toFixed(2)}${dryRun ? ' [DRY RUN]' : ''}`
        );

        const result = await createMissingBilling(contract, billingDate, amount, dryRun);
        report.billingsCreated.push(result);
      }
    } catch (err) {
      console.error(`[BACKFILL] Erro no contrato #${contract.id}:`, err.message);
      report.errors.push({ contractId: contract.id, error: err.message });
    }
  }

  console.log(
    `[BACKFILL] Concluído. Criadas: ${report.billingsCreated.length}, Ignoradas: ${report.billingsSkipped}, Erros: ${report.errors.length}`
  );

  return report;
}

module.exports = { runBillingBackfill };
