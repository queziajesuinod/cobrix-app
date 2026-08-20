import { api } from '@/lib/api-client'

export const commissionsService = {
  summary: async () => (await api.get('/partner-commissions/summary')).data,
  list: async (params = {}) => (await api.get('/partner-commissions', { params })).data,
  settle: async (payload) => (await api.post('/partner-commissions/settle', payload)).data,
  charge: async (payload) => (await api.post('/partner-commissions/charge', payload)).data,
}

export default commissionsService
