import { api } from '@/lib/api-client'
export const authService = {
  login: async ({ email, password }) => (await api.post('/auth/login', { email, password })).data,
  verify: async () => (await api.get('/auth/verify')).data
}
