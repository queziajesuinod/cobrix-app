import { api } from '@/lib/api-client'

const unwrap = (r) => r.data?.data ?? r.data

export const clientsService = {
  list: async (params = {}) => {
    const { page, pageSize, ...rest } = params;
    const requestParams = {
      page: page ?? 1,
      pageSize: pageSize ?? 500,
      ...rest,
    };
    return unwrap(await api.get('/clients', { params: requestParams }));
  },
  paginate: async (params = {}) => (await api.get('/clients', { params })).data,
  create: async (payload) => (await api.post('/clients', payload)).data,
  update: async (id, payload) => (await api.put(`/clients/${id}`, payload)).data,
  remove: async (id) => (await api.delete(`/clients/${id}`)).data,
}
