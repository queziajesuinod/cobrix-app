import { api } from '@/lib/api-client'

export const dashboardService = {
  getSummary: async () => (await api.get('/dashboard/summary')).data,
}
