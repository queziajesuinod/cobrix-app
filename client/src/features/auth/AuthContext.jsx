// client/src/features/auth/AuthContext.jsx
import React from 'react'
import { authService } from './auth.service'

const AuthContext = React.createContext(null)

const SESSION_EVENT = 'auth:expired'

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [selectedCompanyId, setSelectedCompanyId] = React.useState(() => {
    try { const raw = localStorage.getItem('selectedCompanyId'); return raw ? Number(raw) : null } catch { return null }
  })

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
            setSelectedCompanyId(null)
            try { localStorage.removeItem('selectedCompanyId') } catch {}
          }
        } else if (u?.company_ids?.length > 0 && !selectedCompanyId) {
          // Usuário normal: usar a primeira empresa disponível
          const defaultCompanyId = u.company_ids[0]
          setSelectedCompanyId(defaultCompanyId)
          try { localStorage.setItem('selectedCompanyId', String(defaultCompanyId)) } catch {}
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
        setSelectedCompanyId(null)
        try { localStorage.removeItem('selectedCompanyId') } catch {}
      }
    } else if (u?.company_ids?.length > 0) {
      // Usuário normal: selecionar automaticamente a primeira empresa
      const defaultCompanyId = u.company_ids[0]
      setSelectedCompanyId(defaultCompanyId)
      try { localStorage.setItem('selectedCompanyId', String(defaultCompanyId)) } catch {}
    }
    return data
  }

  const logout = () => {
    authService.clearToken()
    setUser(null)
    try { localStorage.removeItem('selectedCompanyId') } catch {}
  }

  const value = {
    user,
    setUser,
    loading,
    selectedCompanyId,
    setSelectedCompanyId: (id) => {
      setSelectedCompanyId(id)
      try { localStorage.setItem('selectedCompanyId', String(id)) } catch {}
    },
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
