// Gera uma tarefa macro (cartão) a partir de um modelo de tarefa. Usado tanto no
// módulo de Tarefas quanto no cadastro de contrato (gatilho automático).
const { query } = require('../db');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const pad = (n) => String(n).padStart(2, '0');

// Retorna o cartão criado, ou null se o modelo não existir / não tiver equipe /
// a equipe não tiver colunas (nada a fazer, sem quebrar o fluxo do chamador).
async function generateCardFromModel({ companyId, modelId, contractId = null, createdBy = null }) {
  if (!modelId) return null;
  const m = await query(`SELECT * FROM ${SCHEMA}.task_models WHERE id=$1 AND company_id=$2`, [modelId, companyId]);
  const model = m.rows[0];
  if (!model || !model.team_id) return null;

  const cols = await query(
    `SELECT id, name, position FROM ${SCHEMA}.task_columns WHERE team_id=$1 ORDER BY position, id`,
    [model.team_id]
  );
  if (!cols.rows.length) return null;
  const firstCol = cols.rows[0].id;

  const now = new Date();
  const comp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  let dueDate = null;
  if (Number.isInteger(model.due_days)) {
    const d = new Date(now);
    d.setDate(d.getDate() + model.due_days);
    dueDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const title = (model.title && model.title.trim()) || model.name;

  const card = await query(
    `INSERT INTO ${SCHEMA}.task_cards
       (company_id, team_id, column_id, title, due_date, competence, model_id, contract_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [companyId, model.team_id, firstCol, title, dueDate, comp, model.id, contractId, createdBy]
  );
  const cardId = card.rows[0].id;

  // Micros padrão: mapeia a etapa (stage_name) para a coluna de mesmo nome na
  // equipe; sem correspondência, cai na coluna inicial.
  const items = await query(
    `SELECT stage_name, title, position FROM ${SCHEMA}.task_model_items WHERE model_id=$1 ORDER BY position, id`,
    [model.id]
  );
  const byName = new Map(cols.rows.map((c) => [String(c.name).trim().toLowerCase(), c.id]));
  for (const it of items.rows) {
    const stageCol = byName.get(String(it.stage_name).trim().toLowerCase()) || firstCol;
    await query(
      `INSERT INTO ${SCHEMA}.task_items (card_id, stage_column_id, title, position) VALUES ($1,$2,$3,$4)`,
      [cardId, stageCol, it.title, it.position]
    );
  }
  await query(
    `INSERT INTO ${SCHEMA}.task_activity (card_id, user_id, action, detail) VALUES ($1,$2,'created',$3)`,
    [cardId, createdBy, contractId ? `Gerada do modelo "${model.name}" (contrato #${contractId})` : `Gerada do modelo "${model.name}"`]
  );
  return card.rows[0];
}

module.exports = { generateCardFromModel };
