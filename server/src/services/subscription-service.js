// server/src/services/subscription-service.js
// Ciclo de vida das assinaturas (SaaS): cancelamento imediato (cascata do
// contrato / admin), cancelamento com carência do cliente (fim do período pago),
// efetivação pelo cron e reativação pelo dono. É o inverso do
// activateSubscriptionForContract (gateway-reconcile.js).
const { query, withClient } = require('../db');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');
const { resolvePixPayment } = require('./pix-resolver');
const logger = require('../utils/logger');

const SCHEMA = process.env.DB_SCHEMA || 'public';

function addMonths(date, months) {
  const d = ensureDateOnly(date) || new Date();
  return new Date(d.getFullYear(), d.getMonth() + Number(months || 0), d.getDate());
}

// Ativa/inativa os usuários de uma empresa (nunca o master).
async function setCompanyUsersActive(companyId, active, client = null) {
  const run = client || { query };
  await run.query(
    `UPDATE ${SCHEMA}.users SET active=$1
      WHERE role <> 'master'
        AND id IN (SELECT user_id FROM ${SCHEMA}.user_companies WHERE company_id=$2)`,
    [active, companyId]
  );
}

// Corta o acesso da empresa-cliente: status canceled + usuários inativos.
async function deactivateCompanyAccess(companyId, client = null) {
  const run = client || { query };
  await run.query(`UPDATE ${SCHEMA}.companies SET status='canceled' WHERE id=$1`, [companyId]);
  await setCompanyUsersActive(companyId, false, client);
}

