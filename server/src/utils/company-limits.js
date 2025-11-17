const { query } = require('../db');

async function getCompanyLimits(companyId) {
  if (!companyId) return { clients_limit: null, contracts_limit: null };
  const res = await query(
    'SELECT clients_limit, contracts_limit FROM companies WHERE id=$1',
    [companyId]
  );
  return res.rows[0] || { clients_limit: null, contracts_limit: null };
}

async function assertLimit(companyId, type) {
  if (!companyId) return;
  const limits = await getCompanyLimits(companyId);
  const mapping = {
    client: { limit: limits.clients_limit, table: 'clients', label: 'clientes' },
    contract: { limit: limits.contracts_limit, table: 'contracts', label: 'contratos' },
  };
  const cfg = mapping[type];
  if (!cfg) return;
  const limitValue = Number(cfg.limit);
  if (!limitValue || limitValue <= 0) return;
  const count = await query(
    `SELECT COUNT(*)::int AS total FROM ${cfg.table} WHERE company_id=$1`,
    [companyId]
  );
  if ((count.rows[0]?.total || 0) >= limitValue) {
    const err = new Error(`Limite de ${cfg.label} atingido para esta empresa`);
    err.status = 400;
    throw err;
  }
}

async function assertClientLimit(companyId) {
  return assertLimit(companyId, 'client');
}

async function assertContractLimit(companyId) {
  return assertLimit(companyId, 'contract');
}

module.exports = {
  getCompanyLimits,
  assertClientLimit,
  assertContractLimit,
};
