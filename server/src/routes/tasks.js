const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { requirePermission, getEffectivePermissions } = require('../services/permissions');
const { respondError } = require('../utils/http-error');
const { createNotification } = require('../services/notifications');
const { generateOccurrences, rollNextOccurrence } = require('../jobs/tasks-cron');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

const err = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };
const PRIORITIES = ['baixa', 'media', 'alta', 'urgente'];
const parsePriority = (v, fallback = 'media') => (PRIORITIES.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : fallback);
const parseKind = (v) => (String(v || '').toLowerCase() === 'fixa' ? 'fixa' : 'avulsa');
const parseRecurrence = (v) => (['weekly', 'biweekly', 'monthly', 'yearly'].includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'none');
const optId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
const optDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const optInt = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

// Acesso ao módulo = tasks.view. A antiga permissão única `tasks.manage` foi
// dividida em chaves granulares (tarefas/rotinas/colunas/etiquetas/checklists,
// separando criar/editar/excluir). Mover/concluir/comentar a própria tarefa basta
// view. Gestor (visão global + produtividade + lixeira) = tasks.gestor.
const base = [requireAuth, companyScope(true)];
const view = [...base, requirePermission('tasks.view')];
const gestor = [...base, requirePermission('tasks.gestor')];
// Chaves de ação → cadeia de middleware pronta.
const P = (key) => [...base, requirePermission(key)];
const stageCreate = P('tasks.stage.create');
const stageEdit = P('tasks.stage.edit');
const stageDelete = P('tasks.stage.delete');
const routineCreate = P('tasks.routine.create');
const routineEdit = P('tasks.routine.edit');
const routineDelete = P('tasks.routine.delete');
const labelCreate = P('tasks.label.create');
const labelEdit = P('tasks.label.edit');
const labelDelete = P('tasks.label.delete');
const checklistManage = P('tasks.checklist.manage');

// Permissões efetivas do request, memoizadas (evita reconsultar por checagem).
async function permsOf(req) {
  if (!req._taskPerms) req._taskPerms = new Set(await getEffectivePermissions(req.user, req.companyId));
  return req._taskPerms;
}
// Exige, dentro do handler, que o usuário tenha ao menos UMA das chaves (master passa).
async function ensurePerm(req, ...keys) {
  if (req.user.role === 'master') return;
  const perms = await permsOf(req);
  if (!keys.some((k) => perms.has(k))) err('Acesso negado: sem permissão para esta ação.', 403);
}
async function hasPerm(req, key) {
  if (req.user.role === 'master') return true;
  return (await permsOf(req)).has(key);
}

const AUTHOR = `(SELECT COALESCE(NULLIF(au.name,''), au.email) FROM ${SCHEMA}.users au WHERE au.id = n.assignee_id) AS assignee_name`;
// Nomes do vínculo opcional (cliente/contrato) de uma tarefa (alias de tabela `n`).
const LINKS = `
  (SELECT cli.name FROM ${SCHEMA}.clients cli WHERE cli.id = n.client_id) AS client_name,
  (SELECT con.description FROM ${SCHEMA}.contracts con WHERE con.id = n.contract_id) AS contract_description`;
// Etiquetas de uma tarefa (alias de tabela `n`) como json array.
const NODE_LABELS = `(SELECT COALESCE(json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) ORDER BY l.name), '[]'::json)
  FROM ${SCHEMA}.task_node_labels nl JOIN ${SCHEMA}.task_labels l ON l.id = nl.label_id WHERE nl.node_id = n.id) AS labels`;

async function logActivity(nodeId, userId, action, detail = null) {
  await query(
    `INSERT INTO ${SCHEMA}.task_node_activity (node_id, user_id, action, detail) VALUES ($1,$2,$3,$4)`,
    [nodeId, userId, action, detail]
  ).catch(() => {});
}

