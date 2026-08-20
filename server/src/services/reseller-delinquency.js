// server/src/services/reseller-delinquency.js
// Cron diário do lifecycle de inadimplência da REVENDA em cascata (ver memória
// partner-reseller-commission-model). Trata o parceiro do meio (ex.: Teifelt) que
// RECEBEU do seu sub-parceiro mas NÃO repassou a base à Padrão:
//   0–3 meses: aviso + lembretes mensais.
//   >= LOCK (3m): reseller_status='link_locked' (não onboarda novos) + re-parent
//     CIRÚRGICO dos sub-PARCEIROS ligados à base vencida (viram direto da Padrão).
//   >= SEIZE (6m): reseller_status='network_seized' (toda a comissão da rede vai à Padrão).
//   Quitou (qualquer estágio): reversão total — restaura filhos + volta a 'active'.
// A reversão imediata acontece no settle (revertResellerIfCaughtUp); aqui é a rede de
// segurança diária + a aplicação dos marcos e os avisos (sino + WhatsApp).
//
// O "relógio" de uma aresta-base é quando ela ficou DEVIDA: created_at se o coletor é
// o próprio parceiro direto; senão o settled_at da aresta de baixo (quando o
// sub-parceiro pagou o parceiro) — o mesmo gatilho da cobrança em cascata (Etapa 2).
const { query } = require('../db');
const { formatISODate } = require('../utils/date-only');
const { createNotification } = require('./notifications');
const { sendWhatsapp } = require('./messenger');
const { resolvePartnerContact } = require('./partner-commission');
const {
  reparentToPadrao, setResellerStatus, markResellerDelinquent, revertResellerIfCaughtUp,
} = require('./reseller-enforcement');
const logger = require('../utils/logger');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const ENABLED = String(process.env.RESELLER_DELQ_ENABLED ?? 'true') !== 'false';
const LOCK_MONTHS = Math.max(1, Number(process.env.RESELLER_DELQ_LOCK_MONTHS || 3));
const SEIZE_MONTHS = Math.max(LOCK_MONTHS + 1, Number(process.env.RESELLER_DELQ_SEIZE_MONTHS || 6));
const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Meses inteiros de calendário entre duas datas (>= 0).
function monthsBetween(from, to) {
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m -= 1;
  return Math.max(0, m);
}

async function notifyPartner(partnerId, { title, body, dedupKey }) {
  await createNotification({ companyId: partnerId, type: 'reseller_delinquency', title, body, dedupKey }).catch(() => {});
  try {
    const contact = await resolvePartnerContact(partnerId);
    if (contact?.phone) await sendWhatsapp(partnerId, { number: contact.phone, text: `${title}\n${body || ''}`.trim() });
  } catch (err) {
    logger.warn({ err, partnerId }, '[reseller-delq] WhatsApp falhou');
  }
}

// Re-parent CIRÚRGICO: só os sub-PARCEIROS (is_partner) ligados às arestas-base
// vencidas deste parceiro. reparent_target de coletor direto aponta p/ um assinante
// (não-parceiro) — ignorado pelo JOIN em is_partner.
async function lockChildren(partnerId, padraoId) {
  const kids = await query(
    `SELECT DISTINCT c.reparent_target_id AS child_id
       FROM ${SCHEMA}.partner_commissions c
       LEFT JOIN ${SCHEMA}.partner_commissions p ON p.id = c.parent_commission_id
       JOIN ${SCHEMA}.companies ch ON ch.id = c.reparent_target_id AND ch.is_partner = true
      WHERE c.payee_company_id = $1 AND c.payer_company_id = $2
        AND c.status IN ('accrued','charged')
        AND (c.parent_commission_id IS NULL OR p.status = 'settled')
        AND c.reparent_target_id IS NOT NULL`,
    [padraoId, partnerId]
  );
  let moved = 0;
  for (const k of kids.rows) {
    const out = await reparentToPadrao(k.child_id);
    moved += out.reparented || 0;
  }
  return moved;
}

