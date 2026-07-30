import { api } from '@/lib/api-client'

export const menuService = {
  getSeen: async () => (await api.get('/menu/seen')).data,
  markSeen: async (key) => (await api.post('/menu/seen', { key })).data,
}

export default menuService
