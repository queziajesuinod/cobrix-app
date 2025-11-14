import { api } from '@/lib/api-client'

export const contractTypesService = {
  list: async () => (await api.get('/contract-types')).data,
  create: async (payload) => (await api.post('/contract-types', payload)).data,
  update: async (id, payload) => (await api.put(`/contract-types/${id}`, payload)).data,
  remove: async (id) => (await api.delete(`/contract-types/${id}`)).data,
}
