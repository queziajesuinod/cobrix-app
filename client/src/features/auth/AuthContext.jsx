import React from 'react'
import { authService } from './auth.service'

const AuthContext = React.createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [selectedCompanyId, setSelectedCompanyId] = React.useState(() => {
    try { const raw = localStorage.getItem('selectedCompanyId'); return raw ? Number(raw) : null } catch { return null }
  })

  React.useEffect(() => {
    let mounted = true
    async function init() {
      const token = authService.getToken()
      if (!token) { if (mounted) setLoading(false); return }
      try {
        const data = await authService.verify()
        if (mounted) {
          setUser(data.user ?? data)
          if (data?.token) authService.setAuth(data)
          if (data?.user?.company_id && !selectedCompanyId) {
            setSelectedCompanyId(data.user.company_id)
            try { localStorage.setItem('selectedCompanyId', String(data.user.company_id)) } catch {}
          }
        }
      } catch (e) {
        authService.clearToken()
        if (mounted) setUser(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    init()
    return () => { mounted = false }
  }, [])

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
    logout
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  console.log('useAuth called');
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}