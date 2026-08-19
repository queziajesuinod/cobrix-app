import { api } from '@/lib/api-client'

export const couponsService = {
  list: async () => (await api.get('/coupons')).data,
  create: async (payload) => (await api.post('/coupons', payload)).data,
  update: async (id, payload) => (await api.put(`/coupons/${id}`, payload)).data,
  setActive: async (id, active) => (await api.patch(`/coupons/${id}/active`, { active })).data,
  remove: async (id) => (await api.delete(`/coupons/${id}`)).data,
}

export default couponsService
