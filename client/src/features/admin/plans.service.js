import { api } from '@/lib/api-client'

export const plansService = {
  list: async () => (await api.get('/plans')).data,
  get: async (id) => (await api.get(`/plans/${id}`)).data,
  create: async (payload) => (await api.post('/plans', payload)).data,
  update: async (id, payload) => (await api.put(`/plans/${id}`, payload)).data,
  remove: async (id) => (await api.delete(`/plans/${id}`)).data,
  adjustPreview: async (id) => (await api.get(`/plans/${id}/adjust-preview`)).data,
  adjustApply: async (id, payload) => (await api.post(`/plans/${id}/adjust`, payload)).data,
}

export default plansService
