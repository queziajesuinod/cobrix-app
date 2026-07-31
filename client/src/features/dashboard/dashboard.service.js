import { api } from '@/lib/api-client'

export const dashboardService = {
  getSummary: async () => (await api.get('/dashboard/summary')).data,
  getUpcoming: async (days = 7) => (await api.get('/dashboard/upcoming', { params: { days } })).data,
  getOverdueTop: async (limit = 5) => (await api.get('/dashboard/overdue-top', { params: { limit } })).data,
}
