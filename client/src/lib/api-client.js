// ...existing code...
import axios from 'axios'
import { authService } from '../features/auth/auth.service'

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || '/api' })

const isDev = import.meta?.env?.DEV ?? false

function readAuth() {
  try {
    const raw = localStorage.getItem('auth')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function readSelectedCompanyId() {
  try {
    const raw = localStorage.getItem('selectedCompanyId')
    return raw ? Number(raw) : null
  } catch { return null }
}

export function writeAuth(data) {
  localStorage.setItem('auth', JSON.stringify(data))
}
export function clearAuth() {
  localStorage.removeItem('auth')
}

// attach token + X-Company-Id to requests
api.interceptors.request.use((config) => {
  config.headers = config.headers || {}

  const url = config.url || ''
  const isAuthRoute = url.startsWith('/auth/')

  // prefer authService token, fallback to localStorage 'auth'
  const svcToken = authService?.getToken ? authService.getToken() : null
  const auth = readAuth()
  const token = svcToken || auth?.token

  if (!isAuthRoute && token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  // X-Company-Id: prefer explicit config.companyId, then selectedCompanyId, then auth.user.company_id
  const selected = readSelectedCompanyId()
  const fromAuth = auth?.user?.company_id ?? null
  const companyId = config.companyId ?? selected ?? fromAuth
  if (companyId && !config.headers['X-Company-Id']) {
    config.headers['X-Company-Id'] = companyId
  }

  return config
}, (err) => Promise.reject(err))

// response interceptor: only clear session on explicit 401 (not network errors)
// and only for auth/verify or auth/login failures
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    const status = err?.response?.status
    const reqUrl = err?.config?.url || ''

    const net = err?.code || ''
    const isNetworkDown = ['ECONNABORTED', 'ECONNREFUSED', 'ERR_NETWORK'].includes(net)

    if (status === 401 && !isNetworkDown) {
      if (reqUrl.startsWith('/auth/verify') || reqUrl.startsWith('/auth/login')) {
        clearAuth()
        // redirect to login if not already there
        if (!location.pathname.startsWith('/login')) {
          window.location.assign('/login')
        }
      }
    }

    return Promise.reject(err)
  }
)

export default api
export { api }
// ...existing code...