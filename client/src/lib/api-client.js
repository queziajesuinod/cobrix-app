import axios from 'axios'
import { authService } from '@/features/auth/auth.service'

// ✅ OPÇÃO 3: Detecção Automática de Domínio
// A URL da API é detectada automaticamente baseada no hostname
// Vantagem: Funciona em qualquer ambiente sem configuração

const getApiUrl = () => {
  const hostname = window.location.hostname
  
  // Mapeamento de domínios
  const domainMap = {
    'cobrix.aleftec.com.br': 'https://apicobrix.aleftec.com.br',
    'localhost': 'http://localhost:3005',
    '127.0.0.1': 'http://localhost:3005',
  }
  
  // Retorna a URL mapeada ou usa o próprio origin como fallback
  return domainMap[hostname] || window.location.origin
}

const api = axios.create({ 
  baseURL: `${getApiUrl()}/api`,
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
  if (window.location.pathname !== '/login') {
    window.location.replace('/login')
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
