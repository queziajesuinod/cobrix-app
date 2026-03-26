import { api } from '@/lib/api-client';

export const reportsService = {
  overdueClients: async (params = {}) => (await api.get('/reports/overdue-clients', { params })).data,
  notifyOverdueClient: async (clientId, payload = {}) =>
    (await api.post(`/reports/overdue-clients/client/${clientId}/notify`, payload)).data,
  markOverdueClientPaid: async (clientId, payload = {}) =>
    (await api.post(`/reports/overdue-clients/client/${clientId}/mark-paid`, payload)).data,
  markOverdueBillingPaid: async (billingId) =>
    (await api.post(`/reports/overdue-clients/billing/${billingId}/mark-paid`)).data,
};

export default reportsService;
