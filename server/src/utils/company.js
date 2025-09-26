// server/src/utils/company.js
const { query } = require('../db');
const SCHEMA = process.env.DB_SCHEMA || 'public';

async function resolveCompanyId(req, { billingId, contractId } = {}) {
  // 1) header/token (Auth middleware já define req.companyId quando possível)
  if (Number.isFinite(Number(req.companyId))) return Number(req.companyId);

  // 2) pelo contrato
  if (Number.isFinite(Number(contractId))) {
    const r = await query(
      `SELECT company_id FROM ${SCHEMA}.contracts WHERE id=$1`,
      [Number(contractId)]
    );
    if (r.rowCount) return Number(r.rows[0].company_id);
  }

  // 3) pelo billing -> contrato
  if (Number.isFinite(Number(billingId))) {
    const r = await query(
      `SELECT c.company_id
         FROM ${SCHEMA}.billings b
         JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
        WHERE b.id = $1`,
      [Number(billingId)]
    );
    if (r.rowCount) return Number(r.rows[0].company_id);
  }

  return null;
}

module.exports = { resolveCompanyId };
