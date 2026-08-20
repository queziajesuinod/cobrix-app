// server/src/jobs/subscription-lifecycle.js
// Efetiva os cancelamentos com carência (assinaturas 'canceling' vencidas → empresa
// canceled + usuários inativos), suspende as inadimplentes de revenda (>= 2
// mensalidades vencidas → empresa suspended até quitar), aplica os pisos agendados e
// roda o lifecycle de inadimplência da REVENDA em cascata (3m→trava, 6m→toma a rede).
const { finalizeCancelingSubscriptions, suspendDelinquentSubscriptions } = require('../services/subscription-service');
const { runPlanFloorCron } = require('../services/plan-floor');
const { runResellerDelinquencyCron } = require('../services/reseller-delinquency');

async function runSubscriptionLifecycle() {
  const finalized = await finalizeCancelingSubscriptions();
  const suspended = await suspendDelinquentSubscriptions();
  const floor = await runPlanFloorCron();
  const resellerDelq = await runResellerDelinquencyCron();
  return { ...finalized, ...suspended, ...floor, ...resellerDelq };
}

module.exports = { runSubscriptionLifecycle };
