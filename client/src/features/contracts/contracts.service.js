import { api } from '@/lib/api-client'

const unwrap = (r) => r.data?.data ?? r.data

const sanitizeListParams = (params = {}) => {
  const {
    page,
    pageSize,
    queryKey,
    signal,
    client,
    meta,
    pageParam,
    ...filters
  } = params || {};

  return {
    page: page ?? 1,
    pageSize: pageSize ?? 500,
    ...filters,
  };
};

export const contractsService = {
  list: async (params = {}) => {
    const requestParams = sanitizeListParams(params);
    return unwrap(await api.get('/contracts', { params: requestParams }));
  }, // deve retornar client_name
  paginate: async (params = {}) => (await api.get('/contracts', { params })).data,
  create: async (payload) => (await api.post('/contracts', payload)).data,
  update: async (id, payload) => (await api.put(`/contracts/${id}`, payload)).data,
  remove: async (id) => (await api.delete(`/contracts/${id}`)).data,
  setStatus: async (id, payload) => (await api.patch(`/contracts/${id}/status`, payload)).data,
  getCustomBillings: async (id) => (await api.get(`/contracts/${id}/custom-billings`)).data,
  setCustomBillings: async (id, items = []) => (await api.put(`/contracts/${id}/custom-billings`, items)).data,
}
export const clientsPicker = async (params = {}) => {
  const { page, pageSize, ...rest } = params;
  const requestParams = {
    page: page ?? 1,
    pageSize: pageSize ?? 500,
    ...rest,
  };
  return unwrap(await api.get('/clients', { params: requestParams }));
}
