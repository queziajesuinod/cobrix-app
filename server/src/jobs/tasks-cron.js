// server/src/jobs/tasks-cron.js
// Job diário do Gerenciador de Tarefas:
//  1) Rola para o mês vigente os cartões abertos de meses anteriores (mantém o
//     due_date original — SLA honesto — e registra a rolagem no histórico).
//  2) Gera notificações de prazo (D-3 / amanhã / hoje / vencida) na central do
//     sininho, idempotentes por cartão+faixa via dedup_key.
const { query } = require('../db');
const { createNotification } = require('../services/notifications');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const pad = (n) => String(n).padStart(2, '0');
const firstOfMonth = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
const daysBetween = (aISO, bISO) => Math.round((new Date(`${bISO}T00:00:00`) - new Date(`${aISO}T00:00:00`)) / 86400000);

async function rollAllTeams(now) {
  const first = firstOfMonth(now);
  const past = await query(
    `SELECT id, company_id, competence FROM ${SCHEMA}.task_cards WHERE status='open' AND competence < $1::date`,
    [first]
  );
  for (const c of past.rows) {
    const d = ensureDateOnly(c.competence);
    const diff = (now.getFullYear() * 12 + now.getMonth()) - (d.getFullYear() * 12 + d.getMonth());
    if (diff <= 0) continue;
    await query(`UPDATE ${SCHEMA}.task_cards SET competence=$1::date, months_rolled = months_rolled + $2, updated_at=now() WHERE id=$3`, [first, diff, c.id]);
    await query(`INSERT INTO ${SCHEMA}.task_activity (card_id, user_id, action, detail) VALUES ($1,NULL,'rolled',$2)`, [c.id, `Rolou ${diff} mês(es) para ${first.slice(0, 7)}`]);
  }
  return past.rowCount;
}

// Notifica: 3 dias ANTES do prazo (D-3) e 4 dias DEPOIS de vencer. Pessoal para o
// responsável (assignee); se não houver responsável, vai para a empresa (todos).
async function notifyDeadlines(now) {
  const today = formatISODate(now);
  const cards = await query(
    `SELECT id, company_id, title, due_date, assignee_id FROM ${SCHEMA}.task_cards WHERE status='open' AND due_date IS NOT NULL`
  );
  let created = 0;
  for (const c of cards.rows) {
    const dueISO = formatISODate(c.due_date);
    if (!dueISO) continue;
    const diff = daysBetween(today, dueISO); // >0 = faltam dias; <0 = atrasada
    let bucket = null; let title = null;
    if (diff === 3) { bucket = 'd3'; title = `Tarefa vence em 3 dias: ${c.title}`; }
    else if (diff === -4) { bucket = 'late4'; title = `Tarefa atrasada há 4 dias: ${c.title}`; }
    if (!bucket) continue;
    await createNotification({
      companyId: c.company_id, userId: c.assignee_id || null, type: 'task_due', title,
      body: `Prazo em ${dueISO.split('-').reverse().join('/')}.`,
      refType: 'task_card', refId: c.id, link: '/tasks',
      dedupKey: `task-due:${c.id}:${bucket}`,
    });
    created++;
  }
  return created;
}

async function runTasksDaily() {
  const now = new Date();
  const rolled = await rollAllTeams(now);
  const notified = await notifyDeadlines(now);
  return { rolled, notified };
}

module.exports = { runTasksDaily, rollAllTeams, notifyDeadlines };
