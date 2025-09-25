import { api } from '@/lib/api-client'

const unwrap = (r) => r.data?.data ?? r.data

export const clientsService = {
  list: async () => unwrap(await api.get('/clients')),
  create: async (payload) => (await api.post('/clients', payload)).data,
  update: async (id, payload) => (await api.put(`/clients/${id}`, payload)).data,
  remove: async (id) => (await api.delete(`/clients/${id}`)).data,
}
