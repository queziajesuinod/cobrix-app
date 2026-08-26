// client/src/features/auth/AuthContext.jsx
import React from 'react'
import { authService } from './auth.service'
import { queryClient } from '@/lib/queryClient'

const AuthContext = React.createContext(null)
const COMPANY_STORAGE_KEY = 'selectedCompanyId'

function readStoredCompanyId() {
  try {
    const raw = localStorage.getItem(COMPANY_STORAGE_KEY)
    if (!raw) return null
    const numeric = Number(raw)
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null
  } catch {
    return null
  }
}

const SESSION_EVENT = 'auth:expired'

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [selectedCompanyId, setSelectedCompanyIdState] = React.useState(() => readStoredCompanyId())

  const persistSelectedCompanyId = React.useCallback((id) => {
    const numeric = Number(id)
    const nextValue = Number.isInteger(numeric) && numeric > 0 ? numeric : null
    const prevValue = readStoredCompanyId()
    setSelectedCompanyIdState(nextValue)
    try {
      if (nextValue) {
        localStorage.setItem(COMPANY_STORAGE_KEY, String(nextValue))
      } else {
        localStorage.removeItem(COMPANY_STORAGE_KEY)
      }
    } catch {
      // ignore storage errors
    }
    // Trocar de empresa muda o tenant de TODAS as queries por-empresa. Sem isso,
    // como as query keys nem sempre incluem o companyId, o cache do React Query
    // devolveria dados da empresa anterior. Limpar o cache força refetch limpo.
    if (prevValue !== nextValue) {
      queryClient.clear()
    }
  }, [])

  // hidrata sessão e valida token
  React.useEffect(() => {
    let mounted = true
    ;(async () => {
      const token = authService.getToken()
      if (!token) { if (mounted) setLoading(false); return }
      try {
        const data = await authService.verify()
        if (!mounted) return
        const u = data?.user ?? data
        setUser(u)
        // se o verify devolveu token/refresh, persista
        if (data?.token) authService.setAuth(data)
        // Para usuários master, manter a empresa selecionada no localStorage
        // Para usuários normais, usar a empresa do token se não houver seleção
        if (u?.role === 'master') {
          // Master: manter a empresa selecionada ou limpar se inválida
          if (selectedCompanyId && !u.company_ids?.includes(selectedCompanyId)) {
            persistSelectedCompanyId(null)
          }
        } else if (u?.company_ids?.length > 0) {
          // Usuário normal: mantém a empresa selecionada se ainda for válida
          // (permite alternar entre várias); senão cai na primeira disponível.
          if (!selectedCompanyId || !u.company_ids.includes(selectedCompanyId)) {
            persistSelectedCompanyId(u.company_ids[0])
          }
        }
      } catch {
        authService.clearToken()
        if (mounted) setUser(null)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  React.useEffect(() => {
    const handler = () => {
      setUser(null)
      setLoading(false)
    }
    window.addEventListener(SESSION_EVENT, handler)
    return () => window.removeEventListener(SESSION_EVENT, handler)
  }, [])

  // 🚀 ADICIONE o login e exponha no context
  const login = async (arg1, arg2) => {
    // aceita login(email, password) OU login({email, password})
    const { email, password } =
      typeof arg1 === 'object' && arg1 !== null
        ? { email: arg1.email, password: arg1.password }
        : { email: arg1, password: arg2 }

    const data = await authService.login(email, password) // faz POST /auth/login
    const u = data?.user ?? data
    setUser(u)

    // Gerenciar empresa selecionada após login
    if (u?.role === 'master') {
      // Master: não selecionar empresa automaticamente, deixar o usuário escolher
      // Limpar seleção anterior se a empresa não estiver mais disponível
      if (selectedCompanyId && !u.company_ids?.includes(selectedCompanyId)) {
        persistSelectedCompanyId(null)
      }
    } else if (u?.company_ids?.length > 0) {
      // Usuário normal: mantém a empresa já selecionada se continuar válida
      // (multi-empresa); caso contrário seleciona a primeira automaticamente.
      if (!selectedCompanyId || !u.company_ids.includes(selectedCompanyId)) {
        persistSelectedCompanyId(u.company_ids[0])
      }
    }
    return data
  }

  const logout = () => {
    authService.clearToken()
    setUser(null)
    persistSelectedCompanyId(null)
  }

  const value = {
    user,
    setUser,
    loading,
    selectedCompanyId,
    setSelectedCompanyId: persistSelectedCompanyId,
    login,         // 👈 agora o LoginPage consegue usar
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
