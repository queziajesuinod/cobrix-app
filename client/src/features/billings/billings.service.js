import { api } from '@/lib/api-client'
const unwrap = (r) => r.data?.data ?? r.data

export const billingsService = {
  list: async (params={}) => unwrap(await api.get('/billings', { params })),
  overview: async (ym, params={}) => (await api.get('/billings/overview', { params: { ym, ...params } })).data,
  kpis: async (ym, params={}) => (await api.get('/billings/kpis', { params: { ym, ...params } })).data,
  paidMonths: async (ym, params={}) => (await api.get('/billings/paid', { params: { ym, ...params } })).data,
  notifyManual: async ({ contract_id, date, type }) => (await api.post('/billings/notify', { contract_id, date, type })).data,
  checkRun: async (payload={}) => (await api.post('/billings/check/run', payload)).data,
  setStatus: async (id, status, paidAt) => (await api.put(`/billings/${id}/status`, { status, paid_at: paidAt })).data,
  setMonthStatus: async (contractId, year, month, status, paidAt) =>
    (await api.put(`/billings/by-contract/${contractId}/month/${year}/${month}/status`, { status, paid_at: paidAt })).data,
  getNotifications: async (billingId) => (await api.get(`/billings/${billingId}/notifications`)).data,
}
