// server/src/services/reseller-enforcement.js
// Primitivas do lifecycle de inadimplência da REVENDA (ver memória
// partner-reseller-commission-model). São REVERSÍVEIS e idempotentes; a
// orquestração por prazo (3m/6m) vive no cron da Etapa 4 (reseller-delinquency).
//
// Re-parent: quando o parceiro do meio (ex.: Teifelt) fica inadimplente com a
// Padrão, os filhos diretos ligados à base vencida são movidos p/ DIRETO da Padrão
// (parent_partner_id = NULL), guardando o pai original p/ restaurar quando quitar.
// Travar revenda NÃO tira o acesso do parceiro ao sistema — é um estado à parte
// (reseller_status), separado de companies.status (que o gate de login lê).
const { query } = require('../db');

const SCHEMA = process.env.DB_SCHEMA || 'public';

// Aceita um client de transação (padrão do subscription-service) ou usa o pool.
function runner(client) {
  return client ? (sql, params) => client.query(sql, params) : query;
}

// Move um filho para DIRETO da Padrão, preservando o pai atual em
// original_parent_partner_id (só na primeira vez — re-aplicar não sobrescreve).
async function reparentToPadrao(childId, client = null) {
  const q = runner(client);
  const r = await q(
    `UPDATE ${SCHEMA}.companies
        SET original_parent_partner_id = COALESCE(original_parent_partner_id, parent_partner_id),
            parent_partner_id = NULL
      WHERE id = $1 AND parent_partner_id IS NOT NULL`,
    [childId]
  );
  return { reparented: r.rowCount };
}

// Restaura o pai original de um filho re-parenteado (reversão ao quitar).
async function restoreParent(childId, client = null) {
  const q = runner(client);
  const r = await q(
    `UPDATE ${SCHEMA}.companies
        SET parent_partner_id = original_parent_partner_id,
            original_parent_partner_id = NULL
      WHERE id = $1 AND original_parent_partner_id IS NOT NULL`,
    [childId]
  );
  return { restored: r.rowCount };
}

// Define o estado de revenda ('active' | 'link_locked' | 'network_seized').
async function setResellerStatus(companyId, status, client = null) {
  const q = runner(client);
  await q(`UPDATE ${SCHEMA}.companies SET reseller_status = $2 WHERE id = $1`, [companyId, status]);
  return { companyId, status };
}

// Marca o início da inadimplência da base (se ainda não marcado) — base dos marcos.
async function markResellerDelinquent(companyId, sinceIso, client = null) {
  const q = runner(client);
  await q(
    `UPDATE ${SCHEMA}.companies
        SET reseller_delinquent_since = COALESCE(reseller_delinquent_since, $2::date)
      WHERE id = $1`,
    [companyId, sinceIso]
  );
}

// Limpa a inadimplência: volta reseller_status='active' e zera o relógio. Não
// restaura os filhos re-parenteados por si só — o cron chama restoreParent para
// cada um (sabe quais mover de volta).
async function clearResellerDelinquency(companyId, client = null) {
  const q = runner(client);
  await q(
    `UPDATE ${SCHEMA}.companies
        SET reseller_status = 'active', reseller_delinquent_since = NULL
      WHERE id = $1`,
    [companyId]
  );
}

// Reversão: se o parceiro não tem mais NENHUMA aresta-base ELEGÍVEL em aberto com a
// Padrão (quitou tudo que estava devido), restaura os filhos re-parenteados por
// causa dele e volta a revenda a 'active'. Reversível em qualquer estágio (inclusive
// depois de 'network_seized'). Idempotente e barato — sai cedo se não estava marcado.
async function revertResellerIfCaughtUp(partnerId, client = null) {
  const q = runner(client);
  const st = await q(`SELECT reseller_status, reseller_delinquent_since FROM ${SCHEMA}.companies WHERE id = $1`, [partnerId]);
  const row = st.rows[0];
  if (!row || (row.reseller_status === 'active' && row.reseller_delinquent_since == null)) return { reverted: false };

  const owner = await q(`SELECT id FROM ${SCHEMA}.companies WHERE is_saas_owner = true LIMIT 1`);
  const padraoId = owner.rows[0]?.id;
  if (!padraoId) return { reverted: false };

  const dueRes = await q(
    `SELECT 1 FROM ${SCHEMA}.partner_commissions c
       LEFT JOIN ${SCHEMA}.partner_commissions p ON p.id = c.parent_commission_id
      WHERE c.payee_company_id = $1 AND c.payer_company_id = $2
        AND c.status IN ('accrued','charged')
        AND (c.parent_commission_id IS NULL OR p.status = 'settled')
      LIMIT 1`,
    [padraoId, partnerId]
  );
  if (dueRes.rows.length) return { reverted: false }; // ainda deve algo elegível

  const kids = await q(`SELECT id FROM ${SCHEMA}.companies WHERE original_parent_partner_id = $1`, [partnerId]);
  for (const k of kids.rows) await restoreParent(k.id, client);
  await clearResellerDelinquency(partnerId, client);
  return { reverted: true, restored: kids.rows.length };
}

module.exports = {
  reparentToPadrao,
  restoreParent,
  setResellerStatus,
  markResellerDelinquent,
  clearResellerDelinquency,
  revertResellerIfCaughtUp,
};
