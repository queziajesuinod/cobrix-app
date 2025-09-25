import { api } from '@/lib/api-client'

const unwrap = (r) => r.data?.data ?? r.data

export const contractsService = {
  list: async () => unwrap(await api.get('/contracts')), // deve retornar client_name
  create: async (payload) => (await api.post('/contracts', payload)).data,
  update: async (id, payload) => (await api.put(`/contracts/${id}`, payload)).data,
  remove: async (id) => (await api.delete(`/contracts/${id}`)).data,
}
export const clientsPicker = async () => unwrap(await api.get('/clients'))
