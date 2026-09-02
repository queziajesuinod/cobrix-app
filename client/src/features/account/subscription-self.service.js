import { api } from '@/lib/api-client'

export const subscriptionSelfService = {
  get: async () => (await api.get('/subscriptions/me')).data,
  cancel: async () => (await api.post('/subscriptions/me/cancel')).data,
  changePlan: async (payload) => (await api.post('/subscriptions/me/change-plan', payload)).data,
  listCompanies: async () => (await api.get('/subscriptions/me/companies')).data,
  addCompany: async ({ name, document }) => (await api.post('/subscriptions/me/companies', { name, document })).data,
  removeCompany: async (id) => (await api.delete(`/subscriptions/me/companies/${id}`)).data,
}

export default subscriptionSelfService
