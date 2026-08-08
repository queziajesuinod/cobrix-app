import { api } from '@/lib/api-client'

export const emailIntegrationService = {
  getConfig: async (id) => (await api.get(`/companies/${id}/integration/email`)).data,
  saveConfig: async (id, payload) => (await api.put(`/companies/${id}/integration/email`, payload)).data,
  sendTest: async (id, to) => (await api.post(`/companies/${id}/integration/email/test`, { to })).data,
}

export default emailIntegrationService
