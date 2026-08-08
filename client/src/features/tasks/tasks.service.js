import { api } from '@/lib/api-client'

export const tasksService = {
  // Etapas (colunas do Kanban)
  stages: async () => (await api.get('/tasks/stages')).data,
  createStage: async (payload) => (await api.post('/tasks/stages', payload)).data,
  updateStage: async (id, payload) => (await api.put(`/tasks/stages/${id}`, payload)).data,
  deleteStage: async (id) => (await api.delete(`/tasks/stages/${id}`)).data,
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
  // Rotinas recorrentes (templates)
  templates: async () => (await api.get('/tasks/templates')).data,
  generate: async () => (await api.post('/tasks/generate')).data,
  // Minhas tarefas + produtividade
  my: async () => (await api.get('/tasks/my')).data,
  productivity: async () => (await api.get('/tasks/productivity')).data,
  companyUsers: async () => (await api.get('/tasks/company-users')).data,
}

export default tasksService
