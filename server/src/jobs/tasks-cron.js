// server/src/jobs/tasks-cron.js
// Job diário do Gerenciador de Tarefas:
//  1) Gera as OCORRÊNCIAS das rotinas recorrentes (mensal/anual) até o período
//     atual — idempotente por (source_node_id, due_date). O nó recorrente é um
//     TEMPLATE (is_template=true, oculto do board); cada ocorrência é uma cópia
//     visível com prazo calculado, clonando a subárvore de subitens do template.
//  2) Notifica prazos na central do sino: 3 dias antes, amanhã, vence hoje e ao
//     virar atrasada (1 aviso cada, via dedup_key).
const { query } = require('../db');
const { createNotification } = require('../services/notifications');
const { formatISODate } = require('../utils/date-only');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const pad = (n) => String(n).padStart(2, '0');
const daysBetween = (aISO, bISO) => Math.round((new Date(`${bISO}T00:00:00`) - new Date(`${aISO}T00:00:00`)) / 86400000);

// Data (AAAA-MM-DD) do dia informado, com clamp para o último dia do mês.
function occurrenceISO(year, month, day) {
  const last = new Date(year, month, 0).getDate();
  const d = Math.min(Math.max(Number(day) || 1, 1), last);
  return `${year}-${pad(month)}-${pad(d)}`;
}

