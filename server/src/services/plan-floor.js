// server/src/services/plan-floor.js
// Reajuste de PISO agendado (revenda). A plataforma agenda um novo piso do plano
// com data de vigência futura; os parceiros são avisados (sino) na hora e em
// lembretes (D-30/15/7/1). Na data, o cron aplica: troca o piso do plano e SOBE
// automaticamente os preços de parceiro que ficaram abaixo (nunca vende abaixo do
// piso). Ver memória partner-reseller-commission-model (decisão 8).
const { query, withClient } = require('../db');
const { formatISODate, ensureDateOnly } = require('../utils/date-only');
const { createNotification } = require('./notifications');
const logger = require('../utils/logger');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const REMINDER_DAYS = [30, 15, 7, 1];

const BRL = (v) => (v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
function brDate(iso) { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; }

// Parceiros ativos (todos são potenciais vendedores de qualquer plano).
async function activePartners() {
  const r = await query(
    `SELECT id FROM ${SCHEMA}.companies WHERE is_partner = true AND status <> 'canceled'`
  );
  return r.rows.map((x) => x.id);
}

async function notifyPartners({ type, title, body, dedupKey, link = '/commissions', refId = null }) {
  const partners = await activePartners();
  let sent = 0;
  for (const pid of partners) {
    const id = await createNotification({ companyId: pid, type, title, body, refType: 'plan', refId, link, dedupKey });
    if (id) sent += 1;
  }
  return sent;
}

// Agenda um novo piso e avisa os parceiros imediatamente.
async function schedulePlanFloor({ planId, newMonthly = null, newAnnual = null, effectiveDate, note = null, userId = null }) {
  const planRes = await query(`SELECT id, name FROM ${SCHEMA}.plans WHERE id=$1`, [planId]);
  const plan = planRes.rows[0];
  if (!plan) { const e = new Error('Plano não encontrado'); e.status = 404; throw e; }
  if (newMonthly == null && newAnnual == null) { const e = new Error('Informe ao menos um novo preço (mensal ou anual)'); e.status = 400; throw e; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate || ''))) { const e = new Error('Data de vigência inválida (AAAA-MM-DD)'); e.status = 400; throw e; }
  if (formatISODate(new Date()) >= effectiveDate) { const e = new Error('A vigência deve ser uma data futura'); e.status = 400; throw e; }

  const ins = await query(
    `INSERT INTO ${SCHEMA}.plan_floor_adjustments (plan_id, new_price_monthly, new_price_annual, effective_date, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [planId, newMonthly, newAnnual, effectiveDate, note, userId]
  );
  const adjId = ins.rows[0].id;

  const parts = [];
  if (newMonthly != null) parts.push(`mensal ${BRL(newMonthly)}`);
  if (newAnnual != null) parts.push(`anual ${BRL(newAnnual)}`);
  await notifyPartners({
    type: 'plan_floor_scheduled',
    title: `Novo piso do plano ${plan.name}`,
    body: `A partir de ${brDate(effectiveDate)}: ${parts.join(' · ')}. Ajuste seus preços se necessário.`,
    dedupKey: `floor:${adjId}:announce`,
    refId: planId,
  });
  logger.info({ adjId, planId, effectiveDate }, '[plan-floor] reajuste de piso agendado');
  return { id: adjId };
}

// Aplica um reajuste vencido: troca o piso e sobe preços de parceiro abaixo dele.
async function applyFloor(a) {
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE ${SCHEMA}.plans
            SET price_monthly = COALESCE($2, price_monthly),
                price_annual  = COALESCE($3, price_annual),
                updated_at = now()
          WHERE id = $1`,
        [a.plan_id, a.new_price_monthly, a.new_price_annual]
      );
      if (a.new_price_monthly != null) {
        await client.query(
          `UPDATE ${SCHEMA}.partner_plan_prices SET price_monthly=$2, updated_at=now()
            WHERE plan_id=$1 AND price_monthly IS NOT NULL AND price_monthly < $2`,
          [a.plan_id, a.new_price_monthly]
        );
      }
      if (a.new_price_annual != null) {
        await client.query(
          `UPDATE ${SCHEMA}.partner_plan_prices SET price_annual=$2, updated_at=now()
            WHERE plan_id=$1 AND price_annual IS NOT NULL AND price_annual < $2`,
          [a.plan_id, a.new_price_annual]
        );
      }
      await client.query(`UPDATE ${SCHEMA}.plan_floor_adjustments SET applied_at=now() WHERE id=$1`, [a.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
  await notifyPartners({
    type: 'plan_floor_applied',
    title: `Piso do plano ${a.name} reajustado`,
    body: 'O novo piso está em vigor. Onde seu preço estava abaixo, ajustamos para o mínimo.',
    dedupKey: `floor:${a.id}:applied`,
    refId: a.plan_id,
  });
  logger.info({ adjId: a.id, planId: a.plan_id }, '[plan-floor] piso aplicado');
}

// Cron diário: aplica os vencidos e envia lembretes (D-30/15/7/1).
async function runPlanFloorCron(now = new Date()) {
  const today = formatISODate(now);
  const pend = await query(
    `SELECT a.id, a.plan_id, a.new_price_monthly, a.new_price_annual, a.effective_date, p.name
       FROM ${SCHEMA}.plan_floor_adjustments a
       JOIN ${SCHEMA}.plans p ON p.id = a.plan_id
      WHERE a.applied_at IS NULL`
  );
  let applied = 0;
  let reminded = 0;
  for (const a of pend.rows) {
    const effIso = formatISODate(a.effective_date);
    try {
      if (effIso <= today) {
        await applyFloor(a);
        applied += 1;
      } else {
        const days = Math.round((ensureDateOnly(effIso) - ensureDateOnly(today)) / 86400000);
        if (REMINDER_DAYS.includes(days)) {
          await notifyPartners({
            type: 'plan_floor_reminder',
            title: `Reajuste de piso em ${days} dia(s)`,
            body: `Plano ${a.name}: novo piso vale a partir de ${brDate(effIso)}.`,
            dedupKey: `floor:${a.id}:d${days}`,
            refId: a.plan_id,
          });
          reminded += 1;
        }
      }
    } catch (err) {
      logger.error({ err, adjId: a.id }, '[plan-floor] falha ao processar reajuste');
    }
  }
  if (applied || reminded) logger.info({ applied, reminded }, '[plan-floor] cron executado');
  return { applied, reminded };
}

module.exports = { schedulePlanFloor, runPlanFloorCron, applyFloor };
