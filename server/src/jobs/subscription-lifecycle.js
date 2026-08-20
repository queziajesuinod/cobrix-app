// server/src/jobs/subscription-lifecycle.js
// Efetiva os cancelamentos com carência (assinaturas 'canceling' vencidas → empresa
// canceled + usuários inativos) e suspende as inadimplentes de revenda (>= 2
// mensalidades vencidas → empresa suspended até quitar).
const { finalizeCancelingSubscriptions, suspendDelinquentSubscriptions } = require('../services/subscription-service');
const { runPlanFloorCron } = require('../services/plan-floor');

async function runSubscriptionLifecycle() {
  const finalized = await finalizeCancelingSubscriptions();
  const suspended = await suspendDelinquentSubscriptions();
  const floor = await runPlanFloorCron();
  return { ...finalized, ...suspended, ...floor };
}

module.exports = { runSubscriptionLifecycle };
