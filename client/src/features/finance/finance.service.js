import { api } from '@/lib/api-client'

export const financeService = {
  revenues: async (params = {}) => (await api.get('/finance/revenues', { params })).data,
  createRevenue: async (p) => (await api.post('/finance/revenues', p)).data,
  updateRevenue: async (id, p) => (await api.put(`/finance/revenues/${id}`, p)).data,
  deleteRevenue: async (id) => (await api.delete(`/finance/revenues/${id}`)).data,
  expenses: async (params = {}) => (await api.get('/finance/expenses', { params })).data,
  createExpense: async (p) => (await api.post('/finance/expenses', p)).data,
  updateExpense: async (id, p) => (await api.put(`/finance/expenses/${id}`, p)).data,
  setExpenseRecurrence: async (id, active) => (await api.patch(`/finance/expenses/${id}/recurrence`, { active })).data,
  deleteExpense: async (id) => (await api.delete(`/finance/expenses/${id}`)).data,
  summary: async (params = {}) => (await api.get('/finance/summary', { params })).data,
  summaryAnnual: async (params = {}) => (await api.get('/finance/summary/annual', { params })).data,
  importRevenues: async (items) => (await api.post('/finance/revenues/import', { items })).data,
  importExpenses: async (items) => (await api.post('/finance/expenses/import', { items })).data,
  paidContracts: async (params = {}) => (await api.get('/finance/paid-contracts', { params })).data,
  reversePaidContract: async (id) => (await api.patch(`/finance/paid-contracts/${id}/reverse`)).data,
  updatePaidContract: async (id, amount) => (await api.put(`/finance/paid-contracts/${id}`, { amount })).data,
}

export default financeService
