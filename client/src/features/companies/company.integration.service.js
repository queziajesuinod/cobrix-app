import { api } from '@/lib/api-client'
export const companyIntegrationService = {
  getEvoStatus: async (id) => (await api.get(`/companies/${id}/integration/evo`)).data,
  getEvoQrCode: async (id) => (await api.get(`/companies/${id}/integration/evo/qrcode`)).data,
  restartInstance: async (id) => (await api.post(`/companies/${id}/integration/evo/restart`)).data,
  connectInstance: async (id) => (await api.post(`/companies/${id}/integration/evo/connect`)).data,
  testEvo: async (id, payload) => (await api.post(`/companies/${id}/integration/evo/test`, payload)).data,
}
