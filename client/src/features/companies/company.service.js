import { api } from '@/lib/api-client'
export const companyService = {
  list: async () => (await api.get('/companies')).data,
  get: async (id) => (await api.get(`/companies/${id}`)).data,
  create: async (payload) => (await api.post('/companies', payload)).data,
  update: async (id, payload) => (await api.put(`/companies/${id}`, payload)).data,
  remove: async (id) => (await api.delete(`/companies/${id}`)).data,
}