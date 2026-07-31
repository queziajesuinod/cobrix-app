import { api } from '@/lib/api-client'
import { kpisSchema, despesasCategoriaSchema, evolucaoSchema, projecaoSchema, inadimplenciaSchema, receitaTipoContratoSchema, metaSchema, metasDashboardSchema, insightsSchema } from './dashboard.types'

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
  // Dashboard — respostas validadas contra o contrato (dashboard.types.js).
  dashboardKpis: async (params = {}) => kpisSchema.parse((await api.get('/finance/dashboard/kpis', { params })).data),
  dashboardDespesasCategoria: async (params = {}) => despesasCategoriaSchema.parse((await api.get('/finance/dashboard/despesas-categoria', { params })).data),
  dashboardEvolucao: async (params = {}) => evolucaoSchema.parse((await api.get('/finance/dashboard/evolucao', { params })).data),
  dashboardProjecao: async (params = {}) => projecaoSchema.parse((await api.get('/finance/dashboard/projecao', { params })).data),
  dashboardInadimplencia: async (params = {}) => inadimplenciaSchema.parse((await api.get('/finance/dashboard/inadimplencia', { params })).data),
  dashboardReceitaTipoContrato: async (params = {}) => receitaTipoContratoSchema.parse((await api.get('/finance/dashboard/receita-tipo-contrato', { params })).data),
  dashboardMetas: async (params = {}) => metasDashboardSchema.parse((await api.get('/finance/dashboard/metas', { params })).data),
  dashboardInsights: async (params = {}) => insightsSchema.parse((await api.get('/finance/dashboard/insights', { params })).data),
  // Metas (orçado anual)
  getMetas: async (ano) => metaSchema.parse((await api.get('/finance/metas', { params: { ano } })).data),
  saveMetas: async (ano, payload) => (await api.put(`/finance/metas/${ano}`, payload)).data,
  importRevenues: async (items) => (await api.post('/finance/revenues/import', { items })).data,
  importExpenses: async (items) => (await api.post('/finance/expenses/import', { items })).data,
  paidContracts: async (params = {}) => (await api.get('/finance/paid-contracts', { params })).data,
  reversePaidContract: async (id) => (await api.patch(`/finance/paid-contracts/${id}/reverse`)).data,
  updatePaidContract: async (id, amount) => (await api.put(`/finance/paid-contracts/${id}`, { amount })).data,
}

export default financeService
