import { api } from '@/lib/api-client'

function resolveCompanyId(companyId) {
  const numeric = Number(companyId)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error('Selecione uma empresa para continuar.')
  }
  return numeric
}

export const contractTypesService = {
  list: async (companyId) =>
    (await api.get('/contract-types', { companyId: resolveCompanyId(companyId) })).data,
  create: async (payload, companyId) =>
    (await api.post('/contract-types', payload, { companyId: resolveCompanyId(companyId) })).data,
  update: async (id, payload, companyId) =>
    (await api.put(`/contract-types/${id}`, payload, { companyId: resolveCompanyId(companyId) })).data,
  remove: async (id, companyId) =>
    (await api.delete(`/contract-types/${id}`, { companyId: resolveCompanyId(companyId) })).data,
}