// Define as etiquetas de uma tarefa (substitui o conjunto). Valida que as labels
// pertencem à empresa.
async function setNodeLabels(nodeId, companyId, labelIds) {
  const ids = Array.isArray(labelIds) ? [...new Set(labelIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  let valid = [];
  if (ids.length) {
    const r = await query(`SELECT id FROM ${SCHEMA}.task_labels WHERE company_id=$1 AND id = ANY($2::int[])`, [companyId, ids]);
    valid = r.rows.map((x) => x.id);
  }
  await query(`DELETE FROM ${SCHEMA}.task_node_labels WHERE node_id=$1`, [nodeId]);
  for (const lid of valid) {
    await query(`INSERT INTO ${SCHEMA}.task_node_labels (node_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [nodeId, lid]);
  }
}

// Semeia as etapas padrão do quadro na 1ª vez que a empresa acessa o board.
async function ensureStages(companyId) {
  const r = await query(`SELECT COUNT(*)::int n FROM ${SCHEMA}.task_stages WHERE company_id=$1`, [companyId]);
  if (r.rows[0].n > 0) return;
  const defaults = [['A fazer', false], ['Em andamento', false], ['Concluído', true]];
  for (let i = 0; i < defaults.length; i++) {
    await query(
      `INSERT INTO ${SCHEMA}.task_stages (company_id, name, position, is_done) VALUES ($1,$2,$3,$4)`,
      [companyId, defaults[i][0], i, defaults[i][1]]
    );
  }
}

async function firstStageId(companyId) {
  const r = await query(`SELECT id FROM ${SCHEMA}.task_stages WHERE company_id=$1 ORDER BY position, id LIMIT 1`, [companyId]);
  return r.rows[0]?.id || null;
}

// A coluna "Concluído" (is_done) fica sempre por ÚLTIMO. Reencaixa posições: colunas
// abertas primeiro (na ordem atual), depois as de conclusão.
async function normalizeStagePositions(companyId) {
  const r = await query(
    `SELECT id FROM ${SCHEMA}.task_stages WHERE company_id=$1 ORDER BY is_done ASC, position ASC, id ASC`,
    [companyId]
  );
  let pos = 0;
  for (const row of r.rows) {
    await query(`UPDATE ${SCHEMA}.task_stages SET position=$1 WHERE id=$2`, [pos, row.id]);
    pos += 1;
  }
}

async function doneStageId(companyId) {
  const r = await query(`SELECT id FROM ${SCHEMA}.task_stages WHERE company_id=$1 AND is_done=true ORDER BY position, id LIMIT 1`, [companyId]);
  return r.rows[0]?.id || null;
}

async function firstOpenStageId(companyId) {
  const r = await query(`SELECT id FROM ${SCHEMA}.task_stages WHERE company_id=$1 AND is_done=false ORDER BY position, id LIMIT 1`, [companyId]);
  return r.rows[0]?.id || null;
}

// Garante (barato) que "Concluído" está por último; só reencaixa se houver desvio.
async function ensureDoneLast(companyId) {
  const last = await query(`SELECT is_done FROM ${SCHEMA}.task_stages WHERE company_id=$1 ORDER BY position DESC, id DESC LIMIT 1`, [companyId]);
  if (!last.rows.length || last.rows[0].is_done) return;
  const anyDone = await query(`SELECT 1 FROM ${SCHEMA}.task_stages WHERE company_id=$1 AND is_done=true LIMIT 1`, [companyId]);
  if (anyDone.rows[0]) await normalizeStagePositions(companyId);
}

// Migração p/ o board plano: cada rotina (task_group) vira uma COLUNA (task_stage).
// As tarefas de topo ABERTAS do grupo passam para a nova coluna; as concluídas ficam
// na etapa "Concluído" (preserva o estado). Zera group_id (FK é ON DELETE CASCADE:
// apagar o grupo sem zerar apagaria as tarefas) e remove o grupo. Idempotente: quando
// não há mais grupos, é no-op.
async function ensureUnifiedColumns(companyId) {
  // Pré-checagem barata: no caminho comum (já migrado) não abre transação.
  const pre = await query(`SELECT 1 FROM ${SCHEMA}.task_groups WHERE company_id=$1 LIMIT 1`, [companyId]);
  if (!pre.rows.length) return;
  await query('BEGIN');
  try {
    // Serializa migrações concorrentes da mesma empresa (evita colunas duplicadas
    // se dois loads do board correrem em paralelo). Relê os grupos dentro do lock.
    await query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`task-cols-${companyId}`]);
    const groups = await query(`SELECT id, name FROM ${SCHEMA}.task_groups WHERE company_id=$1 ORDER BY position, id`, [companyId]);
    for (const g of groups.rows) {
      const pos = await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_stages WHERE company_id=$1`, [companyId]);
      const st = await query(
        `INSERT INTO ${SCHEMA}.task_stages (company_id, name, position, is_done) VALUES ($1,$2,$3,false) RETURNING id`,
        [companyId, g.name, pos.rows[0].p]
      );
      const newStageId = st.rows[0].id;
      await query(
        `UPDATE ${SCHEMA}.task_nodes n
            SET stage_id=$1
          WHERE n.group_id=$2 AND n.parent_id IS NULL AND n.is_template=false
            AND n.stage_id NOT IN (SELECT id FROM ${SCHEMA}.task_stages WHERE company_id=$3 AND is_done=true)`,
        [newStageId, g.id, companyId]
      );
      // Zera group_id ANTES de apagar (FK é ON DELETE CASCADE — apagar sem zerar apagaria as tarefas).
      await query(`UPDATE ${SCHEMA}.task_nodes SET group_id=NULL WHERE group_id=$1`, [g.id]);
      await query(`DELETE FROM ${SCHEMA}.task_groups WHERE id=$1`, [g.id]);
    }
    // As colunas de rotina entraram no fim; reencaixa deixando "Concluído" por último.
    await normalizeStagePositions(companyId);
    await query('COMMIT');
  } catch (e) {
    await query('ROLLBACK').catch(() => {});
    throw e;
  }
}

async function getNode(companyId, id) {
  const r = await query(`SELECT * FROM ${SCHEMA}.task_nodes WHERE id=$1 AND company_id=$2`, [id, companyId]);
  if (!r.rows[0]) err('Tarefa não encontrada', 404);
  return r.rows[0];
}

// Gestor/admin (tasks.gestor) ou master enxergam tudo.
async function isGestorReq(req) {
  if (req.user.role === 'master') return true;
  const perms = await getEffectivePermissions(req.user, req.companyId);
  return perms.includes('tasks.gestor');
}

// Usuário comum só acessa a tarefa se algum nó da subárvore for atribuído/criado por ele,
// ou se ele foi mencionado num comentário da subárvore. Gestor/master: sempre.
async function canAccessNode(req, node) {
  if (await isGestorReq(req)) return true;
  const uid = req.user.id;
  const r = await query(
    `WITH RECURSIVE tree AS (
       SELECT id, assignee_id, created_by FROM ${SCHEMA}.task_nodes WHERE id=$1
       UNION ALL
       SELECT c.id, c.assignee_id, c.created_by FROM ${SCHEMA}.task_nodes c JOIN tree t ON c.parent_id=t.id
     )
     SELECT
       EXISTS(SELECT 1 FROM tree WHERE assignee_id=$2 OR created_by=$2) AS mine,
       EXISTS(SELECT 1 FROM tree t
                JOIN ${SCHEMA}.task_comments cm ON cm.node_id=t.id
                JOIN ${SCHEMA}.task_comment_mentions m ON m.comment_id=cm.id
               WHERE m.user_id=$2) AS mentioned`,
    [node.id, uid]
  );
  return Boolean(r.rows[0]?.mine || r.rows[0]?.mentioned);
}

async function getAccessibleNode(req, id, { allowDeleted = false } = {}) {
  const node = await getNode(req.companyId, id);
  if (!allowDeleted && node.deleted_at) err('Tarefa excluída (inativa)', 409);
  if (!(await canAccessNode(req, node))) err('Sem acesso a esta tarefa', 403);
  return node;
}

// Clona a subárvore de um nó (srcParentId) DENTRO do template (destParentId), como
// nós de MODELO (is_template=true, sem source_node_id/prazo/status). Usado para
// espelhar a estrutura de uma ocorrência de volta na definição da rotina.
async function cloneSubtreeAsTemplate(srcParentId, destParentId, companyId) {
  const kids = await query(`SELECT * FROM ${SCHEMA}.task_nodes WHERE parent_id=$1 AND deleted_at IS NULL ORDER BY position, id`, [srcParentId]);
  for (const k of kids.rows) {
    const r = await query(
      `INSERT INTO ${SCHEMA}.task_nodes
         (company_id, group_id, parent_id, stage_id, kind, title, description, assignee_id, priority,
          recurrence, is_template, client_id, contract_id, position, created_by, is_heading)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'none',true,$10,$11,$12,$13,$14) RETURNING id`,
      [companyId, k.group_id, destParentId, k.stage_id, k.kind, k.title, k.description, k.assignee_id, k.priority, k.client_id, k.contract_id, k.position, k.created_by, k.is_heading]
    );
    await cloneSubtreeAsTemplate(k.id, r.rows[0].id, companyId);
  }
}

// Ao editar as subtarefas (ou o topo) de uma OCORRÊNCIA recorrente, espelha a
// estrutura de volta no TEMPLATE (definição da rotina), para que os PRÓXIMOS meses
// nasçam com as mudanças. Só age quando a raiz é uma ocorrência viva de uma rotina.
// Best-effort: nunca quebra a operação que a disparou.
async function syncTemplateFromOccurrence(companyId, nodeId) {
  try {
    let node = (await query(`SELECT * FROM ${SCHEMA}.task_nodes WHERE id=$1 AND company_id=$2`, [nodeId, companyId])).rows[0];
    let guard = 0;
    while (node && node.parent_id && guard++ < 100) {
      node = (await query(`SELECT * FROM ${SCHEMA}.task_nodes WHERE id=$1`, [node.parent_id])).rows[0];
    }
    const root = node;
    if (!root || root.is_template || root.parent_id != null || !root.source_node_id || root.deleted_at) return;
    const tpl = (await query(`SELECT id FROM ${SCHEMA}.task_nodes WHERE id=$1 AND company_id=$2 AND is_template=true`, [root.source_node_id, companyId])).rows[0];
    if (!tpl) return;
    const templateId = tpl.id;
    await query(
      `UPDATE ${SCHEMA}.task_nodes SET title=$1, description=$2, priority=$3, is_heading=$4, assignee_id=$5, client_id=$6, contract_id=$7, updated_at=now() WHERE id=$8`,
      [root.title, root.description, root.priority, root.is_heading, root.assignee_id, root.client_id, root.contract_id, templateId]
    );
    await query(
      `WITH RECURSIVE d AS (
         SELECT id FROM ${SCHEMA}.task_nodes WHERE parent_id=$1
         UNION ALL SELECT c.id FROM ${SCHEMA}.task_nodes c JOIN d ON c.parent_id=d.id
       ) DELETE FROM ${SCHEMA}.task_nodes WHERE id IN (SELECT id FROM d)`,
      [templateId]
    );
    await cloneSubtreeAsTemplate(root.id, templateId, companyId);
  } catch (e) {
    console.error('[tasks] sync template<-ocorrência:', e.message);
  }
}

// ===================== ETAPAS (colunas) =====================
router.get('/stages', ...view, async (req, res) => {
  try {
    await ensureStages(req.companyId);
    const r = await query(`SELECT id, name, position, is_done FROM ${SCHEMA}.task_stages WHERE company_id=$1 ORDER BY position, id`, [req.companyId]);
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

router.post('/stages', ...stageCreate, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 1) err('Informe o nome da etapa');
    const pos = await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_stages WHERE company_id=$1`, [req.companyId]);
    const r = await query(
      `INSERT INTO ${SCHEMA}.task_stages (company_id, name, position, is_done) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.companyId, name, pos.rows[0].p, Boolean(req.body?.is_done)]
    );
    // Mantém "Concluído" por último mesmo tendo inserido no fim.
    await normalizeStagePositions(req.companyId);
    res.status(201).json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// Reordena as colunas de uma vez (drag-and-drop). Registrar ANTES de '/stages/:id'
// para não casar 'reorder' como :id. Aplica a nova posição pelo índice no array.
router.put('/stages/reorder', ...stageEdit, async (req, res) => {
  try {
    const order = Array.isArray(req.body?.order) ? req.body.order.map(Number).filter(Number.isInteger) : [];
    if (!order.length) err('Ordem inválida');
    const own = await query(`SELECT id FROM ${SCHEMA}.task_stages WHERE company_id=$1`, [req.companyId]);
    const ownIds = new Set(own.rows.map((r) => r.id));
    let pos = 0;
    for (const id of order) {
      if (!ownIds.has(id)) continue;
      await query(`UPDATE ${SCHEMA}.task_stages SET position=$1 WHERE id=$2 AND company_id=$3`, [pos, id, req.companyId]);
      pos += 1;
    }
    // Reencaixa e garante "Concluído" por último (o front envia só as colunas abertas).
    await normalizeStagePositions(req.companyId);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

router.put('/stages/:id', ...stageEdit, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cur = await query(`SELECT * FROM ${SCHEMA}.task_stages WHERE id=$1 AND company_id=$2`, [id, req.companyId]);
    if (!cur.rows[0]) err('Etapa não encontrada', 404);
    const name = req.body?.name != null ? String(req.body.name).trim() : cur.rows[0].name;
    const position = Number.isInteger(Number(req.body?.position)) ? Number(req.body.position) : cur.rows[0].position;
    const isDone = req.body?.is_done != null ? Boolean(req.body.is_done) : cur.rows[0].is_done;
    const r = await query(
      `UPDATE ${SCHEMA}.task_stages SET name=$1, position=$2, is_done=$3 WHERE id=$4 RETURNING *`,
      [name, position, isDone, id]
    );
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.delete('/stages/:id', ...stageDelete, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cur = await query(`SELECT id FROM ${SCHEMA}.task_stages WHERE id=$1 AND company_id=$2`, [id, req.companyId]);
    if (!cur.rows[0]) err('Etapa não encontrada', 404);
    const inUse = await query(`SELECT 1 FROM ${SCHEMA}.task_nodes WHERE stage_id=$1 AND deleted_at IS NULL LIMIT 1`, [id]);
    if (inUse.rows[0]) err('Mova as tarefas desta etapa antes de excluí-la', 409);
    await query(`DELETE FROM ${SCHEMA}.task_stages WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// ===================== GRUPOS (rotinas / raias) =====================
router.get('/groups', ...view, async (req, res) => {
  try {
    const r = await query(
      `SELECT g.id, g.name, g.description, g.recurring, g.default_assignee_id, g.default_priority, g.position,
              (SELECT COUNT(*) FROM ${SCHEMA}.task_nodes n WHERE n.group_id=g.id AND n.parent_id IS NULL AND n.is_template=false AND n.deleted_at IS NULL)::int AS tasks
         FROM ${SCHEMA}.task_groups g
        WHERE g.company_id=$1 ORDER BY g.position, g.name`,
      [req.companyId]
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

router.post('/groups', ...routineCreate, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2) err('Informe o nome da rotina');
    const pos = await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_groups WHERE company_id=$1`, [req.companyId]);
    const r = await query(
      `INSERT INTO ${SCHEMA}.task_groups (company_id, name, description, recurring, default_assignee_id, default_priority, position, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.companyId, name,
        req.body?.description ? String(req.body.description).trim() || null : null,
        req.body?.recurring != null ? Boolean(req.body.recurring) : true,
        optId(req.body?.default_assignee_id),
        parsePriority(req.body?.default_priority),
        pos.rows[0].p, req.user.id,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.put('/groups/:id', ...routineEdit, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cur = await query(`SELECT * FROM ${SCHEMA}.task_groups WHERE id=$1 AND company_id=$2`, [id, req.companyId]);
    if (!cur.rows[0]) err('Rotina não encontrada', 404);
    const g = cur.rows[0];
    const name = req.body?.name != null ? String(req.body.name).trim() : g.name;
    if (name.length < 2) err('Nome inválido');
    const description = req.body?.description !== undefined ? (String(req.body.description || '').trim() || null) : g.description;
    const recurring = req.body?.recurring != null ? Boolean(req.body.recurring) : g.recurring;
    const defAssignee = req.body?.default_assignee_id !== undefined ? optId(req.body.default_assignee_id) : g.default_assignee_id;
    const defPriority = req.body?.default_priority != null ? parsePriority(req.body.default_priority) : g.default_priority;
    const position = Number.isInteger(Number(req.body?.position)) ? Number(req.body.position) : g.position;
    const r = await query(
      `UPDATE ${SCHEMA}.task_groups
          SET name=$1, description=$2, recurring=$3, default_assignee_id=$4, default_priority=$5, position=$6, updated_at=now()
        WHERE id=$7 RETURNING *`,
      [name, description, recurring, defAssignee, defPriority, position, id]
    );
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// Excluir rotina — só se NÃO houver tarefas vinculadas (em nenhuma etapa, nem
// recorrências). Evita apagar trabalho por engano.
router.delete('/groups/:id', ...routineDelete, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const g = await query(`SELECT id FROM ${SCHEMA}.task_groups WHERE id=$1 AND company_id=$2`, [id, req.companyId]);
    if (!g.rows[0]) err('Rotina não encontrada', 404);
    const used = await query(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.task_nodes WHERE group_id=$1 AND deleted_at IS NULL`, [id]);
    if (used.rows[0].n > 0) err(`Esta rotina tem ${used.rows[0].n} tarefa(s) vinculada(s). Mova ou exclua as tarefas antes de remover a rotina.`, 409);
    await query(`DELETE FROM ${SCHEMA}.task_groups WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// ===================== BOARD (híbrido: raias × etapas) =====================
// Retorna etapas, grupos (raias) e as tarefas de topo (parent_id nulo). Tarefas com
// group_id nulo vão para a raia virtual "Avulsas". Subitens são carregados sob demanda.
router.get('/board', ...view, async (req, res) => {
  try {
    await ensureStages(req.companyId);
    await ensureUnifiedColumns(req.companyId);
    await ensureDoneLast(req.companyId);
    const stages = await query(`SELECT id, name, position, is_done FROM ${SCHEMA}.task_stages WHERE company_id=$1 ORDER BY position, id`, [req.companyId]);
    const groups = await query(
      `SELECT id, name, description, recurring, default_assignee_id, default_priority, position
         FROM ${SCHEMA}.task_groups WHERE company_id=$1 ORDER BY position, name`,
      [req.companyId]
    );
    // Visibilidade: gestor/master veem tudo; comum só o que é dele (atribuído/criado)
    // ou onde foi mencionado — considerando a subárvore. `sub_links` agrega os
    // clientes/contratos da subárvore (para a busca casar vínculos só de subtarefas).
    const gestor = await isGestorReq(req);
    const uid = req.user.id;
    const nodes = await query(
      `WITH RECURSIVE tree AS (
         SELECT r.id AS root_id, r.id, r.assignee_id, r.created_by, r.client_id, r.contract_id, r.is_heading, r.status
           FROM ${SCHEMA}.task_nodes r WHERE r.company_id=$1 AND r.parent_id IS NULL AND r.is_template=false AND r.deleted_at IS NULL
         UNION ALL
         SELECT t.root_id, c.id, c.assignee_id, c.created_by, c.client_id, c.contract_id, c.is_heading, c.status
           FROM ${SCHEMA}.task_nodes c JOIN tree t ON c.parent_id=t.id AND c.deleted_at IS NULL
       ),
       mn AS (
         SELECT DISTINCT cm.node_id FROM ${SCHEMA}.task_comments cm
           JOIN ${SCHEMA}.task_comment_mentions m ON m.comment_id=cm.id WHERE m.user_id=$2
       ),
       agg AS (
         SELECT t.root_id,
                bool_or(t.assignee_id=$2 OR t.created_by=$2) AS mine,
                bool_or(mnj.node_id IS NOT NULL) AS mentioned,
                string_agg(DISTINCT NULLIF(TRIM(COALESCE(cli.name,'')||' '||COALESCE(con.description,'')),''), ' | ') AS sub_links,
                -- Progresso = itens checáveis (não-título) em TODA a subárvore, em qualquer
                -- profundidade (exclui a própria raiz). Assim, títulos agrupadores no meio
                -- não zeram o progresso: contam os sub-subitens com conclusão.
                COUNT(*) FILTER (WHERE t.id <> t.root_id AND t.is_heading = false)::int AS sub_total,
                COUNT(*) FILTER (WHERE t.id <> t.root_id AND t.is_heading = false AND t.status = 'done')::int AS sub_done
           FROM tree t
           LEFT JOIN ${SCHEMA}.clients cli ON cli.id=t.client_id
           LEFT JOIN ${SCHEMA}.contracts con ON con.id=t.contract_id
           LEFT JOIN mn mnj ON mnj.node_id=t.id
          GROUP BY t.root_id
       )
       SELECT n.id, n.group_id, n.stage_id, n.kind, n.title, n.description, n.priority, n.due_date, n.status, n.is_heading,
              n.assignee_id, n.client_id, n.contract_id, n.recurrence, n.source_node_id, n.position, ${AUTHOR}, ${LINKS}, ${NODE_LABELS},
              a.sub_links, a.sub_total, a.sub_done
         FROM ${SCHEMA}.task_nodes n
         JOIN agg a ON a.root_id=n.id
        WHERE n.company_id=$1 AND n.parent_id IS NULL AND n.is_template=false AND n.deleted_at IS NULL
          AND ($3::boolean OR a.mine OR a.mentioned)
          -- Ocorrência recorrente CONCLUÍDA some do quadro: ela não vai para "Concluído",
          -- fica só no histórico/produtividade; o que aparece é a PRÓXIMA ocorrência.
          AND NOT (n.status = 'done' AND n.source_node_id IS NOT NULL)
        ORDER BY n.position, n.id`,
      [req.companyId, uid, gestor]
    );
    res.json({ stages: stages.rows, groups: groups.rows, nodes: nodes.rows });
  } catch (e) { respondError(res, e); }
});

// ===================== TAREFAS / SUBTAREFAS (árvore) =====================
// Detalhe de uma tarefa: a própria + toda a subárvore (flat, com parent_id) + histórico.
router.get('/nodes/:id', ...view, async (req, res) => {
  try {
    const node = await getAccessibleNode(req, Number(req.params.id));
    const subtree = await query(
      `WITH RECURSIVE tree AS (
         SELECT * FROM ${SCHEMA}.task_nodes WHERE parent_id=$1 AND deleted_at IS NULL
         UNION ALL
         SELECT c.* FROM ${SCHEMA}.task_nodes c JOIN tree t ON c.parent_id=t.id AND c.deleted_at IS NULL
       )
       SELECT n.id, n.parent_id, n.group_id, n.stage_id, n.kind, n.title, n.description, n.priority,
              n.due_date, n.status, n.is_heading, n.assignee_id, n.client_id, n.contract_id,
              n.recurrence, n.recurrence_day, n.recurrence_month, n.position, ${AUTHOR}, ${LINKS}
         FROM tree n ORDER BY n.parent_id, n.position, n.id`,
      [node.id]
    );
    const assignee = node.assignee_id
      ? (await query(`SELECT COALESCE(NULLIF(name,''), email) AS n FROM ${SCHEMA}.users WHERE id=$1`, [node.assignee_id])).rows[0]?.n || null
      : null;
    const links = (await query(
      `SELECT (SELECT name FROM ${SCHEMA}.clients WHERE id=$1) AS client_name,
              (SELECT description FROM ${SCHEMA}.contracts WHERE id=$2) AS contract_description`,
      [node.client_id, node.contract_id]
    )).rows[0];
    const activity = await query(
      `SELECT a.action, a.detail, a.created_at, COALESCE(NULLIF(u.name,''), u.email) AS user_name
         FROM ${SCHEMA}.task_node_activity a LEFT JOIN ${SCHEMA}.users u ON u.id=a.user_id
        WHERE a.node_id=$1 ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
      [node.id]
    );
    const comments = await query(
      `SELECT c.id, c.body, c.created_at, c.user_id, COALESCE(NULLIF(u.name,''), u.email) AS user_name,
              (SELECT COALESCE(json_agg(json_build_object('user_id', mu.id, 'name', COALESCE(NULLIF(mu.name,''), mu.email)) ORDER BY mu.name), '[]'::json)
                 FROM ${SCHEMA}.task_comment_mentions mm JOIN ${SCHEMA}.users mu ON mu.id=mm.user_id WHERE mm.comment_id=c.id) AS mentions
         FROM ${SCHEMA}.task_comments c LEFT JOIN ${SCHEMA}.users u ON u.id=c.user_id
        WHERE c.node_id=$1 ORDER BY c.created_at ASC, c.id ASC`,
      [node.id]
    );
    const nodeLabels = await query(
      `SELECT l.id, l.name, l.color FROM ${SCHEMA}.task_node_labels nl JOIN ${SCHEMA}.task_labels l ON l.id=nl.label_id WHERE nl.node_id=$1 ORDER BY l.name`,
      [node.id]
    );
    res.json({ node: { ...node, assignee_name: assignee, client_name: links?.client_name || null, contract_description: links?.contract_description || null, labels: nodeLabels.rows }, children: subtree.rows, activity: activity.rows, comments: comments.rows });
  } catch (e) { respondError(res, e); }
});

async function notifyAssignment(companyId, node, title) {
  if (!node.assignee_id) return;
  await createNotification({
    companyId, userId: node.assignee_id, type: 'task_assigned',
    title: `Você recebeu a tarefa: ${title}`, body: null,
    refType: 'task_node', refId: node.id, link: '/tasks',
    dedupKey: `task-assigned:${node.id}:${node.assignee_id}`,
  }).catch(() => {});
}

router.post('/nodes', ...base, async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (title.length < 2) err('Informe o título da tarefa');
    let groupId = optId(req.body?.group_id);
    const parentId = optId(req.body?.parent_id);
    // Subitem herda a rotina (grupo) do pai quando não for informada.
    let parent = null;
    if (parentId) { parent = await getNode(req.companyId, parentId); if (!(await canAccessNode(req, parent))) err('Sem acesso a esta tarefa', 403); if (!groupId) groupId = parent.group_id; }
    // Herda defaults do grupo (responsável/prioridade) quando não informados.
    let group = null;
    if (groupId) {
      const g = await query(`SELECT * FROM ${SCHEMA}.task_groups WHERE id=$1 AND company_id=$2`, [groupId, req.companyId]);
      if (!g.rows[0]) err('Rotina inválida');
      group = g.rows[0];
    }

    const kind = parseKind(req.body?.kind ?? (group ? 'fixa' : 'avulsa'));
    const stageId = optId(req.body?.stage_id) || (parent ? parent.stage_id : await firstStageId(req.companyId));
    // Subitem herda o responsável do pai; tarefa de topo usa o padrão da rotina.
    const assigneeId = req.body?.assignee_id !== undefined ? optId(req.body.assignee_id)
      : (parent ? parent.assignee_id : (group?.default_assignee_id || null));
    const priority = req.body?.priority != null ? parsePriority(req.body.priority) : (group ? group.default_priority : 'media');
    // Vínculo opcional cliente/contrato é só da tarefa: explícito > herdado do pai (subitem).
    const clientId = req.body?.client_id !== undefined ? optId(req.body.client_id) : (parent ? parent.client_id : null);
    const contractId = req.body?.contract_id !== undefined ? optId(req.body.contract_id) : (parent ? parent.contract_id : null);
    const dueDate = optDate(req.body?.due_date);
    // Recorrência só faz sentido em tarefa de topo; subitem nunca recorre sozinho.
    const recurrence = parentId ? 'none' : parseRecurrence(req.body?.recurrence);
    const isWeekly = recurrence === 'weekly' || recurrence === 'biweekly';
    // recurrence_day = dia da semana (0-6) p/ semanal/quinzenal; dia do mês (1-31) p/ mensal/anual.
    const recDay = recurrence !== 'none' ? optInt(req.body?.recurrence_day, isWeekly ? 0 : 1, isWeekly ? 6 : 31) : null;
    const recMonth = recurrence === 'yearly' ? optInt(req.body?.recurrence_month, 1, 12) : null;
    // Um nó recorrente é TEMPLATE (oculto do board); subitens de um template também
    // herdam is_template (fazem parte da definição, não são tarefas reais).
    const isTemplate = (recurrence !== 'none') || Boolean(parent && parent.is_template);
    // Nó "só título" (agrupador): sem check de conclusão; serve p/ vincular cliente/contrato.
    const isHeading = Boolean(req.body?.is_heading);
    const description = req.body?.description ? String(req.body.description).trim() || null : null;
    // Gating granular: criar rotina (template recorrente de topo) exige tasks.routine.create;
    // montar a subárvore de uma rotina aceita routine.create OU task.create; tarefa/subtarefa
    // comum exige tasks.task.create.
    if (!parentId && recurrence !== 'none') await ensurePerm(req, 'tasks.routine.create');
    else if (parent && parent.is_template) await ensurePerm(req, 'tasks.routine.create', 'tasks.task.create');
    else await ensurePerm(req, 'tasks.task.create');
    // Atribuir/criar tarefa para OUTRO usuário exige tasks.task.assign (sem ela, só para si).
    if (req.body?.assignee_id !== undefined && assigneeId && Number(assigneeId) !== Number(req.user.id)) {
      await ensurePerm(req, 'tasks.task.assign');
    }
    // Posição no fim da lista dentro do mesmo grupo/parent/etapa.
    const pos = await query(
      `SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_nodes
        WHERE company_id=$1 AND COALESCE(group_id,0)=COALESCE($2,0) AND COALESCE(parent_id,0)=COALESCE($3,0)`,
      [req.companyId, groupId, parentId]
    );
    const r = await query(
      `INSERT INTO ${SCHEMA}.task_nodes
         (company_id, group_id, parent_id, stage_id, kind, title, description, assignee_id, priority, due_date,
          recurrence, recurrence_day, recurrence_month, is_template, client_id, contract_id, position, created_by, is_heading)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [req.companyId, groupId, parentId, stageId, kind, title, description, assigneeId, priority, dueDate,
       recurrence, recDay, recMonth, isTemplate, clientId, contractId, pos.rows[0].p, req.user.id, isHeading]
    );
    const node = r.rows[0];
    if (req.body?.label_ids !== undefined) {
      try { await setNodeLabels(node.id, req.companyId, req.body.label_ids); } catch (e) { console.error('[tasks] labels (post):', e.message); }
    }
    await logActivity(node.id, req.user.id, 'created', parentId ? 'subtarefa criada' : 'tarefa criada');
    if (recurrence !== 'none') {
      try { await generateOccurrences(req.companyId, new Date()); } catch (e) { console.error('[tasks] geração imediata:', e.message); }
    } else {
      await notifyAssignment(req.companyId, node, title);
    }
    // Subitem criado numa OCORRÊNCIA recorrente → atualiza o modelo (próximos meses).
    if (parentId) await syncTemplateFromOccurrence(req.companyId, node.id);
    res.status(201).json(node);
  } catch (e) { respondError(res, e); }
});

// Reordena manualmente os cartões de uma etapa (drag dentro/entre colunas). Basta
// tasks.view. Registrar ANTES de '/nodes/:id' para não casar 'reorder' como :id.
router.put('/nodes/reorder', ...view, async (req, res) => {
  try {
    const stageId = Number(req.body?.stage_id);
    const order = Array.isArray(req.body?.order) ? req.body.order.map(Number).filter(Number.isInteger) : [];
    const st = await query(`SELECT 1 FROM ${SCHEMA}.task_stages WHERE id=$1 AND company_id=$2`, [stageId, req.companyId]);
    if (!st.rows[0]) err('Etapa inválida');
    if (!order.length) return res.json({ ok: true });
    const own = await query(`SELECT id FROM ${SCHEMA}.task_nodes WHERE company_id=$1 AND stage_id=$2 AND parent_id IS NULL AND deleted_at IS NULL`, [req.companyId, stageId]);
    const ownIds = new Set(own.rows.map((r) => r.id));
    await query('BEGIN');
    try {
      let pos = 0;
      for (const id of order) {
        if (!ownIds.has(id)) continue;
        await query(`UPDATE ${SCHEMA}.task_nodes SET position=$1 WHERE id=$2 AND company_id=$3`, [pos, id, req.companyId]);
        pos += 1;
      }
      await query('COMMIT');
    } catch (e) { await query('ROLLBACK').catch(() => {}); throw e; }
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

router.put('/nodes/:id', ...base, async (req, res) => {
  try {
    const node = await getAccessibleNode(req, Number(req.params.id));
    // Editar rotina (template) exige tasks.routine.edit; tarefa/subtarefa comum, tasks.task.edit.
    await ensurePerm(req, node.is_template ? 'tasks.routine.edit' : 'tasks.task.edit');
    const title = req.body?.title != null ? String(req.body.title).trim() : node.title;
    if (title.length < 2) err('Título inválido');
    const description = req.body?.description !== undefined ? (String(req.body.description || '').trim() || null) : node.description;
    const assigneeId = req.body?.assignee_id !== undefined ? optId(req.body.assignee_id) : node.assignee_id;
    // Reatribuir para OUTRO usuário (diferente do responsável atual e de si mesmo) exige tasks.task.assign.
    if (req.body?.assignee_id !== undefined && assigneeId && Number(assigneeId) !== Number(node.assignee_id) && Number(assigneeId) !== Number(req.user.id)) {
      await ensurePerm(req, 'tasks.task.assign');
    }
    const priority = req.body?.priority != null ? parsePriority(req.body.priority) : node.priority;
    const dueDate = req.body?.due_date !== undefined ? optDate(req.body.due_date) : node.due_date;
    // Recorrência só em tarefa de topo. Subitem mantém none e o is_template do pai.
    const isTopLevel = node.parent_id == null;
    const recurrence = !isTopLevel ? 'none' : (req.body?.recurrence != null ? parseRecurrence(req.body.recurrence) : node.recurrence);
    const isWeekly = recurrence === 'weekly' || recurrence === 'biweekly';
    const recDay = recurrence !== 'none' ? (req.body?.recurrence_day !== undefined ? optInt(req.body.recurrence_day, isWeekly ? 0 : 1, isWeekly ? 6 : 31) : node.recurrence_day) : null;
    const recMonth = recurrence === 'yearly' ? (req.body?.recurrence_month !== undefined ? optInt(req.body.recurrence_month, 1, 12) : node.recurrence_month) : null;
    const isTemplate = isTopLevel ? (recurrence !== 'none') : node.is_template;
    // Pausar/retomar a recorrência (só faz sentido em template de topo).
    const recPaused = (isTopLevel && recurrence !== 'none' && req.body?.recurrence_paused !== undefined)
      ? Boolean(req.body.recurrence_paused) : (recurrence !== 'none' ? node.recurrence_paused : false);
    // Vínculo cliente/contrato NÃO pode ser alterado depois de definido: uma vez que a
    // tarefa tem cliente/contrato, só o nome/detalhes mudam. Só é possível definir o
    // vínculo enquanto ele ainda estiver vazio.
    const linkLocked = node.client_id != null || node.contract_id != null;
    const clientId = linkLocked ? node.client_id : (req.body?.client_id !== undefined ? optId(req.body.client_id) : node.client_id);
    const contractId = linkLocked ? node.contract_id : (req.body?.contract_id !== undefined ? optId(req.body.contract_id) : node.contract_id);
    // "Só título" (is_heading) não tem conclusão; ao virar título, reabre (perde o done).
    const isHeading = req.body?.is_heading !== undefined ? Boolean(req.body.is_heading) : node.is_heading;
    const r = await query(
      `UPDATE ${SCHEMA}.task_nodes
          SET title=$1, description=$2, assignee_id=$3, priority=$4, due_date=$5,
              recurrence=$6, recurrence_day=$7, recurrence_month=$8, is_template=$9, client_id=$10, contract_id=$11,
              recurrence_paused=$12, is_heading=$14,
              status = CASE WHEN $14 THEN 'open' ELSE status END,
              done_at = CASE WHEN $14 THEN NULL ELSE done_at END,
              done_by = CASE WHEN $14 THEN NULL ELSE done_by END,
              updated_at=now()
        WHERE id=$13 RETURNING *`,
      [title, description, assigneeId, priority, dueDate, recurrence, recDay, recMonth, isTemplate, clientId, contractId, recPaused, node.id, isHeading]
    );
    // Ao virar (ou deixar de ser) template, a subárvore acompanha (definição vs tarefas reais).
    if (isTopLevel && isTemplate !== node.is_template) {
      await query(
        `WITH RECURSIVE tree AS (
           SELECT id FROM ${SCHEMA}.task_nodes WHERE parent_id=$1
           UNION ALL SELECT c.id FROM ${SCHEMA}.task_nodes c JOIN tree t ON c.parent_id=t.id
         )
         UPDATE ${SCHEMA}.task_nodes SET is_template=$2 WHERE id IN (SELECT id FROM tree)`,
        [node.id, isTemplate]
      );
    }
    if (Number(assigneeId) && Number(assigneeId) !== Number(node.assignee_id)) {
      await logActivity(node.id, req.user.id, 'assigned', 'responsável definido');
      if (!isTemplate) await notifyAssignment(req.companyId, r.rows[0], title);
    } else {
      await logActivity(node.id, req.user.id, 'edited', null);
    }
    if (isTemplate && recurrence !== 'none' && !recPaused) {
      try { await generateOccurrences(req.companyId, new Date()); } catch (e) { console.error('[tasks] geração (put):', e.message); }
    }
    // Editou uma OCORRÊNCIA recorrente (topo ou subtarefa) → espelha no modelo.
    await syncTemplateFromOccurrence(req.companyId, node.id);
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// "Excluir" = INATIVAR (soft delete). A tarefa e toda a subárvore ficam inativas
// (somem do quadro/minhas tarefas/calendário/produtividade), guardando quem e quando
// para auditoria. O Gestor pode restaurar pela Lixeira. Excluir rotina exige
// tasks.routine.delete; tarefa/subtarefa, tasks.task.delete.
router.delete('/nodes/:id', ...base, async (req, res) => {
  try {
    const node = await getAccessibleNode(req, Number(req.params.id));
    await ensurePerm(req, node.is_template ? 'tasks.routine.delete' : 'tasks.task.delete');
    await query('BEGIN');
    try {
      // Marca o nó e todos os descendentes ainda ativos como excluídos (não sobrescreve
      // quem já estava inativo antes, preservando a autoria original daquela exclusão).
      await query(
        `WITH RECURSIVE tree AS (
           SELECT id FROM ${SCHEMA}.task_nodes WHERE id=$1
           UNION ALL
           SELECT c.id FROM ${SCHEMA}.task_nodes c JOIN tree t ON c.parent_id=t.id
         )
         UPDATE ${SCHEMA}.task_nodes
            SET deleted_at=now(), deleted_by=$2, updated_at=now()
          WHERE id IN (SELECT id FROM tree) AND deleted_at IS NULL`,
        [node.id, req.user.id]
      );
      await query('COMMIT');
    } catch (e) { await query('ROLLBACK').catch(() => {}); throw e; }
    await logActivity(node.id, req.user.id, 'deleted', node.is_template ? 'rotina inativada' : 'tarefa inativada');
    // Excluiu subtarefa de uma OCORRÊNCIA recorrente → espelha a remoção no modelo
    // (sobe pelo pai, já que o próprio nó foi inativado).
    if (node.parent_id) await syncTemplateFromOccurrence(req.companyId, node.parent_id);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// Lixeira (Gestor): raízes de subárvores inativadas — o "topo" de cada exclusão
// (nó excluído cujo pai não está excluído). Mostra quem/quando inativou.
router.get('/trash', ...gestor, async (req, res) => {
  try {
    const r = await query(
      `SELECT n.id, n.title, n.is_template, n.parent_id, n.deleted_at,
              COALESCE(NULLIF(du.name,''), du.email) AS deleted_by_name,
              (SELECT COUNT(*) FROM ${SCHEMA}.task_nodes c WHERE c.parent_id=n.id AND c.deleted_at IS NOT NULL)::int AS sub_count
         FROM ${SCHEMA}.task_nodes n
         LEFT JOIN ${SCHEMA}.users du ON du.id=n.deleted_by
         LEFT JOIN ${SCHEMA}.task_nodes p ON p.id=n.parent_id
        WHERE n.company_id=$1 AND n.deleted_at IS NOT NULL
          AND (n.parent_id IS NULL OR p.deleted_at IS NULL)
        ORDER BY n.deleted_at DESC, n.id DESC`,
      [req.companyId]
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

// Restaurar (Gestor): reativa o nó e toda a subárvore inativada. Registra no histórico.
router.post('/nodes/:id/restore', ...gestor, async (req, res) => {
  try {
    const node = await getNode(req.companyId, Number(req.params.id));
    if (!node.deleted_at) err('Esta tarefa não está na lixeira', 409);
    await query('BEGIN');
    try {
      await query(
        `WITH RECURSIVE tree AS (
           SELECT id FROM ${SCHEMA}.task_nodes WHERE id=$1
           UNION ALL
           SELECT c.id FROM ${SCHEMA}.task_nodes c JOIN tree t ON c.parent_id=t.id
         )
         UPDATE ${SCHEMA}.task_nodes
            SET deleted_at=NULL, deleted_by=NULL, updated_at=now()
          WHERE id IN (SELECT id FROM tree) AND deleted_at IS NOT NULL`,
        [node.id]
      );
      await query('COMMIT');
    } catch (e) { await query('ROLLBACK').catch(() => {}); throw e; }
    await logActivity(node.id, req.user.id, 'restored', node.is_template ? 'rotina restaurada' : 'tarefa restaurada');
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// Mover a tarefa para outra etapa (coluna). Entrar numa etapa 'is_done' conclui;
// sair de uma etapa final reabre. Basta tasks.view (mover a própria tarefa).
router.post('/nodes/:id/move', ...view, async (req, res) => {
  try {
    const node = await getAccessibleNode(req, Number(req.params.id));
    const toStageId = Number(req.body?.to_stage_id);
    const st = await query(`SELECT id, is_done FROM ${SCHEMA}.task_stages WHERE id=$1 AND company_id=$2`, [toStageId, req.companyId]);
    if (!st.rows[0]) err('Etapa de destino inválida');
    const enteringDone = Boolean(st.rows[0].is_done);
    const isOccurrence = node.parent_id == null && node.source_node_id;
    // Heading normal não vai p/ Concluído; ocorrência de rotina "só título" pode (rola).
    if (enteringDone && node.is_heading && !isOccurrence) err('Este item é apenas um título e não tem marcação de conclusão.');
    // Ao arrastar uma tarefa NORMAL para "Concluído", guarda a coluna de origem em
    // prev_stage_id (reabrir volta para ela). Ocorrência recorrente não usa isso.
    // Sair de "Concluído" (mover para coluna aberta) limpa o prev_stage_id.
    const prevStageId = (enteringDone && !isOccurrence) ? node.stage_id : null;
    const r = await query(
      `UPDATE ${SCHEMA}.task_nodes
          SET stage_id=$1,
              status = CASE WHEN $2 THEN 'done' ELSE 'open' END,
              prev_stage_id = $5,
              started_at = COALESCE(started_at, now()),
              done_at = CASE WHEN $2 THEN now() ELSE NULL END,
              done_by = CASE WHEN $2 THEN $3::int ELSE NULL END,
              updated_at = now()
        WHERE id=$4 RETURNING *`,
      [toStageId, enteringDone, req.user.id, node.id, prevStageId]
    );
    await logActivity(node.id, req.user.id, 'moved', enteringDone ? 'concluída' : 'movida');
    // Ocorrência recorrente arrastada para uma coluna ABERTA (não "Concluído"): o
    // template "aprende" essa coluna como casa, para as PRÓXIMAS ocorrências nascerem
    // nela (mantém a rotina fixada na coluna dinâmica escolhida pelo usuário).
    if (!enteringDone && node.parent_id == null && node.source_node_id) {
      try {
        await query(
          `UPDATE ${SCHEMA}.task_nodes SET stage_id=$1, updated_at=now() WHERE id=$2 AND company_id=$3 AND is_template=true`,
          [toStageId, node.source_node_id, req.companyId]
        );
      } catch (e) { console.error('[tasks] fixar coluna do template (move):', e.message); }
    }
    // Ocorrência recorrente concluída → materializa a próxima (mês/ano seguinte).
    let rolledId = null;
    if (enteringDone && node.parent_id == null && node.source_node_id) {
      try { rolledId = (await rollNextOccurrence(req.companyId, node)) || null; } catch (e) { console.error('[tasks] roll (move):', e.message); }
    }
    res.json({ ...r.rows[0], rolled_node_id: rolledId });
  } catch (e) { respondError(res, e); }
});

// Concluir/reabrir diretamente (checkbox). Basta tasks.view.
router.patch('/nodes/:id/done', ...view, async (req, res) => {
  try {
    const node = await getAccessibleNode(req, Number(req.params.id));
    const done = Boolean(req.body?.done);
    const isOccurrence = node.parent_id == null && node.source_node_id;
    // Heading normal ("só título") não conclui; MAS a ocorrência de uma rotina
    // recorrente "só título" PODE — marcá-la como feita rola a próxima e some do quadro.
    if (node.is_heading && !isOccurrence) err('Este item é apenas um título e não tem marcação de conclusão.');
    // Destino da coluna ao concluir/reabrir uma tarefa de TOPO:
    //  - Ocorrência recorrente (coluna dinâmica): NÃO vai para "Concluído" — fica onde
    //    está (o board a esconde) e o roll cria a próxima. Não mexe em prev_stage_id.
    //  - Tarefa normal: concluir guarda a coluna atual em prev_stage_id e move p/
    //    "Concluído"; reabrir VOLTA para prev_stage_id (se ainda existir e for aberta),
    //    senão para a 1ª coluna aberta, e limpa prev_stage_id.
    let stageId = node.stage_id;
    let prevStageId = node.prev_stage_id ?? null;
    if (node.parent_id == null && !isOccurrence) {
      if (done) {
        const doneS = await doneStageId(req.companyId);
        if (doneS && node.stage_id !== doneS) { prevStageId = node.stage_id; stageId = doneS; }
      } else {
        let target = null;
        if (node.prev_stage_id) {
          const ps = await query(`SELECT id FROM ${SCHEMA}.task_stages WHERE id=$1 AND company_id=$2 AND is_done=false`, [node.prev_stage_id, req.companyId]);
          target = ps.rows[0]?.id || null;
        }
        if (!target) target = await firstOpenStageId(req.companyId);
        if (target) stageId = target;
        prevStageId = null;
      }
    }
    const r = await query(
      `UPDATE ${SCHEMA}.task_nodes
          SET status = CASE WHEN $1 THEN 'done' ELSE 'open' END,
              stage_id = $4,
              prev_stage_id = $5,
              started_at = COALESCE(started_at, now()),
              done_at = CASE WHEN $1 THEN now() ELSE NULL END,
              done_by = CASE WHEN $1 THEN $2::int ELSE NULL END,
              updated_at = now()
        WHERE id=$3 RETURNING *`,
      [done, req.user.id, node.id, stageId, prevStageId]
    );
    await logActivity(node.id, req.user.id, done ? 'done' : 'reopened', null);
    // Ocorrência recorrente concluída → materializa a próxima (mês/ano seguinte) e
    // devolve o id dela para o detalhe TROCAR automaticamente p/ a nova (sem refresh).
    let rolledId = null;
    if (done && node.parent_id == null && node.source_node_id) {
      try { rolledId = (await rollNextOccurrence(req.companyId, node)) || null; } catch (e) { console.error('[tasks] roll (done):', e.message); }
    }
    res.json({ ...r.rows[0], rolled_node_id: rolledId });
  } catch (e) { respondError(res, e); }
});

// Gera subtarefas em massa a partir de clientes/contratos, com o MESMO passo-a-passo
// em cada uma (sub-subtarefas). Idempotente (pula alvos já existentes). Feito num
// template recorrente, as ocorrências clonam tudo por período.
router.post('/nodes/:id/expand', ...base, async (req, res) => {
  try {
    const parent = await getAccessibleNode(req, Number(req.params.id));
    await ensurePerm(req, parent.is_template ? 'tasks.routine.create' : 'tasks.task.create', 'tasks.task.create');
    const clientIds = [...new Set((Array.isArray(req.body?.client_ids) ? req.body.client_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const granularity = req.body?.granularity === 'contract' ? 'contract' : 'client';
    const steps = (Array.isArray(req.body?.steps) ? req.body.steps : []).map((s) => String(s || '').trim()).filter(Boolean);
    if (!clientIds.length) err('Selecione ao menos um cliente');
    const cl = await query(`SELECT id, name FROM ${SCHEMA}.clients WHERE company_id=$1 AND id = ANY($2::int[]) ORDER BY name`, [req.companyId, clientIds]);
    if (!cl.rows.length) err('Nenhum cliente válido');

    // Monta os alvos (título + vínculo) conforme a granularidade.
    const targets = [];
    if (granularity === 'client') {
      for (const c of cl.rows) targets.push({ title: c.name, client_id: c.id, contract_id: null });
    } else {
      const cons = await query(
        `SELECT id, client_id, description FROM ${SCHEMA}.contracts WHERE company_id=$1 AND client_id = ANY($2::int[]) ORDER BY client_id, id`,
        [req.companyId, cl.rows.map((c) => c.id)]
      );
      const nameById = new Map(cl.rows.map((c) => [c.id, c.name]));
      for (const con of cons.rows) targets.push({ title: `${nameById.get(con.client_id) || 'Cliente'} — ${con.description || ('Contrato #' + con.id)}`, client_id: con.client_id, contract_id: con.id });
      if (!targets.length) err('Os clientes selecionados não têm contratos cadastrados');
    }

    // Alvos já existentes sob este pai (por cliente sem contrato, ou por contrato).
    const ex = await query(`SELECT client_id, contract_id FROM ${SCHEMA}.task_nodes WHERE parent_id=$1 AND deleted_at IS NULL`, [parent.id]);
    const hasClient = new Set(ex.rows.filter((r) => r.contract_id == null && r.client_id != null).map((r) => r.client_id));
    const hasContract = new Set(ex.rows.filter((r) => r.contract_id != null).map((r) => r.contract_id));

    let createdTargets = 0; let createdSteps = 0;
    await query('BEGIN');
    try {
      let pos = (await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_nodes WHERE company_id=$1 AND parent_id=$2`, [req.companyId, parent.id])).rows[0].p;
      // Com passos, o nó por cliente/contrato é só um TÍTULO (agrupador): o check fica
      // nos passos. Sem passos, ele mesmo é checável (marca-se o cliente como feito).
      const childIsHeading = steps.length > 0;
      for (const t of targets) {
        if (t.contract_id ? hasContract.has(t.contract_id) : hasClient.has(t.client_id)) continue;
        const child = await query(
          `INSERT INTO ${SCHEMA}.task_nodes (company_id, group_id, parent_id, stage_id, kind, title, assignee_id, priority, is_template, client_id, contract_id, position, created_by, is_heading)
           VALUES ($1,$2,$3,$4,'fixa',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [req.companyId, parent.group_id, parent.id, parent.stage_id, t.title, parent.assignee_id, parent.priority, parent.is_template, t.client_id, t.contract_id, pos++, req.user.id, childIsHeading]
        );
        const childId = child.rows[0].id; createdTargets++;
        let sp = 0;
        for (const step of steps) {
          await query(
            `INSERT INTO ${SCHEMA}.task_nodes (company_id, group_id, parent_id, stage_id, kind, title, assignee_id, priority, is_template, client_id, contract_id, position, created_by)
             VALUES ($1,$2,$3,$4,'fixa',$5,$6,$7,$8,$9,$10,$11,$12)`,
            [req.companyId, parent.group_id, childId, parent.stage_id, step, parent.assignee_id, parent.priority, parent.is_template, t.client_id, t.contract_id, sp++, req.user.id]
          );
          createdSteps++;
        }
      }
      await query('COMMIT');
    } catch (e) { await query('ROLLBACK').catch(() => {}); throw e; }
    // Gerou por cliente/contrato numa OCORRÊNCIA recorrente → espelha no modelo.
    await syncTemplateFromOccurrence(req.companyId, parent.id);
    res.json({ ok: true, createdTargets, createdSteps });
  } catch (e) { respondError(res, e); }
});

// ===================== MODELOS DE CHECKLIST =====================
router.get('/checklists', ...view, async (req, res) => {
  try {
    const r = await query(`SELECT id, name, steps FROM ${SCHEMA}.task_checklists WHERE company_id=$1 ORDER BY name`, [req.companyId]);
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

router.post('/checklists', ...checklistManage, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 1) err('Informe o nome do checklist');
    const steps = (Array.isArray(req.body?.steps) ? req.body.steps : []).map((s) => String(s || '').trim()).filter(Boolean);
    const r = await query(`INSERT INTO ${SCHEMA}.task_checklists (company_id, name, steps) VALUES ($1,$2,$3) RETURNING id, name, steps`, [req.companyId, name, steps]);
    res.status(201).json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.put('/checklists/:id', ...checklistManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cur = await query(`SELECT * FROM ${SCHEMA}.task_checklists WHERE id=$1 AND company_id=$2`, [id, req.companyId]);
    if (!cur.rows[0]) err('Checklist não encontrado', 404);
    const name = req.body?.name != null ? String(req.body.name).trim() : cur.rows[0].name;
    if (name.length < 1) err('Nome inválido');
    const steps = req.body?.steps !== undefined
      ? (Array.isArray(req.body.steps) ? req.body.steps : []).map((s) => String(s || '').trim()).filter(Boolean)
      : cur.rows[0].steps;
    const r = await query(`UPDATE ${SCHEMA}.task_checklists SET name=$1, steps=$2, updated_at=now() WHERE id=$3 RETURNING id, name, steps`, [name, steps, id]);
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.delete('/checklists/:id', ...checklistManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cur = await query(`SELECT id FROM ${SCHEMA}.task_checklists WHERE id=$1 AND company_id=$2`, [id, req.companyId]);
    if (!cur.rows[0]) err('Checklist não encontrado', 404);
    await query(`DELETE FROM ${SCHEMA}.task_checklists WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// Aplica um checklist como subtarefas diretas do nó (idempotente por título). Herda
// cliente/contrato/responsável do pai (útil p/ tarefa avulsa que segue um modelo).
router.post('/nodes/:id/apply-checklist', ...base, async (req, res) => {
  try {
    const parent = await getAccessibleNode(req, Number(req.params.id));
    await ensurePerm(req, parent.is_template ? 'tasks.routine.create' : 'tasks.task.create', 'tasks.task.create');
    const clId = Number(req.body?.checklist_id);
    const cl = await query(`SELECT steps FROM ${SCHEMA}.task_checklists WHERE id=$1 AND company_id=$2`, [clId, req.companyId]);
    if (!cl.rows[0]) err('Checklist não encontrado', 404);
    const steps = cl.rows[0].steps || [];
    const ex = await query(`SELECT LOWER(title) AS t FROM ${SCHEMA}.task_nodes WHERE parent_id=$1 AND deleted_at IS NULL`, [parent.id]);
    const has = new Set(ex.rows.map((r) => r.t));
    let created = 0;
    await query('BEGIN');
    try {
      let pos = (await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_nodes WHERE company_id=$1 AND parent_id=$2`, [req.companyId, parent.id])).rows[0].p;
      for (const step of steps) {
        if (has.has(String(step).toLowerCase())) continue;
        await query(
          `INSERT INTO ${SCHEMA}.task_nodes (company_id, group_id, parent_id, stage_id, kind, title, assignee_id, priority, is_template, client_id, contract_id, position, created_by)
           VALUES ($1,$2,$3,$4,'fixa',$5,$6,$7,$8,$9,$10,$11,$12)`,
          [req.companyId, parent.group_id, parent.id, parent.stage_id, step, parent.assignee_id, parent.priority, parent.is_template, parent.client_id, parent.contract_id, pos++, req.user.id]
        );
        created++;
      }
      await query('COMMIT');
    } catch (e) { await query('ROLLBACK').catch(() => {}); throw e; }
    // Aplicou checklist numa OCORRÊNCIA recorrente → espelha no modelo.
    await syncTemplateFromOccurrence(req.companyId, parent.id);
    res.json({ ok: true, created });
  } catch (e) { respondError(res, e); }
});

// ===================== COMENTÁRIOS (discussão) =====================
router.post('/nodes/:id/comments', ...view, async (req, res) => {
  try {
    const node = await getAccessibleNode(req, Number(req.params.id));
    const body = String(req.body?.body || '').trim();
    if (body.length < 1) err('Comentário vazio');
    const r = await query(
      `INSERT INTO ${SCHEMA}.task_comments (node_id, user_id, body) VALUES ($1,$2,$3) RETURNING id, body, created_at, user_id`,
      [node.id, req.user.id, body]
    );
    const commentId = r.rows[0].id;
    // Menções: valida que são usuários da empresa e grava o vínculo (concede acesso à tarefa).
    const mentionIds = Array.isArray(req.body?.mention_ids)
      ? [...new Set(req.body.mention_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
    let validMentions = [];
    if (mentionIds.length) {
      const vm = await query(
        `SELECT u.id, COALESCE(NULLIF(u.name,''), u.email) AS name FROM ${SCHEMA}.users u
           JOIN ${SCHEMA}.user_companies uc ON uc.user_id=u.id
          WHERE uc.company_id=$1 AND u.id = ANY($2::int[])`,
        [req.companyId, mentionIds]
      );
      validMentions = vm.rows;
      for (const m of validMentions) {
        await query(`INSERT INTO ${SCHEMA}.task_comment_mentions (comment_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [commentId, m.id]);
      }
    }
    const mentionedSet = new Set(validMentions.map((m) => Number(m.id)));
    // Notifica cada mencionado (≠ autor): deep-link abre a tarefa e rola até o comentário.
    for (const m of validMentions) {
      if (Number(m.id) === Number(req.user.id)) continue;
      await createNotification({
        companyId: req.companyId, userId: m.id, type: 'task_mention',
        title: `Você foi mencionado em: ${node.title}`, body: body.slice(0, 140),
        refType: 'task_node', refId: node.id, link: `/tasks?open=${node.id}&comment=${commentId}`,
        dedupKey: `task-mention:${commentId}:${m.id}`,
      }).catch(() => {});
    }
    // Responsável recebe aviso de comentário, exceto se for o autor ou já mencionado.
    if (node.assignee_id && Number(node.assignee_id) !== Number(req.user.id) && !mentionedSet.has(Number(node.assignee_id))) {
      await createNotification({
        companyId: req.companyId, userId: node.assignee_id, type: 'task_comment',
        title: `Novo comentário em: ${node.title}`, body: body.slice(0, 140),
        refType: 'task_node', refId: node.id, link: `/tasks?open=${node.id}&comment=${commentId}`, dedupKey: `task-comment:${commentId}`,
      }).catch(() => {});
    }
    const name = (await query(`SELECT COALESCE(NULLIF(name,''), email) AS n FROM ${SCHEMA}.users WHERE id=$1`, [req.user.id])).rows[0]?.n || null;
    res.status(201).json({ ...r.rows[0], user_name: name, mentions: validMentions.map((m) => ({ user_id: m.id, name: m.name })) });
  } catch (e) { respondError(res, e); }
});

// Excluir comentário: o autor sempre pode; outros precisam de tasks.task.edit.
router.delete('/comments/:id', ...view, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const c = await query(
      `SELECT c.id, c.user_id FROM ${SCHEMA}.task_comments c
         JOIN ${SCHEMA}.task_nodes n ON n.id=c.node_id
        WHERE c.id=$1 AND n.company_id=$2`,
      [id, req.companyId]
    );
    if (!c.rows[0]) err('Comentário não encontrado', 404);
    const isAuthor = Number(c.rows[0].user_id) === Number(req.user.id);
    if (!isAuthor && req.user.role !== 'master') {
      const perms = await getEffectivePermissions(req.user, req.companyId);
      if (!perms.includes('tasks.task.edit')) err('Sem permissão para excluir este comentário', 403);
    }
    await query(`DELETE FROM ${SCHEMA}.task_comments WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// ===================== ETIQUETAS (labels) =====================
router.get('/labels', ...view, async (req, res) => {
  try {
    const r = await query(`SELECT id, name, color FROM ${SCHEMA}.task_labels WHERE company_id=$1 ORDER BY name`, [req.companyId]);
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

router.post('/labels', ...labelCreate, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 1) err('Informe o nome da etiqueta');
    const color = /^#[0-9a-fA-F]{6}$/.test(String(req.body?.color || '')) ? req.body.color : '#64748b';
    const r = await query(`INSERT INTO ${SCHEMA}.task_labels (company_id, name, color) VALUES ($1,$2,$3) RETURNING id, name, color`, [req.companyId, name, color]);
    res.status(201).json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.put('/labels/:id', ...labelEdit, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cur = await query(`SELECT * FROM ${SCHEMA}.task_labels WHERE id=$1 AND company_id=$2`, [id, req.companyId]);
    if (!cur.rows[0]) err('Etiqueta não encontrada', 404);
    const name = req.body?.name != null ? String(req.body.name).trim() : cur.rows[0].name;
    if (name.length < 1) err('Nome inválido');
    const color = /^#[0-9a-fA-F]{6}$/.test(String(req.body?.color || '')) ? req.body.color : cur.rows[0].color;
    const r = await query(`UPDATE ${SCHEMA}.task_labels SET name=$1, color=$2 WHERE id=$3 RETURNING id, name, color`, [name, color, id]);
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.delete('/labels/:id', ...labelDelete, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cur = await query(`SELECT id FROM ${SCHEMA}.task_labels WHERE id=$1 AND company_id=$2`, [id, req.companyId]);
    if (!cur.rows[0]) err('Etiqueta não encontrada', 404);
    await query(`DELETE FROM ${SCHEMA}.task_labels WHERE id=$1`, [id]); // vínculos caem por CASCADE
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// Define as etiquetas de uma tarefa. Basta tasks.view (etiquetar é colaborativo).
router.put('/nodes/:id/labels', ...view, async (req, res) => {
  try {
    const node = await getAccessibleNode(req, Number(req.params.id));
    await setNodeLabels(node.id, req.companyId, req.body?.label_ids);
    const r = await query(`SELECT l.id, l.name, l.color FROM ${SCHEMA}.task_node_labels nl JOIN ${SCHEMA}.task_labels l ON l.id=nl.label_id WHERE nl.node_id=$1 ORDER BY l.name`, [node.id]);
    res.json({ labels: r.rows });
  } catch (e) { respondError(res, e); }
});

// ===================== ROTINAS RECORRENTES (templates) =====================
// Definições recorrentes (ocultas do board). Cada uma gera ocorrências por período.
router.get('/templates', ...view, async (req, res) => {
  try {
    // Mesma visibilidade do board: comum só vê rotinas suas/atribuídas/mencionadas.
    const gestor = await isGestorReq(req);
    const uid = req.user.id;
    const r = await query(
      `WITH RECURSIVE ttree AS (
         SELECT r.id AS root_id, r.id, r.assignee_id, r.created_by
           FROM ${SCHEMA}.task_nodes r WHERE r.company_id=$1 AND r.is_template=true AND r.recurrence<>'none' AND r.parent_id IS NULL AND r.deleted_at IS NULL
         UNION ALL
         SELECT t.root_id, c.id, c.assignee_id, c.created_by
           FROM ${SCHEMA}.task_nodes c JOIN ttree t ON c.parent_id=t.id AND c.deleted_at IS NULL
       ),
       mn AS (
         SELECT DISTINCT cm.node_id FROM ${SCHEMA}.task_comments cm
           JOIN ${SCHEMA}.task_comment_mentions m ON m.comment_id=cm.id WHERE m.user_id=$2
       ),
       vis AS (
         SELECT t.root_id, bool_or(t.assignee_id=$2 OR t.created_by=$2 OR mnj.node_id IS NOT NULL) AS ok
           FROM ttree t LEFT JOIN mn mnj ON mnj.node_id=t.id GROUP BY t.root_id
       )
       SELECT n.id, n.title, n.description, n.priority, n.recurrence, n.recurrence_day, n.recurrence_month, n.recurrence_paused,
              n.group_id, g.name AS group_name, ${AUTHOR},
              (SELECT COUNT(*) FROM ${SCHEMA}.task_nodes o WHERE o.source_node_id=n.id AND o.parent_id IS NULL AND o.deleted_at IS NULL)::int AS occurrences,
              (SELECT MAX(o.due_date) FROM ${SCHEMA}.task_nodes o WHERE o.source_node_id=n.id AND o.parent_id IS NULL AND o.deleted_at IS NULL) AS last_due
         FROM ${SCHEMA}.task_nodes n
         JOIN vis v ON v.root_id=n.id
         LEFT JOIN ${SCHEMA}.task_groups g ON g.id=n.group_id
        WHERE n.company_id=$1 AND n.is_template=true AND n.recurrence<>'none' AND n.parent_id IS NULL AND n.deleted_at IS NULL
          AND ($3::boolean OR v.ok)
        ORDER BY n.title`,
      [req.companyId, uid, gestor]
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

// Gera as ocorrências pendentes de todas as rotinas recorrentes (disparo manual).
router.post('/generate', ...base, async (req, res) => {
  try {
    await ensurePerm(req, 'tasks.routine.create', 'tasks.routine.edit');
    const created = await generateOccurrences(req.companyId, new Date());
    res.json({ ok: true, created });
  } catch (e) { respondError(res, e); }
});

// ===================== MINHAS TAREFAS =====================
// Só as tarefas em que sou o responsável, abertas, agrupadas por prazo (fuso local
// via CURRENT_DATE): atrasada / vence hoje / próximos 7 dias / sem prazo.
router.get('/my', ...view, async (req, res) => {
  try {
    const r = await query(
      `SELECT n.id, n.title, n.priority, n.due_date, n.group_id, g.name AS group_name,
              (n.due_date IS NOT NULL AND n.due_date < CURRENT_DATE) AS overdue,
              (n.due_date = CURRENT_DATE) AS today,
              (n.due_date IS NOT NULL AND n.due_date > CURRENT_DATE AND n.due_date <= CURRENT_DATE + 7) AS soon
         FROM ${SCHEMA}.task_nodes n
         LEFT JOIN ${SCHEMA}.task_groups g ON g.id=n.group_id
        WHERE n.company_id=$1 AND n.assignee_id=$2 AND n.status='open' AND n.is_template=false AND n.is_heading=false AND n.deleted_at IS NULL
        ORDER BY n.due_date NULLS LAST, n.id`,
      [req.companyId, req.user.id]
    );
    const atrasada = [], hoje = [], prox7 = [], semPrazo = [];
    for (const t of r.rows) {
      if (t.overdue) atrasada.push(t);
      else if (t.today) hoje.push(t);
      else if (t.soon) prox7.push(t);
      else if (!t.due_date) semPrazo.push(t);
      // com prazo além de 7 dias fica de fora do alerta
    }
    res.json({
      atrasada, hoje, prox7, semPrazo,
      counts: { atrasada: atrasada.length, hoje: hoje.length, prox7: prox7.length, total: atrasada.length + hoje.length + prox7.length },
    });
  } catch (e) { respondError(res, e); }
});

// ===================== PRODUTIVIDADE (Gestor) =====================
// Por usuário: concluídas, % no prazo, abertas, atrasadas, tempo médio de entrega.
router.get('/productivity', ...gestor, async (req, res) => {
  try {
    const r = await query(
      `SELECT u.id AS user_id, COALESCE(NULLIF(u.name,''), u.email) AS name,
              COUNT(*) FILTER (WHERE n.status='done')::int AS done,
              COUNT(*) FILTER (WHERE n.status='open')::int AS open,
              COUNT(*) FILTER (WHERE n.status='open' AND n.due_date IS NOT NULL AND n.due_date < CURRENT_DATE)::int AS overdue,
              COUNT(*) FILTER (WHERE n.status='done' AND n.due_date IS NOT NULL)::int AS done_with_due,
              COUNT(*) FILTER (WHERE n.status='done' AND n.due_date IS NOT NULL AND n.done_at::date <= n.due_date)::int AS on_time,
              AVG(EXTRACT(EPOCH FROM (n.done_at - COALESCE(n.started_at, n.created_at)))/86400.0)
                FILTER (WHERE n.status='done' AND n.done_at IS NOT NULL) AS avg_days
         FROM ${SCHEMA}.task_nodes n
         JOIN ${SCHEMA}.users u ON u.id = n.assignee_id
        WHERE n.company_id=$1 AND n.is_template=false AND n.is_heading=false AND n.deleted_at IS NULL
        GROUP BY u.id, name
        ORDER BY done DESC, name`,
      [req.companyId]
    );
    const items = r.rows.map((s) => ({
      userId: s.user_id, name: s.name, done: s.done, open: s.open, overdue: s.overdue,
      onTime: s.on_time, doneWithDue: s.done_with_due,
      onTimePct: s.done_with_due ? Number((s.on_time / s.done_with_due).toFixed(4)) : null,
      avgDays: s.avg_days == null ? null : Number(Number(s.avg_days).toFixed(1)),
    }));
    // Série semanal (últimas 12 semanas): concluídas, no prazo e atrasadas por semana.
    const series = await query(
      `SELECT to_char(date_trunc('week', n.done_at), 'YYYY-MM-DD') AS wk,
              COUNT(*)::int AS done,
              COUNT(*) FILTER (WHERE n.due_date IS NOT NULL AND n.done_at::date <= n.due_date)::int AS on_time,
              COUNT(*) FILTER (WHERE n.due_date IS NOT NULL AND n.done_at::date > n.due_date)::int AS late
         FROM ${SCHEMA}.task_nodes n
        WHERE n.company_id=$1 AND n.is_template=false AND n.deleted_at IS NULL AND n.status='done' AND n.done_at >= (CURRENT_DATE - INTERVAL '12 weeks')
        GROUP BY 1 ORDER BY 1`,
      [req.companyId]
    );
    // Distribuição atual por status (para o gráfico de pizza).
    const dist = await query(
      `SELECT COUNT(*) FILTER (WHERE status='open')::int AS open,
              COUNT(*) FILTER (WHERE status='done')::int AS done,
              COUNT(*) FILTER (WHERE status='open' AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS overdue
         FROM ${SCHEMA}.task_nodes WHERE company_id=$1 AND is_template=false AND is_heading=false AND deleted_at IS NULL`,
      [req.companyId]
    );
    res.json({ items, series: series.rows, distribution: dist.rows[0] || { open: 0, done: 0, overdue: 0 } });
  } catch (e) { respondError(res, e); }
});

// Usuários da empresa (para atribuir responsável). Requer poder atribuir a outros.
router.get('/company-users', ...P('tasks.task.assign'), async (req, res) => {
  try {
    const r = await query(
      `SELECT u.id, COALESCE(NULLIF(u.name,''), u.email) AS name, u.email
         FROM ${SCHEMA}.users u JOIN ${SCHEMA}.user_companies uc ON uc.user_id = u.id
        WHERE uc.company_id = $1 AND u.role <> 'master'
        ORDER BY name`,
      [req.companyId]
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

// Usuários mencionáveis = quem tem acesso ao quadro (tasks.view efetivo) na empresa.
// Perm view (qualquer um do quadro pode mencionar). Replica perfil ∪ grants − revokes.
router.get('/mentionable-users', ...view, async (req, res) => {
  try {
    const r = await query(
      `SELECT u.id, COALESCE(NULLIF(u.name,''), u.email) AS name, u.email
         FROM ${SCHEMA}.users u JOIN ${SCHEMA}.user_companies uc ON uc.user_id = u.id
        WHERE uc.company_id = $1 AND u.role <> 'master'
          AND (
            EXISTS (SELECT 1 FROM ${SCHEMA}.profile_permissions pp WHERE pp.profile_id = u.profile_id AND pp.permission_key = 'tasks.view')
            OR EXISTS (SELECT 1 FROM ${SCHEMA}.user_permission_overrides o WHERE o.user_id = u.id AND o.permission_key = 'tasks.view' AND o.allowed = true)
          )
          AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.user_permission_overrides o WHERE o.user_id = u.id AND o.permission_key = 'tasks.view' AND o.allowed = false)
        ORDER BY name`,
      [req.companyId]
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

module.exports = router;