async function runResellerDelinquencyCron(now = new Date()) {
  if (!ENABLED) return { resellerDisabled: true };
  const ownerRes = await query(`SELECT id FROM ${SCHEMA}.companies WHERE is_saas_owner = true LIMIT 1`);
  const padraoId = ownerRes.rows[0]?.id || null;
  if (!padraoId) return { resellerLocked: 0, resellerSeized: 0 };

  // Parceiros com aresta-base ELEGÍVEL e ainda não paga (recebeu do sub-parceiro mas
  // não repassou). oldest = quando a mais antiga ficou devida (o relógio).
  const due = await query(
    `SELECT c.payer_company_id AS partner_id,
            MIN(CASE WHEN c.parent_commission_id IS NULL THEN c.created_at ELSE p.settled_at END) AS oldest,
            COALESCE(SUM(c.amount),0)::numeric(14,2) AS total
       FROM ${SCHEMA}.partner_commissions c
       LEFT JOIN ${SCHEMA}.partner_commissions p ON p.id = c.parent_commission_id
      WHERE c.payee_company_id = $1
        AND c.status IN ('accrued','charged')
        AND (c.parent_commission_id IS NULL OR p.status = 'settled')
      GROUP BY c.payer_company_id`,
    [padraoId]
  );

  let locked = 0, seized = 0, warned = 0;
  const stillDelinquent = new Set();

  for (const row of due.rows) {
    const partnerId = row.partner_id;
    if (!partnerId || partnerId === padraoId) continue;
    stillDelinquent.add(partnerId);
    const oldest = new Date(row.oldest);
    const months = monthsBetween(oldest, now);
    const total = Number(row.total || 0);
    await markResellerDelinquent(partnerId, formatISODate(oldest)).catch(() => {});

    try {
      if (months >= SEIZE_MONTHS) {
        await setResellerStatus(partnerId, 'network_seized');
        await lockChildren(partnerId, padraoId); // garante o re-parent também
        seized += 1;
        await notifyPartner(partnerId, {
          title: 'Revenda suspensa por inadimplência',
          body: `Sua comissão em aberto (${BRL(total)}) passou de ${SEIZE_MONTHS} meses. As comissões da sua rede foram direcionadas à plataforma. Quite para reativar tudo.`,
          dedupKey: `reseller-delq:${partnerId}:seized`,
        });
      } else if (months >= LOCK_MONTHS) {
        await setResellerStatus(partnerId, 'link_locked');
        const moved = await lockChildren(partnerId, padraoId);
        locked += 1;
        await notifyPartner(partnerId, {
          title: 'Revenda bloqueada por inadimplência',
          body: `Comissão em aberto (${BRL(total)}) há mais de ${LOCK_MONTHS} meses. Seu link de indicação foi bloqueado${moved ? ` e ${moved} sub-parceiro(s) passaram à plataforma` : ''}. Quite para reativar.`,
          dedupKey: `reseller-delq:${partnerId}:locked`,
        });
      } else {
        warned += 1;
        await notifyPartner(partnerId, {
          title: 'Comissão de revenda em aberto',
          body: `Você tem ${BRL(total)} de comissão a repassar à plataforma. Regularize em até ${LOCK_MONTHS} meses para não bloquear sua revenda.`,
          dedupKey: `reseller-delq:${partnerId}:m${months}`,
        });
      }
    } catch (err) {
      logger.error({ err, partnerId }, '[reseller-delq] falha ao aplicar marco');
    }
  }

  // Reversão (rede de segurança diária): parceiros marcados que já não têm base
  // elegível em aberto — restaura a rede e destrava.
  const flagged = await query(
    `SELECT id FROM ${SCHEMA}.companies
      WHERE is_partner = true
        AND (reseller_status <> 'active' OR reseller_delinquent_since IS NOT NULL)`
  );
  let reverted = 0;
  for (const r of flagged.rows) {
    if (stillDelinquent.has(r.id)) continue;
    try {
      const out = await revertResellerIfCaughtUp(r.id);
      if (out.reverted) reverted += 1;
    } catch (err) {
      logger.error({ err, partnerId: r.id }, '[reseller-delq] falha ao reverter');
    }
  }

  if (locked || seized || reverted) logger.info({ locked, seized, warned, reverted }, '[reseller-delq] lifecycle aplicado');
  return { resellerLocked: locked, resellerSeized: seized, resellerWarned: warned, resellerReverted: reverted };
}

module.exports = { runResellerDelinquencyCron, monthsBetween };
