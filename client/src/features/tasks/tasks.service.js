import { api } from '@/lib/api-client'

export const tasksService = {
  // Equipes
  teams: async () => (await api.get('/tasks/teams')).data,
  createTeam: async (payload) => (await api.post('/tasks/teams', payload)).data,
  members: async (teamId) => (await api.get(`/tasks/teams/${teamId}/members`)).data,
  companyUsers: async () => (await api.get('/tasks/company-users')).data,
  addMember: async (teamId, payload) => (await api.post(`/tasks/teams/${teamId}/members`, payload)).data,
  removeMember: async (teamId, userId) => (await api.delete(`/tasks/teams/${teamId}/members/${userId}`)).data,
  // Colunas
  columns: async (teamId) => (await api.get(`/tasks/teams/${teamId}/columns`)).data,
  createColumn: async (teamId, payload) => (await api.post(`/tasks/teams/${teamId}/columns`, payload)).data,
  updateColumn: async (id, payload) => (await api.put(`/tasks/columns/${id}`, payload)).data,
  deleteColumn: async (id) => (await api.delete(`/tasks/columns/${id}`)).data,
  // Quadro
  board: async (teamId, ym) => (await api.get(`/tasks/teams/${teamId}/board`, { params: { ym } })).data,
  stats: async (teamId) => (await api.get(`/tasks/teams/${teamId}/stats`)).data,
  // Cartões
  createCard: async (teamId, payload) => (await api.post(`/tasks/teams/${teamId}/cards`, payload)).data,
  card: async (id) => (await api.get(`/tasks/cards/${id}`)).data,
  updateCard: async (id, payload) => (await api.put(`/tasks/cards/${id}`, payload)).data,
  deleteCard: async (id) => (await api.delete(`/tasks/cards/${id}`)).data,
  moveCard: async (id, toColumnId) => (await api.post(`/tasks/cards/${id}/move`, { to_column_id: toColumnId })).data,
  // Micro-tarefas
  addItem: async (cardId, payload) => (await api.post(`/tasks/cards/${cardId}/items`, payload)).data,
  toggleItem: async (id, done) => (await api.patch(`/tasks/items/${id}/toggle`, { done })).data,
  updateItem: async (id, payload) => (await api.put(`/tasks/items/${id}`, payload)).data,
  deleteItem: async (id) => (await api.delete(`/tasks/items/${id}`)).data,
  // Modelos
  models: async () => (await api.get('/tasks/models')).data,
  modelsSelect: async () => (await api.get('/tasks/models-select')).data,
  model: async (id) => (await api.get(`/tasks/models/${id}`)).data,
  createModel: async (payload) => (await api.post('/tasks/models', payload)).data,
  updateModel: async (id, payload) => (await api.put(`/tasks/models/${id}`, payload)).data,
  deleteModel: async (id) => (await api.delete(`/tasks/models/${id}`)).data,
}

export default tasksService
