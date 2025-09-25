import { api } from '@/lib/api-client'
export const companyUsersService = {
  list: async (id) => (await api.get(`/companies/${id}/users`)).data,
  create: async (id, payload) => (await api.post(`/companies/${id}/users`, payload)).data,
  update: async (id, userId, payload) => (await api.put(`/companies/${id}/users/${userId}`, payload)).data,
  remove: async (id, userId) => (await api.delete(`/companies/${id}/users/${userId}`)).data,
}
