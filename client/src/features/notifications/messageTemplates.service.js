import { api } from '@/lib/api-client'

export const messageTemplatesService = {
  list: async () => (await api.get('/message-templates')).data,
  save: async (templates) => (await api.put('/message-templates', { templates })).data,
}
