const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { requirePermission } = require('../services/permissions');
const { respondError } = require('../utils/http-error');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');
const { createNotification } = require('../services/notifications');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

const pad = (n) => String(n).padStart(2, '0');
const err = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };

// 1º dia do mês a partir de 'AAAA-MM' (ou de uma Date). Base da competência.
function firstOfMonth(input) {
  if (input instanceof Date) return `${input.getFullYear()}-${pad(input.getMonth() + 1)}-01`;
  const m = /^(\d{4})-(\d{2})$/.exec(String(input || '').trim());
  if (m) return `${m[1]}-${m[2]}-01`;
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}
const isAdmin = (user) => user?.role === 'master' || user?.role === 'admin';

// Papel do usuário na equipe: admin/master contam como 'manager'. Retorna
// 'manager' | 'member' | null (sem acesso).
async function roleInTeam(companyId, teamId, user) {
  const t = await query(`SELECT id FROM ${SCHEMA}.task_teams WHERE id=$1 AND company_id=$2`, [teamId, companyId]);
  if (!t.rows[0]) return { exists: false, role: null };
  if (isAdmin(user)) return { exists: true, role: 'manager' };
  const m = await query(`SELECT role FROM ${SCHEMA}.task_team_members WHERE team_id=$1 AND user_id=$2`, [teamId, user.id]);
  return { exists: true, role: m.rows[0]?.role || null };
}
// Garante acesso à equipe; { manage:true } exige papel de gerente.
async function assertTeam(req, teamId, { manage = false } = {}) {
  const { exists, role } = await roleInTeam(req.companyId, teamId, req.user);
  if (!exists) err('Equipe não encontrada', 404);
  if (!role) err('Você não participa desta equipe', 403);
  if (manage && role !== 'manager') err('Apenas o gerente da equipe pode fazer isso', 403);
  return role;
}
async function cardTeam(companyId, cardId) {
  const r = await query(`SELECT * FROM ${SCHEMA}.task_cards WHERE id=$1 AND company_id=$2`, [cardId, companyId]);
  if (!r.rows[0]) err('Cartão não encontrado', 404);
  return r.rows[0];
}
// Membro comum só acessa cartões atribuídos a ele; gerente/admin acessam todos.
async function assertCardAccess(req, card, { manage = false } = {}) {
  const role = await assertTeam(req, card.team_id, { manage });
  if (role === 'member' && Number(card.assignee_id) !== Number(req.user.id)) err('Esta tarefa não está atribuída a você', 403);
  return role;
}
async function logActivity(cardId, userId, action, { fromCol = null, toCol = null, detail = null } = {}) {
  await query(
    `INSERT INTO ${SCHEMA}.task_activity (card_id, user_id, action, from_column_id, to_column_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [cardId, userId, action, fromCol, toCol, detail]
  );
}

// Traz para o mês vigente os cartões abertos de competências anteriores (rolagem).
// Mantém o due_date original (SLA honesto) e registra a rolagem no histórico.
async function rollForward(companyId, teamId, now = new Date()) {
  const curFirst = firstOfMonth(now);
  const past = await query(
    `SELECT id, competence FROM ${SCHEMA}.task_cards
      WHERE company_id=$1 AND team_id=$2 AND status='open' AND competence < $3::date`,
    [companyId, teamId, curFirst]
  );
  for (const c of past.rows) {
    const d = ensureDateOnly(c.competence);
    const diff = (now.getFullYear() * 12 + now.getMonth()) - (d.getFullYear() * 12 + d.getMonth());
    if (diff <= 0) continue;
    await query(
      `UPDATE ${SCHEMA}.task_cards SET competence=$1::date, months_rolled = months_rolled + $2, updated_at=now() WHERE id=$3`,
      [curFirst, diff, c.id]
    );
    await logActivity(c.id, null, 'rolled', { detail: `Rolou ${diff} mês(es) para ${curFirst.slice(0, 7)}` });
  }
}

// Acesso ao módulo = permissão tasks.view. A GESTÃO é decidida pelo PAPEL na
// equipe (gerente) ou por ser admin — não por uma permissão global — para que o
// gerente de cada equipe possa gerenciar a sua sem depender de tasks.manage.
const view = [requireAuth, companyScope(true), requirePermission('tasks.view')];
const manage = view; // o gate real de gestão é feito por assertTeam(manage)/isAdmin nos handlers

// Modelos são de empresa (não de equipe): exige ser admin ou gerente de ALGUMA equipe.
async function requireAnyManager(req, res, next) {
  try {
    if (isAdmin(req.user)) return next();
    const r = await query(
      `SELECT 1 FROM ${SCHEMA}.task_team_members m JOIN ${SCHEMA}.task_teams t ON t.id = m.team_id
        WHERE t.company_id = $1 AND m.user_id = $2 AND m.role = 'manager' LIMIT 1`,
      [req.companyId, req.user.id]
    );
    if (!r.rows[0]) return res.status(403).json({ error: 'Apenas gerentes ou administrador' });
    next();
  } catch (e) { respondError(res, e); }
}
const manageModels = [...view, requireAnyManager];

// Colunas padrão de um quadro novo (o gerente pode editar depois — colunas livres).
const DEFAULT_COLUMNS = [
  { name: 'A fazer', is_done_col: false },
  { name: 'Em andamento', is_done_col: false },
  { name: 'Concluído', is_done_col: true },
];

// ===================== EQUIPES =====================
// Equipes que o usuário enxerga: admin vê todas da empresa; demais, as suas.
router.get('/teams', ...view, async (req, res) => {
  try {
    const params = [req.companyId, req.user.id];
    const scope = isAdmin(req.user) ? '' : `AND t.id IN (SELECT team_id FROM ${SCHEMA}.task_team_members WHERE user_id=$2)`;
    const r = await query(
      `SELECT t.id, t.name, t.created_at,
              (SELECT COUNT(*) FROM ${SCHEMA}.task_team_members m WHERE m.team_id=t.id)::int AS members,
              (SELECT role FROM ${SCHEMA}.task_team_members m WHERE m.team_id=t.id AND m.user_id=$2) AS my_role
         FROM ${SCHEMA}.task_teams t
        WHERE t.company_id=$1 ${scope}
        ORDER BY t.name`,
      params
    );
    const rows = r.rows.map((t) => ({ ...t, my_role: isAdmin(req.user) ? 'manager' : t.my_role }));
    res.json({ items: rows, isAdmin: isAdmin(req.user) });
  } catch (e) { respondError(res, e); }
});

// Cria equipe (somente Admin) e semeia colunas padrão. Opcional: gerente inicial.
router.post('/teams', ...manage, async (req, res) => {
  try {
    if (!isAdmin(req.user)) err('Apenas o administrador pode criar equipes', 403);
    const name = String(req.body?.name || '').trim();
    if (name.length < 2) err('Informe o nome da equipe');
    const managerId = Number(req.body?.manager_id) || null;
    const t = await query(
      `INSERT INTO ${SCHEMA}.task_teams (company_id, name, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [req.companyId, name, req.user.id]
    );
    const team = t.rows[0];
    for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
      await query(
        `INSERT INTO ${SCHEMA}.task_columns (company_id, team_id, name, position, is_done_col) VALUES ($1,$2,$3,$4,$5)`,
        [req.companyId, team.id, DEFAULT_COLUMNS[i].name, i, DEFAULT_COLUMNS[i].is_done_col]
      );
    }
    if (managerId) {
      await query(
        `INSERT INTO ${SCHEMA}.task_team_members (team_id, user_id, role) VALUES ($1,$2,'manager')
         ON CONFLICT (team_id, user_id) DO UPDATE SET role='manager'`,
        [team.id, managerId]
      );
    }
    res.status(201).json(team);
  } catch (e) { respondError(res, e); }
});

