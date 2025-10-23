import axios from 'axios'
import { authService } from '@/features/auth/auth.service'

const api = axios.create({ 
  baseURL: 'https://apicobrix.aleftec.com.br/api', 
  withCredentials: true 
})


// Função para obter o selectedCompanyId atual
const getSelectedCompanyId = () => {
  try {
    const stored = localStorage.getItem('selectedCompanyId')
    return stored ? Number(stored) : null
  } catch {
    return null
  }
}

api.interceptors.request.use((config) => {
  config.headers ||= {}

  // Token do authService
  const token = authService.getToken()
  if (token && !config.url?.startsWith('/auth/')) {
    config.headers.Authorization = `Bearer ${token}`
  }

  // X-Company-Id automático - prioriza o selecionado pelo usuário
  const selectedCompanyId = getSelectedCompanyId()
  const userCompanyId = authService.getAuth()?.user?.company_id ?? null
  
  // Usar o ID da empresa selecionada, ou fallback para a empresa do usuário
  const companyId = config.headers['X-Company-Id'] || 
                   config.companyId || 
                   selectedCompanyId || 
                   userCompanyId

  if (companyId && !config.headers['X-Company-Id']) {
    config.headers['X-Company-Id'] = String(companyId)
  }

  return config
})

export default api
export { api }
