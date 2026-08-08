import { api } from '@/lib/api-client'

export const subscriptionsService = {
  list: async (status) => (await api.get('/master/subscriptions', { params: status ? { status } : {} })).data,
  get: async (id) => (await api.get(`/master/subscriptions/${id}`)).data,
  confirm: async (id) => (await api.post(`/master/subscriptions/${id}/confirm`)).data,
  cancel: async (id) => (await api.post(`/master/subscriptions/${id}/cancel`)).data,
  resendPix: async (id) => (await api.post(`/master/subscriptions/${id}/resend-pix`)).data,
  reactivate: async (id, payload) => (await api.post(`/master/subscriptions/${id}/reactivate`, payload)).data,
}

export default subscriptionsService
