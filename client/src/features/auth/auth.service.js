import api from '@/lib/api-client'

function readAuth() {
  try {
    const raw = localStorage.getItem('auth')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeAuth(data) {
  try {
    localStorage.setItem('auth', JSON.stringify(data))
  } catch {}
}

function clearAuth() {
  try {
    localStorage.removeItem('auth')
  } catch {}
}

export const authService = {
  login: async ({ email, password }) => {
    const { data } = await api.post('/auth/login', { email, password })
    if (data?.token) writeAuth(data)
    return data
  },
  verify: async () => {
    const { data } = await api.get('/auth/verify')
    return data
  },
  // helper used by api-client
  getToken: () => {
    const a = readAuth()
    return a?.token ?? null
  },
  setAuth: (data) => writeAuth(data),
  clearToken: () => clearAuth()
}

export default authService