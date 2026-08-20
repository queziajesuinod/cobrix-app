import { api } from '@/lib/api-client';

export const reportsService = {
  risk: async () => (await api.get('/reports/risk')).data,
  overdueClients: async (params = {}) => (await api.get('/reports/overdue-clients', { params })).data,
  notifyOverdueClient: async (clientId, payload = {}) =>
    (await api.post(`/reports/overdue-clients/client/${clientId}/notify`, payload)).data,
  markOverdueClientPaid: async (clientId, payload = {}) =>
    (await api.post(`/reports/overdue-clients/client/${clientId}/mark-paid`, payload)).data,
  markOverdueBillingPaid: async (billingId, payload = {}) =>
    (await api.post(`/reports/overdue-clients/billing/${billingId}/mark-paid`, payload)).data,
  waiveOverdueBillings: async (billingIds) =>
    (await api.post('/reports/overdue-clients/waive', { billingIds })).data,
  settleOverdueBillings: async ({ billingIds, amount, paidAt, label }) =>
    (await api.post('/reports/overdue-clients/settle', { billingIds, amount, paid_at: paidAt, label })).data,
};

export default reportsService;
