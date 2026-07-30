import axios from 'axios'
import { authService } from '@/features/auth/auth.service'
import { getApiBaseUrl } from '@/lib/api-base'

const api = axios.create({
  baseURL: getApiBaseUrl(),
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

let redirectingToLogin = false
const SESSION_EVENT = 'auth:expired'

function handleSessionExpired() {
  authService.clearToken()
  try { localStorage.removeItem('selectedCompanyId') } catch {}
  window.dispatchEvent(new CustomEvent(SESSION_EVENT))
  if (redirectingToLogin) return
  redirectingToLogin = true
  // App usa HashRouter: as rotas vivem em window.location.hash (#/login), e
  // pathname é sempre '/'. Redirecionar via hash mantém a navegação dentro da SPA.
  if (!window.location.hash.startsWith('#/login')) {
    window.location.hash = '#/login'
  }
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    if (status === 401 || status === 419) {
      handleSessionExpired()
    }
    return Promise.reject(error)
  }
)

export default api
export { api }
