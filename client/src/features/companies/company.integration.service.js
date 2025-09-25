import { api } from '@/lib/api-client'
export const companyIntegrationService = {
  getEvo: async (id) => (await api.get(`/companies/${id}/integration/evo`)).data,
  updateEvo: async (id, payload) => (await api.put(`/companies/${id}/integration/evo`, payload)).data,
  testEvo: async (id, payload) => (await api.post(`/companies/${id}/integration/evo/test`, payload)).data,
}
