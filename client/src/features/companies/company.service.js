import { api } from '@/lib/api-client'
export const companyService = {
  list: async () => (await api.get('/companies')).data,
  mine: async () => (await api.get('/companies/mine')).data,
  get: async (id) => (await api.get(`/companies/${id}`)).data,
  create: async (payload) => (await api.post('/companies', payload)).data,
  update: async (id, payload) => (await api.put(`/companies/${id}`, payload)).data,
  remove: async (id) => (await api.delete(`/companies/${id}`)).data,
  partnerPrices: async (id) => (await api.get(`/companies/${id}/partner-prices`)).data,
  savePartnerPrice: async (id, planId, payload) => (await api.put(`/companies/${id}/partner-prices/${planId}`, payload)).data,
}