import { api } from '@/lib/api-client'

export const tasksService = {
  // Etapas (colunas do Kanban)
  stages: async () => (await api.get('/tasks/stages')).data,
  createStage: async (payload) => (await api.post('/tasks/stages', payload)).data,
  updateStage: async (id, payload) => (await api.put(`/tasks/stages/${id}`, payload)).data,
  deleteStage: async (id) => (await api.delete(`/tasks/stages/${id}`)).data,
  reorderStages: async (order) => (await api.put('/tasks/stages/reorder', { order })).data,
  // Grupos / Rotinas (raias)
  groups: async () => (await api.get('/tasks/groups')).data,
  createGroup: async (payload) => (await api.post('/tasks/groups', payload)).data,
  updateGroup: async (id, payload) => (await api.put(`/tasks/groups/${id}`, payload)).data,
  deleteGroup: async (id) => (await api.delete(`/tasks/groups/${id}`)).data,
  // Board híbrido (raias × etapas)
  board: async () => (await api.get('/tasks/board')).data,
  // Tarefas / subtarefas (árvore)
  node: async (id) => (await api.get(`/tasks/nodes/${id}`)).data,
  createNode: async (payload) => (await api.post('/tasks/nodes', payload)).data,
  updateNode: async (id, payload) => (await api.put(`/tasks/nodes/${id}`, payload)).data,
  deleteNode: async (id) => (await api.delete(`/tasks/nodes/${id}`)).data,
  moveNode: async (id, toStageId) => (await api.post(`/tasks/nodes/${id}/move`, { to_stage_id: toStageId })).data,
  toggleNode: async (id, done) => (await api.patch(`/tasks/nodes/${id}/done`, { done })).data,
  expand: async (id, payload) => (await api.post(`/tasks/nodes/${id}/expand`, payload)).data,
  reorderNodes: async (stageId, order) => (await api.put('/tasks/nodes/reorder', { stage_id: stageId, order })).data,
  reorderChildren: async (parentId, order) => (await api.put(`/tasks/nodes/${parentId}/children/reorder`, { order })).data,
  // Lixeira (Gestor): listar inativadas e restaurar
  completed: async () => (await api.get('/tasks/completed')).data,
  trash: async () => (await api.get('/tasks/trash')).data,
  restoreNode: async (id) => (await api.post(`/tasks/nodes/${id}/restore`)).data,
  // Comentários (discussão)
  addComment: async (id, body, mentionIds = []) => (await api.post(`/tasks/nodes/${id}/comments`, { body, mention_ids: mentionIds })).data,
  deleteComment: async (id) => (await api.delete(`/tasks/comments/${id}`)).data,
  mentionableUsers: async () => (await api.get('/tasks/mentionable-users')).data,
  // Etiquetas (labels)
  labels: async () => (await api.get('/tasks/labels')).data,
  createLabel: async (payload) => (await api.post('/tasks/labels', payload)).data,
  updateLabel: async (id, payload) => (await api.put(`/tasks/labels/${id}`, payload)).data,
  deleteLabel: async (id) => (await api.delete(`/tasks/labels/${id}`)).data,
  setNodeLabels: async (id, labelIds) => (await api.put(`/tasks/nodes/${id}/labels`, { label_ids: labelIds })).data,
  // Modelos de checklist (passo-a-passo reutilizável)
  checklists: async () => (await api.get('/tasks/checklists')).data,
  createChecklist: async (payload) => (await api.post('/tasks/checklists', payload)).data,
  updateChecklist: async (id, payload) => (await api.put(`/tasks/checklists/${id}`, payload)).data,
  deleteChecklist: async (id) => (await api.delete(`/tasks/checklists/${id}`)).data,
  applyChecklist: async (id, checklistId) => (await api.post(`/tasks/nodes/${id}/apply-checklist`, { checklist_id: checklistId })).data,
  // Rotinas recorrentes (templates)
  templates: async () => (await api.get('/tasks/templates')).data,
  generate: async () => (await api.post('/tasks/generate')).data,
  // Minhas tarefas + produtividade
  my: async () => (await api.get('/tasks/my')).data,
  productivity: async () => (await api.get('/tasks/productivity')).data,
  companyUsers: async () => (await api.get('/tasks/company-users')).data,
}

export default tasksService
