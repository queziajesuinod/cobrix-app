import { api } from '@/lib/api-client'

export const publicService = {
  plans: async () => (await api.get('/public/plans')).data,
  signup: async (payload) => (await api.post('/public/signup', payload)).data,
}

export default publicService
