// server/src/jobs/subscription-lifecycle.js
// Efetiva os cancelamentos com carência: assinaturas em 'canceling' cujo
// access_until já passou são inativadas (empresa canceled + usuários inativos).
const { finalizeCancelingSubscriptions } = require('../services/subscription-service');

async function runSubscriptionLifecycle() {
  return finalizeCancelingSubscriptions();
}

module.exports = { runSubscriptionLifecycle };
