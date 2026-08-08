import { api } from '@/lib/api-client'

export const subscriptionSelfService = {
  get: async () => (await api.get('/subscriptions/me')).data,
  cancel: async () => (await api.post('/subscriptions/me/cancel')).data,
  changePlan: async (payload) => (await api.post('/subscriptions/me/change-plan', payload)).data,
}

export default subscriptionSelfService