// Usuários da empresa (para o Admin escolher quem entra na equipe).
router.get('/company-users', ...manage, async (req, res) => {
  try {
    if (!isAdmin(req.user)) err('Apenas o administrador', 403);
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

router.get('/teams/:id/members', ...view, async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    await assertTeam(req, teamId);
    const r = await query(
      `SELECT m.user_id, m.role, COALESCE(NULLIF(u.name,''), u.email) AS name, u.email
         FROM ${SCHEMA}.task_team_members m JOIN ${SCHEMA}.users u ON u.id=m.user_id
        WHERE m.team_id=$1 ORDER BY (m.role='manager') DESC, name`,
      [teamId]
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

// Add/atualiza membro (somente Admin).
router.post('/teams/:id/members', ...manage, async (req, res) => {
  try {
    if (!isAdmin(req.user)) err('Apenas o administrador gerencia membros', 403);
    const teamId = Number(req.params.id);
    await assertTeam(req, teamId, { manage: true });
    const userId = Number(req.body?.user_id);
    if (!Number.isInteger(userId)) err('Usuário inválido');
    const role = req.body?.role === 'manager' ? 'manager' : 'member';
    // Garante que o usuário pertence à empresa.
    const belongs = await query(`SELECT 1 FROM ${SCHEMA}.user_companies WHERE user_id=$1 AND company_id=$2`, [userId, req.companyId]);
    if (!belongs.rows[0]) err('Usuário não pertence a esta empresa');
    await query(
      `INSERT INTO ${SCHEMA}.task_team_members (team_id, user_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (team_id, user_id) DO UPDATE SET role=EXCLUDED.role`,
      [teamId, userId, role]
    );
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

router.delete('/teams/:id/members/:userId', ...manage, async (req, res) => {
  try {
    if (!isAdmin(req.user)) err('Apenas o administrador gerencia membros', 403);
    const teamId = Number(req.params.id);
    await assertTeam(req, teamId, { manage: true });
    await query(`DELETE FROM ${SCHEMA}.task_team_members WHERE team_id=$1 AND user_id=$2`, [teamId, Number(req.params.userId)]);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// Lista de modelos para seleção (ex.: no cadastro de contrato). Só id/nome/equipe,
// sem exigir a permissão de gestão — apenas modelos que geram (têm equipe).
router.get('/models-select', requireAuth, companyScope(true), async (req, res) => {
  try {
    const r = await query(
      `SELECT m.id, m.name, t.name AS team_name
         FROM ${SCHEMA}.task_models m JOIN ${SCHEMA}.task_teams t ON t.id=m.team_id
        WHERE m.company_id=$1 ORDER BY m.name`,
      [req.companyId]
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

// ===================== COLUNAS =====================
router.get('/teams/:id/columns', ...view, async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    await assertTeam(req, teamId);
    const r = await query(`SELECT id, name, position, is_done_col FROM ${SCHEMA}.task_columns WHERE team_id=$1 ORDER BY position, id`, [teamId]);
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

router.post('/teams/:id/columns', ...manage, async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    await assertTeam(req, teamId, { manage: true });
    const name = String(req.body?.name || '').trim();
    if (name.length < 1) err('Informe o nome da coluna');
    const pos = await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_columns WHERE team_id=$1`, [teamId]);
    const r = await query(
      `INSERT INTO ${SCHEMA}.task_columns (company_id, team_id, name, position, is_done_col) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.companyId, teamId, name, pos.rows[0].p, Boolean(req.body?.is_done_col)]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.put('/columns/:id', ...manage, async (req, res) => {
  try {
    const colId = Number(req.params.id);
    const col = await query(`SELECT * FROM ${SCHEMA}.task_columns WHERE id=$1 AND company_id=$2`, [colId, req.companyId]);
    if (!col.rows[0]) err('Coluna não encontrada', 404);
    await assertTeam(req, col.rows[0].team_id, { manage: true });
    const name = req.body?.name != null ? String(req.body.name).trim() : col.rows[0].name;
    const position = Number.isInteger(Number(req.body?.position)) ? Number(req.body.position) : col.rows[0].position;
    const isDone = req.body?.is_done_col != null ? Boolean(req.body.is_done_col) : col.rows[0].is_done_col;
    const r = await query(
      `UPDATE ${SCHEMA}.task_columns SET name=$1, position=$2, is_done_col=$3 WHERE id=$4 RETURNING *`,
      [name, position, isDone, colId]
    );
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.delete('/columns/:id', ...manage, async (req, res) => {
  try {
    const colId = Number(req.params.id);
    const col = await query(`SELECT * FROM ${SCHEMA}.task_columns WHERE id=$1 AND company_id=$2`, [colId, req.companyId]);
    if (!col.rows[0]) err('Coluna não encontrada', 404);
    await assertTeam(req, col.rows[0].team_id, { manage: true });
    const has = await query(`SELECT 1 FROM ${SCHEMA}.task_cards WHERE column_id=$1 LIMIT 1`, [colId]);
    if (has.rows[0]) err('Mova os cartões desta coluna antes de excluí-la');
    await query(`DELETE FROM ${SCHEMA}.task_columns WHERE id=$1`, [colId]);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// ===================== QUADRO (board do mês) =====================
router.get('/teams/:id/board', ...view, async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    const role = await assertTeam(req, teamId);
    const now = new Date();
    const curYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const ym = /^\d{4}-\d{2}$/.test(String(req.query.ym || '')) ? req.query.ym : curYm;
    // Só rola quando o mês pedido é o vigente (não mexe no passado).
    if (ym === curYm) { try { await rollForward(req.companyId, teamId, now); } catch (e) { console.error('[tasks] rollForward:', e.message); } }
    const comp = firstOfMonth(ym);

    const columns = await query(
      `SELECT id, name, position, is_done_col FROM ${SCHEMA}.task_columns WHERE team_id=$1 ORDER BY position, id`,
      [teamId]
    );
    // Membro comum vê apenas os cartões em que é o responsável; gerente/admin veem tudo.
    const params = [req.companyId, teamId, comp];
    let scope = '';
    if (role === 'member') { params.push(req.user.id); scope = `AND c.assignee_id = $4`; }
    const cards = await query(
      `SELECT c.*, COALESCE(NULLIF(u.name,''), u.email) AS assignee_name,
              (SELECT COUNT(*) FROM ${SCHEMA}.task_items i WHERE i.card_id=c.id)::int AS items_total,
              (SELECT COUNT(*) FROM ${SCHEMA}.task_items i WHERE i.card_id=c.id AND i.done)::int AS items_done,
              (SELECT COUNT(*) FROM ${SCHEMA}.task_items i WHERE i.card_id=c.id AND i.stage_column_id=c.column_id AND NOT i.done)::int AS stage_open
         FROM ${SCHEMA}.task_cards c
         LEFT JOIN ${SCHEMA}.users u ON u.id=c.assignee_id
        WHERE c.company_id=$1 AND c.team_id=$2 AND c.competence=$3::date AND c.status<>'archived' ${scope}
        ORDER BY c.position, c.id`,
      params
    );
    res.json({ ym, currentYm: curYm, role, columns: columns.rows, cards: cards.rows });
  } catch (e) { respondError(res, e); }
});

// Indicadores de SLA da equipe (todos os cartões): % no prazo, tempo médio de
// entrega, abertas atrasadas, sem responsável e total de meses rolados.
router.get('/teams/:id/stats', ...view, async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    const role = await assertTeam(req, teamId);
    // Membro comum vê os indicadores apenas dos cartões dele.
    const params = [req.companyId, teamId];
    let scope = '';
    if (role === 'member') { params.push(req.user.id); scope = 'AND assignee_id = $3'; }
    const r = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status='done')::int AS done,
         COUNT(*) FILTER (WHERE status='open')::int AS open,
         COUNT(*) FILTER (WHERE status='open' AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS open_overdue,
         COUNT(*) FILTER (WHERE status='open' AND assignee_id IS NULL)::int AS unassigned,
         COUNT(*) FILTER (WHERE status='done' AND due_date IS NOT NULL)::int AS done_with_due,
         COUNT(*) FILTER (WHERE status='done' AND due_date IS NOT NULL AND done_at::date <= due_date)::int AS on_time,
         COALESCE(SUM(months_rolled),0)::int AS months_rolled_total,
         AVG(EXTRACT(EPOCH FROM (done_at - COALESCE(started_at, created_at)))/86400.0)
           FILTER (WHERE status='done' AND done_at IS NOT NULL) AS avg_days
       FROM ${SCHEMA}.task_cards WHERE company_id=$1 AND team_id=$2 ${scope}`,
      params
    );
    const s = r.rows[0];
    res.json({
      done: s.done, open: s.open, openOverdue: s.open_overdue, unassigned: s.unassigned,
      doneWithDue: s.done_with_due, onTime: s.on_time,
      onTimePct: s.done_with_due ? Number((s.on_time / s.done_with_due).toFixed(4)) : null,
      avgDays: s.avg_days == null ? null : Number(Number(s.avg_days).toFixed(1)),
      monthsRolledTotal: s.months_rolled_total,
    });
  } catch (e) { respondError(res, e); }
});

// ===================== CARTÕES =====================
// Instancia itens de um modelo, mapeando a etapa (stage_name) para a coluna de
// mesmo nome na equipe (ou a coluna inicial, se não houver correspondência).
async function seedItemsFromModel(cardId, modelId, columns) {
  const items = await query(`SELECT stage_name, title, position FROM ${SCHEMA}.task_model_items WHERE model_id=$1 ORDER BY position, id`, [modelId]);
  const byName = new Map(columns.map((c) => [String(c.name).trim().toLowerCase(), c.id]));
  const firstCol = columns[0]?.id || null;
  for (const it of items.rows) {
    const stageCol = byName.get(String(it.stage_name).trim().toLowerCase()) || firstCol;
    await query(
      `INSERT INTO ${SCHEMA}.task_items (card_id, stage_column_id, title, position) VALUES ($1,$2,$3,$4)`,
      [cardId, stageCol, it.title, it.position]
    );
  }
}

router.post('/teams/:id/cards', ...manage, async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    await assertTeam(req, teamId, { manage: true });
    const title = String(req.body?.title || '').trim();
    if (title.length < 2) err('Informe o título da tarefa');
    const cols = await query(`SELECT id, name, position, is_done_col FROM ${SCHEMA}.task_columns WHERE team_id=$1 ORDER BY position, id`, [teamId]);
    if (!cols.rows.length) err('Crie ao menos uma coluna no quadro antes');
    const columnId = Number(req.body?.column_id) || cols.rows[0].id;
    if (cols.rows.find((c) => c.id === columnId)?.is_done_col) err('Não é possível criar tarefas na etapa final', 409);
    const comp = firstOfMonth(/^\d{4}-\d{2}$/.test(String(req.body?.ym || '')) ? req.body.ym : new Date());
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.due_date || '')) ? req.body.due_date : null;
    const assigneeId = Number(req.body?.assignee_id) || null;
    const modelId = Number(req.body?.model_id) || null;
    const description = req.body?.description ? String(req.body.description).trim() || null : null;
    const posr = await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_cards WHERE team_id=$1 AND column_id=$2 AND competence=$3::date`, [teamId, columnId, comp]);

    const r = await query(
      `INSERT INTO ${SCHEMA}.task_cards
         (company_id, team_id, column_id, title, description, assignee_id, due_date, competence, model_id, contract_id, position, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.companyId, teamId, columnId, title, description, assigneeId, dueDate, comp, modelId, Number(req.body?.contract_id) || null, posr.rows[0].p, req.user.id]
    );
    const card = r.rows[0];
    if (modelId) await seedItemsFromModel(card.id, modelId, cols.rows);
    await logActivity(card.id, req.user.id, 'created', { toCol: columnId });
    res.status(201).json(card);
  } catch (e) { respondError(res, e); }
});

router.get('/cards/:id', ...view, async (req, res) => {
  try {
    const card = await cardTeam(req.companyId, Number(req.params.id));
    await assertCardAccess(req, card);
    // Enriquece com o nome do responsável (a linha crua só tem assignee_id).
    if (card.assignee_id) {
      const u = await query(`SELECT COALESCE(NULLIF(name,''), email) AS n FROM ${SCHEMA}.users WHERE id=$1`, [card.assignee_id]);
      card.assignee_name = u.rows[0]?.n || null;
    } else {
      card.assignee_name = null;
    }
    const items = await query(
      `SELECT i.*, COALESCE(NULLIF(u.name,''), u.email) AS done_by_name
         FROM ${SCHEMA}.task_items i LEFT JOIN ${SCHEMA}.users u ON u.id=i.done_by
        WHERE i.card_id=$1 ORDER BY i.position, i.id`,
      [card.id]
    );
    const activity = await query(
      `SELECT a.*, COALESCE(NULLIF(u.name,''), u.email) AS user_name,
              cf.name AS from_name, ct.name AS to_name
         FROM ${SCHEMA}.task_activity a
         LEFT JOIN ${SCHEMA}.users u ON u.id=a.user_id
         LEFT JOIN ${SCHEMA}.task_columns cf ON cf.id=a.from_column_id
         LEFT JOIN ${SCHEMA}.task_columns ct ON ct.id=a.to_column_id
        WHERE a.card_id=$1 ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
      [card.id]
    );
    res.json({ card, items: items.rows, activity: activity.rows });
  } catch (e) { respondError(res, e); }
});

router.put('/cards/:id', ...manage, async (req, res) => {
  try {
    const card = await cardTeam(req.companyId, Number(req.params.id));
    await assertTeam(req, card.team_id, { manage: true });
    const title = req.body?.title != null ? String(req.body.title).trim() : card.title;
    if (title.length < 2) err('Título inválido');
    const description = req.body?.description !== undefined ? (String(req.body.description || '').trim() || null) : card.description;
    const assigneeId = req.body?.assignee_id !== undefined ? (Number(req.body.assignee_id) || null) : card.assignee_id;
    const dueDate = req.body?.due_date !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.due_date || '')) ? req.body.due_date : null) : card.due_date;
    const priority = req.body?.priority || card.priority;
    const r = await query(
      `UPDATE ${SCHEMA}.task_cards SET title=$1, description=$2, assignee_id=$3, due_date=$4, priority=$5, updated_at=now()
        WHERE id=$6 RETURNING *`,
      [title, description, assigneeId, dueDate, priority, card.id]
    );
    // Notifica quem RECEBEU a tarefa (responsável novo e diferente do anterior).
    if (assigneeId && Number(assigneeId) !== Number(card.assignee_id)) {
      await logActivity(card.id, req.user.id, 'assigned', { detail: 'responsável definido' });
      await createNotification({
        companyId: req.companyId, userId: assigneeId, type: 'task_assigned',
        title: `Você recebeu a tarefa: ${title}`, body: null,
        refType: 'task_card', refId: card.id, link: '/tasks',
        dedupKey: `task-assigned:${card.id}:${assigneeId}`,
      });
    } else {
      await logActivity(card.id, req.user.id, 'edited', {});
    }
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// Exclui a tarefa macro. Regra: só é possível excluir se NÃO houver micros
// pendentes (a fazer) e se o cartão NÃO estiver na etapa final (coluna de entrega).
router.delete('/cards/:id', ...manage, async (req, res) => {
  try {
    const card = await cardTeam(req.companyId, Number(req.params.id));
    await assertTeam(req, card.team_id, { manage: true });
    const col = await query(`SELECT is_done_col FROM ${SCHEMA}.task_columns WHERE id=$1`, [card.column_id]);
    if (col.rows[0]?.is_done_col) err('Não é possível excluir uma tarefa que está na etapa final', 409);
    const pend = await query(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.task_items WHERE card_id=$1 AND NOT done`, [card.id]);
    if (pend.rows[0].n > 0) err(`Conclua ou remova as ${pend.rows[0].n} micro-tarefa(s) pendente(s) antes de excluir`, 409);
    await query(`DELETE FROM ${SCHEMA}.task_cards WHERE id=$1`, [card.id]);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// Mover cartão de coluna. Portão: para AVANÇAR (coluna de posição maior) todas as
// micros da coluna atual precisam estar fechadas. Membro pode mover.
router.post('/cards/:id/move', ...view, async (req, res) => {
  try {
    const card = await cardTeam(req.companyId, Number(req.params.id));
    await assertCardAccess(req, card);
    const toColumnId = Number(req.body?.to_column_id);
    const cols = await query(`SELECT id, position, is_done_col FROM ${SCHEMA}.task_columns WHERE team_id=$1`, [card.team_id]);
    const from = cols.rows.find((c) => c.id === card.column_id);
    const to = cols.rows.find((c) => c.id === toColumnId);
    if (!to) err('Coluna de destino inválida');
    if (to.id === card.column_id) { res.json(card); return; }

    const advancing = from ? to.position > from.position : true;
    if (advancing) {
      const open = await query(
        `SELECT COUNT(*)::int AS n FROM ${SCHEMA}.task_items WHERE card_id=$1 AND stage_column_id=$2 AND NOT done`,
        [card.id, card.column_id]
      );
      if (open.rows[0].n > 0) err(`Feche as ${open.rows[0].n} micro-tarefa(s) desta coluna antes de avançar`, 409);
    }

    const enteringDone = to.is_done_col;
    const leavingDone = from?.is_done_col;
    const setStatus = enteringDone ? 'done' : 'open';
    const r = await query(
      `UPDATE ${SCHEMA}.task_cards
          SET column_id=$1,
              status=$2,
              started_at = COALESCE(started_at, now()),
              done_at = CASE WHEN $3 THEN now() WHEN $4 THEN NULL ELSE done_at END,
              updated_at = now()
        WHERE id=$5 RETURNING *`,
      [toColumnId, setStatus, enteringDone, leavingDone, card.id]
    );
    await logActivity(card.id, req.user.id, 'moved', { fromCol: card.column_id, toCol: toColumnId });
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// ===================== MICRO-TAREFAS =====================
router.post('/cards/:id/items', ...manage, async (req, res) => {
  try {
    const card = await cardTeam(req.companyId, Number(req.params.id));
    await assertTeam(req, card.team_id, { manage: true });
    const title = String(req.body?.title || '').trim();
    if (title.length < 1) err('Informe a micro-tarefa');
    const stageColumnId = Number(req.body?.stage_column_id) || card.column_id;
    const pos = await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${SCHEMA}.task_items WHERE card_id=$1`, [card.id]);
    const r = await query(
      `INSERT INTO ${SCHEMA}.task_items (card_id, stage_column_id, title, position) VALUES ($1,$2,$3,$4) RETURNING *`,
      [card.id, stageColumnId, title, pos.rows[0].p]
    );
    await logActivity(card.id, req.user.id, 'item_added', { detail: title });
    res.status(201).json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// Fechar/reabrir micro (membro pode).
router.patch('/items/:id/toggle', ...view, async (req, res) => {
  try {
    const it = await query(`SELECT i.*, c.team_id, c.company_id, c.assignee_id FROM ${SCHEMA}.task_items i JOIN ${SCHEMA}.task_cards c ON c.id=i.card_id WHERE i.id=$1 AND c.company_id=$2`, [Number(req.params.id), req.companyId]);
    if (!it.rows[0]) err('Micro-tarefa não encontrada', 404);
    await assertCardAccess(req, it.rows[0]);
    const done = Boolean(req.body?.done);
    const r = await query(
      `UPDATE ${SCHEMA}.task_items
          SET done=$1, done_by = CASE WHEN $1 THEN $2::int ELSE NULL END, done_at = CASE WHEN $1 THEN now() ELSE NULL END
        WHERE id=$3 RETURNING *`,
      [done, req.user.id, Number(req.params.id)]
    );
    await logActivity(it.rows[0].card_id, req.user.id, done ? 'item_done' : 'item_undone', { detail: it.rows[0].title });
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.put('/items/:id', ...manage, async (req, res) => {
  try {
    const it = await query(`SELECT i.*, c.team_id FROM ${SCHEMA}.task_items i JOIN ${SCHEMA}.task_cards c ON c.id=i.card_id WHERE i.id=$1 AND c.company_id=$2`, [Number(req.params.id), req.companyId]);
    if (!it.rows[0]) err('Micro-tarefa não encontrada', 404);
    await assertTeam(req, it.rows[0].team_id, { manage: true });
    const title = req.body?.title != null ? String(req.body.title).trim() : it.rows[0].title;
    const stageColumnId = req.body?.stage_column_id !== undefined ? (Number(req.body.stage_column_id) || null) : it.rows[0].stage_column_id;
    const r = await query(`UPDATE ${SCHEMA}.task_items SET title=$1, stage_column_id=$2 WHERE id=$3 RETURNING *`, [title, stageColumnId, Number(req.params.id)]);
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.delete('/items/:id', ...manage, async (req, res) => {
  try {
    const it = await query(`SELECT i.*, c.team_id FROM ${SCHEMA}.task_items i JOIN ${SCHEMA}.task_cards c ON c.id=i.card_id WHERE i.id=$1 AND c.company_id=$2`, [Number(req.params.id), req.companyId]);
    if (!it.rows[0]) err('Micro-tarefa não encontrada', 404);
    await assertTeam(req, it.rows[0].team_id, { manage: true });
    await query(`DELETE FROM ${SCHEMA}.task_items WHERE id=$1`, [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// ===================== MODELOS DE TAREFA =====================
router.get('/models', ...manageModels, async (req, res) => {
  try {
    const r = await query(
      `SELECT m.*, t.name AS team_name,
              (SELECT COUNT(*) FROM ${SCHEMA}.task_model_items i WHERE i.model_id=m.id)::int AS items
         FROM ${SCHEMA}.task_models m LEFT JOIN ${SCHEMA}.task_teams t ON t.id=m.team_id
        WHERE m.company_id=$1 ORDER BY m.name`,
      [req.companyId]
    );
    res.json({ items: r.rows });
  } catch (e) { respondError(res, e); }
});

router.get('/models/:id', ...manageModels, async (req, res) => {
  try {
    const m = await query(`SELECT * FROM ${SCHEMA}.task_models WHERE id=$1 AND company_id=$2`, [Number(req.params.id), req.companyId]);
    if (!m.rows[0]) err('Modelo não encontrado', 404);
    const items = await query(`SELECT * FROM ${SCHEMA}.task_model_items WHERE model_id=$1 ORDER BY position, id`, [m.rows[0].id]);
    res.json({ model: m.rows[0], items: items.rows });
  } catch (e) { respondError(res, e); }
});

async function replaceModelItems(modelId, items) {
  await query(`DELETE FROM ${SCHEMA}.task_model_items WHERE model_id=$1`, [modelId]);
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const stage = String(list[i]?.stage_name || '').trim();
    const title = String(list[i]?.title || '').trim();
    if (!title) continue;
    await query(`INSERT INTO ${SCHEMA}.task_model_items (model_id, stage_name, title, position) VALUES ($1,$2,$3,$4)`, [modelId, stage, title, i]);
  }
}

router.post('/models', ...manageModels, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2) err('Informe o nome do modelo');
    const teamId = Number(req.body?.team_id) || null;
    const title = req.body?.title ? String(req.body.title).trim() || null : null;
    const dueDays = Number.isInteger(Number(req.body?.due_days)) ? Number(req.body.due_days) : null;
    const r = await query(
      `INSERT INTO ${SCHEMA}.task_models (company_id, team_id, name, title, due_days, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.companyId, teamId, name, title, dueDays, req.user.id]
    );
    await replaceModelItems(r.rows[0].id, req.body?.items);
    res.status(201).json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.put('/models/:id', ...manageModels, async (req, res) => {
  try {
    const m = await query(`SELECT * FROM ${SCHEMA}.task_models WHERE id=$1 AND company_id=$2`, [Number(req.params.id), req.companyId]);
    if (!m.rows[0]) err('Modelo não encontrado', 404);
    const name = req.body?.name != null ? String(req.body.name).trim() : m.rows[0].name;
    const teamId = req.body?.team_id !== undefined ? (Number(req.body.team_id) || null) : m.rows[0].team_id;
    const title = req.body?.title !== undefined ? (String(req.body.title || '').trim() || null) : m.rows[0].title;
    const dueDays = req.body?.due_days !== undefined ? (Number.isInteger(Number(req.body.due_days)) ? Number(req.body.due_days) : null) : m.rows[0].due_days;
    const r = await query(`UPDATE ${SCHEMA}.task_models SET name=$1, team_id=$2, title=$3, due_days=$4 WHERE id=$5 RETURNING *`, [name, teamId, title, dueDays, m.rows[0].id]);
    if (req.body?.items !== undefined) await replaceModelItems(m.rows[0].id, req.body.items);
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.delete('/models/:id', ...manageModels, async (req, res) => {
  try {
    const m = await query(`DELETE FROM ${SCHEMA}.task_models WHERE id=$1 AND company_id=$2 RETURNING id`, [Number(req.params.id), req.companyId]);
    if (!m.rows[0]) err('Modelo não encontrado', 404);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

module.exports = router;