// Cancelamento IMEDIATO — usado pela cascata do contrato, pelo admin e pela
// efetivação do cron. Idempotente.
async function cancelSubscriptionImmediate({ subscriptionId = null, contractId = null } = {}) {
  const where = subscriptionId ? 'id = $1' : 'contract_id = $1';
  const key = subscriptionId || contractId;
  if (!key) return { skipped: true, reason: 'sem-chave' };

  const found = await query(
    `SELECT id, company_id, contract_id, status
       FROM ${SCHEMA}.company_subscriptions
      WHERE ${where}
      ORDER BY created_at DESC LIMIT 1`,
    [key]
  );
  const sub = found.rows[0];
  if (!sub) return { skipped: true, reason: 'assinatura-nao-encontrada' };
  if (sub.status === 'canceled') return { skipped: true, reason: 'ja-cancelada', companyId: sub.company_id };

  const today = formatISODate(new Date());
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE ${SCHEMA}.company_subscriptions
            SET status='canceled', access_until=NULL WHERE id=$1`,
        [sub.id]
      );
      await deactivateCompanyAccess(sub.company_id, client);
      if (sub.contract_id) {
        await client.query(
          `UPDATE ${SCHEMA}.billings SET status='canceled', updated_at=NOW()
            WHERE contract_id=$1 AND status='pending'`,
          [sub.contract_id]
        );
        await client.query(
          `UPDATE ${SCHEMA}.contract_month_status SET status='canceled'
            WHERE contract_id=$1 AND status='pending'`,
          [sub.contract_id]
        );
        // Para cobranças e renovações futuras do contrato de cobrança.
        await client.query(
          `UPDATE ${SCHEMA}.contracts SET cancellation_date=$1, active=false, updated_at=NOW()
            WHERE id=$2`,
          [today, sub.contract_id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
  logger.info({ subscriptionId: sub.id, companyId: sub.company_id }, '[saas] assinatura cancelada (imediato)');
  return { canceled: true, companyId: sub.company_id, subscriptionId: sub.id };
}

// Cancelamento do CLIENTE — vale até o fim do período pago (carência). Empresa e
// usuários seguem ativos; o cron efetiva depois de access_until.
async function selfCancelAtPeriodEnd(companyId) {
  const found = await query(
    `SELECT id, contract_id, status, period
       FROM ${SCHEMA}.company_subscriptions
      WHERE company_id=$1 AND status IN ('active','pending_payment','canceling')
      ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  );
  const sub = found.rows[0];
  if (!sub) return { skipped: true, reason: 'sem-assinatura-ativa' };
  if (sub.status === 'canceling') {
    const r = await query(`SELECT access_until FROM ${SCHEMA}.company_subscriptions WHERE id=$1`, [sub.id]);
    return { alreadyCanceling: true, accessUntil: r.rows[0]?.access_until || null };
  }
  // Nunca pagou → cancela na hora (não há período pago a respeitar).
  if (sub.status === 'pending_payment') {
    await cancelSubscriptionImmediate({ subscriptionId: sub.id });
    return { canceled: true, accessUntil: null };
  }

  // Calcula até quando o acesso vale (fim do período já pago).
  let accessUntil = null;
  if (sub.contract_id) {
    const c = await query(
      `SELECT last_billed_date, billing_interval_months, end_date FROM ${SCHEMA}.contracts WHERE id=$1`,
      [sub.contract_id]
    );
    const row = c.rows[0] || {};
    let base = ensureDateOnly(row.last_billed_date);
    if (!base) {
      const paid = await query(
        `SELECT MAX(billing_date) AS d FROM ${SCHEMA}.billings WHERE contract_id=$1 AND status='paid'`,
        [sub.contract_id]
      );
      base = ensureDateOnly(paid.rows[0]?.d) || new Date();
    }
    const interval = Number(row.billing_interval_months) || (sub.period === 'annual' ? 12 : 1);
    let until = addMonths(base, interval);
    const end = ensureDateOnly(row.end_date);
    if (end && end < until) until = end;
    accessUntil = formatISODate(until);
  } else {
    accessUntil = formatISODate(addMonths(new Date(), sub.period === 'annual' ? 12 : 1));
  }

  const today = formatISODate(new Date());
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE ${SCHEMA}.company_subscriptions
            SET status='canceling', cancel_requested_at=NOW(), access_until=$1 WHERE id=$2`,
        [accessUntil, sub.id]
      );
      if (sub.contract_id) {
        // Para as próximas cobranças/renovações sem cortar o acesso agora.
        await client.query(
          `UPDATE ${SCHEMA}.contracts SET cancellation_date=$1, updated_at=NOW() WHERE id=$2`,
          [today, sub.contract_id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
  logger.info({ subscriptionId: sub.id, companyId, accessUntil }, '[saas] assinatura em cancelamento (carência)');
  return { canceling: true, accessUntil };
}

// Cron: efetiva a inativação das assinaturas cujo período de carência expirou.
async function finalizeCancelingSubscriptions() {
  const today = formatISODate(new Date());
  const due = await query(
    `SELECT id FROM ${SCHEMA}.company_subscriptions
      WHERE status='canceling' AND access_until IS NOT NULL AND access_until <= $1`,
    [today]
  );
  let count = 0;
  for (const row of due.rows) {
    try {
      await cancelSubscriptionImmediate({ subscriptionId: row.id });
      count += 1;
    } catch (err) {
      logger.error({ err, subscriptionId: row.id }, '[saas] falha ao efetivar cancelamento');
    }
  }
  if (count) logger.info({ count }, '[saas] cancelamentos efetivados pelo cron');
  return { finalized: count };
}

// Reativação pelo dono: reativa usuários + empresa, aplica o plano escolhido,
// reabre o contrato e gera nova 1ª cobrança (PIX best-effort).
async function reactivateSubscription({ subscriptionId, planId, period = 'monthly' }) {
  const subRes = await query(
    `SELECT id, company_id, owner_company_id, contract_id, client_id
       FROM ${SCHEMA}.company_subscriptions WHERE id=$1`,
    [subscriptionId]
  );
  const sub = subRes.rows[0];
  if (!sub) { const e = new Error('Assinatura não encontrada'); e.status = 404; throw e; }

  const planRes = await query(
    `SELECT id, name, price_monthly, price_annual, clients_limit, contracts_limit
       FROM ${SCHEMA}.plans WHERE id=$1 AND active=true`,
    [planId]
  );
  const plan = planRes.rows[0];
  if (!plan) { const e = new Error('Plano indisponível'); e.status = 400; throw e; }
  const per = period === 'annual' ? 'annual' : 'monthly';
  const price = per === 'annual' ? plan.price_annual : plan.price_monthly;
  if (price == null) { const e = new Error('Este plano não oferece o período selecionado'); e.status = 400; throw e; }
  const intervalMonths = per === 'annual' ? 12 : 1;
  const todayIso = formatISODate(new Date());

  const result = await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE ${SCHEMA}.company_subscriptions
            SET status='active', plan_id=$1, period=$2, activated_at=NOW(),
                access_until=NULL, cancel_requested_at=NULL
          WHERE id=$3`,
        [plan.id, per, sub.id]
      );
      await client.query(
        `UPDATE ${SCHEMA}.companies
            SET status='active', plan_id=$1, clients_limit=$2, contracts_limit=$3
          WHERE id=$4`,
        [plan.id, plan.clients_limit, plan.contracts_limit, sub.company_id]
      );
      await setCompanyUsersActive(sub.company_id, true, client);

      let firstBillingId = null;
      if (sub.contract_id) {
        await client.query(
          `UPDATE ${SCHEMA}.contracts
              SET active=true, cancellation_date=NULL, value=$1,
                  billing_interval_months=$2, last_billed_date=$3, updated_at=NOW()
            WHERE id=$4`,
          [price, intervalMonths, todayIso, sub.contract_id]
        );
        const billRes = await client.query(
          `INSERT INTO ${SCHEMA}.billings (company_id, contract_id, billing_date, amount, status)
           VALUES ($1,$2,$3,$4,'pending')
           ON CONFLICT (contract_id, billing_date) DO NOTHING
           RETURNING id`,
          [sub.owner_company_id, sub.contract_id, todayIso, price]
        );
        firstBillingId = billRes.rows[0]?.id || null;
        const now = new Date();
        await client.query(
          `INSERT INTO ${SCHEMA}.contract_month_status (company_id, contract_id, year, month, status)
           VALUES ($1,$2,$3,$4,'pending')
           ON CONFLICT (contract_id, year, month) DO NOTHING`,
          [sub.owner_company_id, sub.contract_id, now.getFullYear(), now.getMonth() + 1]
        );
      }
      await client.query('COMMIT');
      return { firstBillingId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  // Nova cobrança PIX fora da transação (best-effort).
  let pix = null;
  if (result.firstBillingId && sub.contract_id) {
    const link = await resolvePixPayment({
      companyId: sub.owner_company_id,
      contractId: sub.contract_id,
      billingId: result.firstBillingId,
      amount: Number(price),
      dueDate: todayIso,
    });
    if (link) pix = { copyPaste: link.copyPaste || null, qrCodeImage: link.qrCodeImage || null, amount: Number(link.amount || price) };
  }
  logger.info({ subscriptionId: sub.id, companyId: sub.company_id, plan: plan.name }, '[saas] assinatura reativada');
  return { ok: true, status: 'active', plan: plan.name, period: per, amount: Number(price), pix };
}