// Soma dias a uma data AAAA-MM-DD (local, imune a fuso).
function addDaysISO(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// Próxima data (≥ hoje) cujo dia da semana é `weekday` (0=domingo … 6=sábado).
function nextWeekdayISO(now, weekday) {
  const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = ((Number(weekday) || 0) - dt.getDay() + 7) % 7; // 0 = hoje
  dt.setDate(dt.getDate() + diff);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// Ocorrência do período ATUAL de um template (a 1ª, quando ainda não há nenhuma).
function currentPeriodISO(t, now) {
  const y = now.getFullYear();
  if (t.recurrence === 'weekly' || t.recurrence === 'biweekly') return nextWeekdayISO(now, t.recurrence_day || 1);
  if (t.recurrence === 'yearly') return occurrenceISO(y, t.recurrence_month || 1, t.recurrence_day || 1);
  return occurrenceISO(y, now.getMonth() + 1, t.recurrence_day || 1);
}

// Próxima ocorrência DEPOIS de um prazo (conforme a recorrência).
function nextOccurrenceISO(t, afterISO) {
  if (t.recurrence === 'weekly') return addDaysISO(afterISO, 7);
  if (t.recurrence === 'biweekly') return addDaysISO(afterISO, 14);
  const [y, m] = String(afterISO).split('-').map(Number); // ano, mês (1-12)
  if (t.recurrence === 'yearly') return occurrenceISO(y + 1, t.recurrence_month || 1, t.recurrence_day || 1);
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return occurrenceISO(ny, nm, t.recurrence_day || 1);
}

async function firstStageId(companyId) {
  const r = await query(`SELECT id FROM ${SCHEMA}.task_stages WHERE company_id=$1 ORDER BY position, id LIMIT 1`, [companyId]);
  return r.rows[0]?.id || null;
}

// Coluna onde a OCORRÊNCIA deve nascer. Respeita a coluna "casa" do template
// (t.stage_id) quando ela ainda existe e é uma coluna aberta (não "Concluído") —
// assim rotinas recorrentes criadas para/movidas a uma coluna dinâmica mantêm as
// próximas ocorrências nessa coluna. Fallback: 1ª coluna ("A fazer").
async function occurrenceStageId(t) {
  if (t.stage_id) {
    const s = await query(
      `SELECT id FROM ${SCHEMA}.task_stages WHERE id=$1 AND company_id=$2 AND is_done=false`,
      [t.stage_id, t.company_id]
    );
    if (s.rows[0]) return t.stage_id;
  }
  return firstStageId(t.company_id);
}

// Clona recursivamente os subitens do template (srcParentId) sob newParentId, como
// nós reais da ocorrência (is_template=false), mantendo source_node_id p/ rastreio.
async function cloneChildren(srcParentId, newParentId, companyId, stageId) {
  const kids = await query(`SELECT * FROM ${SCHEMA}.task_nodes WHERE parent_id=$1 AND deleted_at IS NULL ORDER BY position, id`, [srcParentId]);
  for (const k of kids.rows) {
    const r = await query(
      `INSERT INTO ${SCHEMA}.task_nodes
         (company_id, group_id, parent_id, stage_id, kind, title, description, assignee_id, priority, due_date,
          recurrence, is_template, source_node_id, client_id, contract_id, position, created_by, is_heading)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'none',false,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [companyId, k.group_id, newParentId, stageId, k.kind, k.title, k.description, k.assignee_id, k.priority, k.due_date, k.id, k.client_id, k.contract_id, k.position, k.created_by, k.is_heading]
    );
    await cloneChildren(k.id, r.rows[0].id, companyId, stageId);
  }
}

// Cria a ocorrência do template para o prazo dado, se ainda não existir. Retorna 1/0.
// `src` = de onde copiar os dados do topo E a subárvore COMPLETA. Padrão = o próprio
// template (1ª ocorrência). Ao ROLAR (concluiu/venceu), passamos a ocorrência ANTERIOR
// como src → a nova nasce com TODOS os subitens que o usuário montou, desmarcados e com
// o novo prazo. source_node_id continua sendo o template (âncora da rotina).
async function ensureOccurrence(t, dueISO, src = null) {
  const source = src || t;
  const exists = await query(
    `SELECT 1 FROM ${SCHEMA}.task_nodes WHERE source_node_id=$1 AND due_date=$2 LIMIT 1`,
    [t.id, dueISO]
  );
  if (exists.rows[0]) return 0;
  const stageId = await occurrenceStageId(t);
  const pos = await query(
    `SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_nodes
      WHERE company_id=$1 AND COALESCE(group_id,0)=COALESCE($2,0) AND parent_id IS NULL AND is_template=false`,
    [t.company_id, t.group_id]
  );
  const r = await query(
    `INSERT INTO ${SCHEMA}.task_nodes
       (company_id, group_id, parent_id, stage_id, kind, title, description, assignee_id, priority, due_date,
        recurrence, is_template, source_node_id, client_id, contract_id, position, created_by, is_heading)
     VALUES ($1,$2,NULL,$3,'fixa',$4,$5,$6,$7,$8,'none',false,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [t.company_id, t.group_id, stageId, source.title, source.description, source.assignee_id, source.priority, dueISO, t.id, source.client_id, source.contract_id, pos.rows[0].p, t.created_by, source.is_heading]
  );
  const occId = r.rows[0].id;
  await cloneChildren(source.id, occId, t.company_id, stageId);
  await query(
    `INSERT INTO ${SCHEMA}.task_node_activity (node_id, user_id, action, detail) VALUES ($1,NULL,'generated',$2)`,
    [occId, `Ocorrência ${dueISO.split('-').reverse().join('/')} da rotina`]
  );
  return occId;
}

// Modelo "roll-forward": mantém 1 ocorrência ativa por rotina. Cria a 1ª quando não
// há nenhuma; e avança para a PRÓXIMA quando a última já foi concluída OU venceu o
// prazo (não pré-gera várias). Idempotente por (source_node_id, due_date).
async function generateOccurrences(companyId, now = new Date()) {
  const tps = await query(
    `SELECT * FROM ${SCHEMA}.task_nodes WHERE company_id=$1 AND is_template=true AND recurrence<>'none' AND recurrence_paused=false AND deleted_at IS NULL`,
    [companyId]
  );
  const today = formatISODate(now);
  let count = 0;
  for (const t of tps.rows) {
    const last = await query(
      `SELECT id, due_date, status FROM ${SCHEMA}.task_nodes
        WHERE source_node_id=$1 AND parent_id IS NULL AND deleted_at IS NULL ORDER BY due_date DESC NULLS LAST LIMIT 1`,
      [t.id]
    );
    const latest = last.rows[0];
    if (!latest) { if (await ensureOccurrence(t, currentPeriodISO(t, now))) count += 1; continue; }
    const latestISO = formatISODate(latest.due_date);
    if (latestISO && (latest.status === 'done' || latestISO < today)) {
      // Clona a próxima a partir da ocorrência ANTERIOR (estrutura completa), não do template.
      const full = await query(`SELECT * FROM ${SCHEMA}.task_nodes WHERE id=$1`, [latest.id]);
      if (await ensureOccurrence(t, nextOccurrenceISO(t, latestISO), full.rows[0] || null)) count += 1;
    }
  }
  return count;
}

// Ao concluir/vencer uma ocorrência recorrente, materializa a PRÓXIMA imediatamente.
// occ = a ocorrência (tarefa de topo com source_node_id apontando para o template).
async function rollNextOccurrence(companyId, occ) {
  if (!occ || occ.parent_id != null || !occ.source_node_id) return 0;
  const tr = await query(
    `SELECT * FROM ${SCHEMA}.task_nodes WHERE id=$1 AND company_id=$2 AND is_template=true AND recurrence<>'none' AND recurrence_paused=false AND deleted_at IS NULL`,
    [occ.source_node_id, companyId]
  );
  const t = tr.rows[0];
  if (!t) return 0;
  const dueISO = formatISODate(occ.due_date);
  if (!dueISO) return 0;
  // Passa a ocorrência concluída como fonte → a próxima nasce com a estrutura COMPLETA
  // (todos os subitens que o usuário montou), desmarcada e com o novo prazo.
  return ensureOccurrence(t, nextOccurrenceISO(t, dueISO), occ);
}

// Avisos de prazo (1 aviso por fase, via dedup_key). Cadência robusta (à prova de
// dia perdido pelo cron e de ocorrência que nasce já vencida — caso comum das
// rotinas recorrentes, cujo prazo vem do dia de referência):
//   • aproximando: ao ENTRAR na janela de 3 dias (diff entre 1 e 3) → 1 aviso;
//   • vence hoje (diff = 0) → 1 aviso;
//   • atrasada: em QUALQUER dia após o prazo (diff < 0) → 1 aviso.
// Assim, uma tarefa recorrente dia 15 avisa ~3 dias antes e, se passar do 15,
// avisa uma vez mesmo que o cron não tenha rodado exatamente no -1. Pessoal para o
// responsável; sem responsável, vai para a empresa. Só tarefas abertas com prazo
// (não templates).
async function notifyDeadlines(now) {
  const today = formatISODate(now);
  const nodes = await query(
    `SELECT id, company_id, title, due_date, assignee_id
       FROM ${SCHEMA}.task_nodes
      WHERE status='open' AND is_template=false AND due_date IS NOT NULL AND deleted_at IS NULL`
  );
  let created = 0;
  for (const n of nodes.rows) {
    const dueISO = formatISODate(n.due_date);
    if (!dueISO) continue;
    const diff = daysBetween(today, dueISO); // >0 = faltam dias; 0 = hoje; <0 = atrasada
    let bucket = null; let title = null;
    if (diff < 0) { bucket = 'late'; title = `Tarefa atrasada: ${n.title}`; }
    else if (diff === 0) { bucket = 'd0'; title = `Tarefa vence hoje: ${n.title}`; }
    else if (diff <= 3) { bucket = 'soon'; title = `Tarefa vence em ${diff} dia${diff > 1 ? 's' : ''}: ${n.title}`; }
    if (!bucket) continue;
    const dateBr = dueISO.split('-').reverse().join('/');
    await createNotification({
      companyId: n.company_id, userId: n.assignee_id || null, type: 'task_due', title,
      body: diff < 0 ? `Prazo era ${dateBr} — está atrasada.` : `Prazo em ${dateBr}.`,
      refType: 'task_node', refId: n.id, link: '/tasks',
      dedupKey: `task-due:${n.id}:${bucket}`,
    });
    created++;
  }
  return created;
}

// Gera ocorrências de TODAS as empresas que têm rotinas recorrentes.
async function generateAllCompanies(now) {
  const cos = await query(`SELECT DISTINCT company_id FROM ${SCHEMA}.task_nodes WHERE is_template=true AND recurrence<>'none' AND deleted_at IS NULL`);
  let total = 0;
  for (const c of cos.rows) {
    try { total += await generateOccurrences(c.company_id, now); }
    catch (e) { console.error('[tasks] geração de ocorrências falhou empresa=%s: %s', c.company_id, e.message); }
  }
  return total;
}

async function runTasksDaily() {
  const now = new Date();
  const generated = await generateAllCompanies(now);
  const notified = await notifyDeadlines(now);
  return { generated, notified };
}

module.exports = { runTasksDaily, notifyDeadlines, generateOccurrences, generateAllCompanies, rollNextOccurrence, nextOccurrenceISO };
