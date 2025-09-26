// client/src/lib/api-client.js
import axios from 'axios'
import { authService } from '@/features/auth/auth.service'

const api = axios.create({ baseURL: '/api', withCredentials: true })

api.interceptors.request.use((config) => {
  config.headers ||= {}

  // Token do authService
  const token = authService.getToken()
  if (token && !config.url?.startsWith('/auth/')) {
    config.headers.Authorization = `Bearer ${token}`
  }

  // X-Company-Id automático
  const selected = Number(localStorage.getItem('selectedCompanyId') || '') || null
  const fromAuth = authService.getAuth()?.user?.company_id ?? null
  const cid = config.headers['X-Company-Id'] || config.companyId || selected || fromAuth
  if (cid && !config.headers['X-Company-Id']) config.headers['X-Company-Id'] = cid

  return config
})

export default api
export { api }