// Upgrade / mudança de plano.
// - Mesmo período: atualiza o contrato no lugar (preserva o ciclo já pago).
//   Upgrade cobra só a DIFERENÇA proporcional aos dias restantes; downgrade só
//   troca o plano (sem cobrança e sem crédito/saldo).
// - Período diferente (mensal <-> anual): encerra o contrato atual e cria um
//   novo ciclo com cobrança cheia do novo plano.
async function changePlan({ companyId = null, subscriptionId = null, planId, period = 'monthly' }) {
  const where = subscriptionId ? 'cs.id = $1' : 'cs.company_id = $1';
  const key = subscriptionId || companyId;
  if (!key) { const e = new Error('Assinatura não informada'); e.status = 400; throw e; }

  const subRes = await query(
    `SELECT cs.id, cs.company_id, cs.owner_company_id, cs.client_id, cs.contract_id,
            cs.status, cs.period AS current_period, co.name AS company_name
       FROM ${SCHEMA}.company_subscriptions cs
       JOIN ${SCHEMA}.companies co ON co.id = cs.company_id
      WHERE ${where} AND cs.status IN ('active','canceling','pending_payment')
      ORDER BY cs.created_at DESC LIMIT 1`,
    [key]
  );
  const sub = subRes.rows[0];
  if (!sub) { const e = new Error('Nenhuma assinatura ativa para alterar'); e.status = 400; throw e; }

  const planRes = await query(
    `SELECT id, name, price_monthly, price_annual, clients_limit, contracts_limit
       FROM ${SCHEMA}.plans WHERE id=$1 AND active=true`,
    [planId]
  );
  const plan = planRes.rows[0];
  if (!plan) { const e = new Error('Plano indisponível'); e.status = 400; throw e; }
  const per = period === 'annual' ? 'annual' : 'monthly';
  const price = per === 'annual' ? plan.price_annual : plan.price_monthly;
  if (price == null) { const e = new Error('Este plano não oferece o período selecionado'); e.status = 400; throw e; }
  const intervalMonths = per === 'annual' ? 12 : 1;

  const today = new Date();
  const todayIso = formatISODate(today);
  const endIso = formatISODate(new Date(today.getFullYear() + 10, today.getMonth(), today.getDate()));
  const billingDay = today.getDate();
  const description = `Assinatura ${plan.name} (${per === 'annual' ? 'anual' : 'mensal'}) — ${sub.company_name}`;

  // Dados do contrato atual (valor pago, ciclo, tipo, cliente).
  const oldRes = await query(
    `SELECT client_id, contract_type_id, value, last_billed_date, billing_interval_months
       FROM ${SCHEMA}.contracts WHERE id=$1`,
    [sub.contract_id]
  );
  const old = oldRes.rows[0] || {};
  const clientId = old.client_id || sub.client_id;
  const perChanged = per !== (sub.current_period === 'annual' ? 'annual' : 'monthly');

  // ---- Mesmo período: atualização no lugar (upgrade proporcional / downgrade) ----
  if (!perChanged && sub.contract_id) {
    const oldPrice = Number(old.value) || 0;
    const newPrice = Number(price);
    const isUpgrade = newPrice > oldPrice;

    // Fração restante do período já pago.
    let periodStart = ensureDateOnly(old.last_billed_date);
    if (!periodStart) {
      const paid = await query(
        `SELECT MAX(billing_date) AS d FROM ${SCHEMA}.billings WHERE contract_id=$1 AND status='paid'`,
        [sub.contract_id]
      );
      periodStart = ensureDateOnly(paid.rows[0]?.d) || ensureDateOnly(today);
    }
    const interval = Number(old.billing_interval_months) || intervalMonths;
    const periodEnd = addMonths(periodStart, interval);
    const DAY = 86400000;
    const totalDays = Math.max(1, Math.round((periodEnd - periodStart) / DAY));
    const remainingDays = Math.max(0, Math.round((periodEnd - ensureDateOnly(today)) / DAY));
    const fraction = Math.min(1, remainingDays / totalDays);
    // Upgrade cobra a diferença proporcional; downgrade não cobra nada.
    const diff = isUpgrade ? Math.round((newPrice - oldPrice) * fraction * 100) / 100 : 0;

    const inplace = await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        // Novo valor vale para os próximos ciclos; ciclo atual preservado.
        await client.query(
          `UPDATE ${SCHEMA}.contracts SET value=$1, active=true, cancellation_date=NULL, updated_at=NOW() WHERE id=$2`,
          [newPrice, sub.contract_id]
        );
        await client.query(
          `UPDATE ${SCHEMA}.company_subscriptions
              SET plan_id=$1, status='active', access_until=NULL, cancel_requested_at=NULL WHERE id=$2`,
          [plan.id, sub.id]
        );
        await client.query(
          `UPDATE ${SCHEMA}.companies SET status='active', plan_id=$1, clients_limit=$2, contracts_limit=$3 WHERE id=$4`,
          [plan.id, plan.clients_limit, plan.contracts_limit, sub.company_id]
        );
        let diffBillingId = null;
        if (diff > 0) {
          const b = await client.query(
            `INSERT INTO ${SCHEMA}.billings (company_id, contract_id, billing_date, amount, status)
             VALUES ($1,$2,$3,$4,'pending')
             ON CONFLICT (contract_id, billing_date) DO NOTHING RETURNING id`,
            [sub.owner_company_id, sub.contract_id, todayIso, diff]
          );
          diffBillingId = b.rows[0]?.id || null;
        }
        await client.query('COMMIT');
        return { diffBillingId };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    let pix = null;
    if (inplace.diffBillingId) {
      const link = await resolvePixPayment({
        companyId: sub.owner_company_id, contractId: sub.contract_id,
        billingId: inplace.diffBillingId, amount: diff, dueDate: todayIso,
      });
      if (link) pix = { copyPaste: link.copyPaste || null, qrCodeImage: link.qrCodeImage || null, amount: Number(link.amount || diff) };
    }
    logger.info(
      { subscriptionId: sub.id, companyId: sub.company_id, plan: plan.name, mode: isUpgrade ? 'upgrade' : 'downgrade', diff },
      '[saas] plano alterado (no lugar)'
    );
    return { ok: true, plan: plan.name, period: per, mode: isUpgrade ? 'upgrade' : 'downgrade', amount: diff, pix };
  }

  // ---- Período diferente: encerra o contrato atual e cria um novo ciclo cheio ----
  const result = await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      // 1) Cancela o contrato de cobrança atual e suas pendências.
      if (sub.contract_id) {
        await client.query(
          `UPDATE ${SCHEMA}.contracts SET active=false, cancellation_date=$1, updated_at=NOW() WHERE id=$2`,
          [todayIso, sub.contract_id]
        );
        await client.query(
          `UPDATE ${SCHEMA}.billings SET status='canceled', updated_at=NOW() WHERE contract_id=$1 AND status='pending'`,
          [sub.contract_id]
        );
        await client.query(
          `UPDATE ${SCHEMA}.contract_month_status SET status='canceled' WHERE contract_id=$1 AND status='pending'`,
          [sub.contract_id]
        );
      }

      // 2) Tipo de contrato recorrente no tenant do dono (reusa o atual ou acha/cria).
      let contractTypeId = old.contract_type_id;
      if (!contractTypeId) {
        const t = await client.query(
          `SELECT id FROM ${SCHEMA}.contract_types WHERE company_id=$1 ORDER BY is_recurring DESC, id ASC LIMIT 1`,
          [sub.owner_company_id]
        );
        contractTypeId = t.rows[0]?.id;
        if (!contractTypeId) {
          const ct = await client.query(
            `INSERT INTO ${SCHEMA}.contract_types (company_id, name, is_recurring, adjustment_percent) VALUES ($1,'Recorrente',true,0) RETURNING id`,
            [sub.owner_company_id]
          );
          contractTypeId = ct.rows[0].id;
        }
      }

      // 3) Novo contrato de cobrança com o valor do plano escolhido.
      const conRes = await client.query(
        `INSERT INTO ${SCHEMA}.contracts
           (company_id, client_id, contract_type_id, description, value, start_date, end_date, billing_day, billing_interval_months, billing_mode, last_billed_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'monthly',$6) RETURNING id`,
        [sub.owner_company_id, clientId, contractTypeId, description, price, todayIso, endIso, billingDay, intervalMonths]
      );
      const newContractId = conRes.rows[0].id;

      // 4) Primeira cobrança do novo plano.
      const billRes = await client.query(
        `INSERT INTO ${SCHEMA}.billings (company_id, contract_id, billing_date, amount, status)
         VALUES ($1,$2,$3,$4,'pending')
         ON CONFLICT (contract_id, billing_date) DO NOTHING RETURNING id`,
        [sub.owner_company_id, newContractId, todayIso, price]
      );
      const firstBillingId = billRes.rows[0]?.id || null;
      await client.query(
        `INSERT INTO ${SCHEMA}.contract_month_status (company_id, contract_id, year, month, status)
         VALUES ($1,$2,$3,$4,'pending') ON CONFLICT (contract_id, year, month) DO NOTHING`,
        [sub.owner_company_id, newContractId, today.getFullYear(), today.getMonth() + 1]
      );

      // 5) Aponta a assinatura para o novo contrato/plano e mantém a empresa ativa.
      await client.query(
        `UPDATE ${SCHEMA}.company_subscriptions
            SET plan_id=$1, period=$2, contract_id=$3, status='active',
                activated_at=COALESCE(activated_at, NOW()), access_until=NULL, cancel_requested_at=NULL
          WHERE id=$4`,
        [plan.id, per, newContractId, sub.id]
      );
      await client.query(
        `UPDATE ${SCHEMA}.companies SET status='active', plan_id=$1, clients_limit=$2, contracts_limit=$3 WHERE id=$4`,
        [plan.id, plan.clients_limit, plan.contracts_limit, sub.company_id]
      );

      await client.query('COMMIT');
      return { newContractId, firstBillingId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  let pix = null;
  if (result.firstBillingId) {
    const link = await resolvePixPayment({
      companyId: sub.owner_company_id,
      contractId: result.newContractId,
      billingId: result.firstBillingId,
      amount: Number(price),
      dueDate: todayIso,
    });
    if (link) pix = { copyPaste: link.copyPaste || null, qrCodeImage: link.qrCodeImage || null, amount: Number(link.amount || price) };
  }
  logger.info({ subscriptionId: sub.id, companyId: sub.company_id, plan: plan.name }, '[saas] plano alterado (novo ciclo)');
  return { ok: true, plan: plan.name, period: per, mode: 'switch', amount: Number(price), pix };
}

module.exports = {
  setCompanyUsersActive,
  deactivateCompanyAccess,
  cancelSubscriptionImmediate,
  selfCancelAtPeriodEnd,
  finalizeCancelingSubscriptions,
  reactivateSubscription,
  changePlan,
};
