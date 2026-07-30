import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthContext'
import { permissionsService } from './permissions.service'

const PermissionsContext = React.createContext(null)

export function PermissionsProvider({ children }) {
  const { user } = useAuth()
  const isMaster = user?.role === 'master'

  const { data, isLoading } = useQuery({
    queryKey: ['me-permissions', user?.id],
    queryFn: permissionsService.me,
    enabled: Boolean(user) && !isMaster, // master ignora o gating (tem tudo)
    staleTime: 5 * 60 * 1000,
  })

  const permissions = React.useMemo(() => new Set(data?.permissions || []), [data])

  // Master tem tudo. Enquanto as permissões carregam (não-master), negamos por
  // padrão para não "piscar" botões que o usuário não pode ver.
  const can = React.useCallback(
    (key) => {
      if (isMaster) return true
      if (!key) return true
      return permissions.has(key)
    },
    [isMaster, permissions]
  )

  const value = React.useMemo(
    () => ({ can, isMaster, permissionsLoading: isLoading && !isMaster, permissions }),
    [can, isMaster, isLoading, permissions]
  )

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions() {
  const ctx = React.useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions deve ser usado dentro de <PermissionsProvider>')
  return ctx
}

// Guard declarativo: renderiza `children` só se o usuário tem a permissão.
// Use `fallback` para mostrar algo alternativo (ex.: botão desabilitado).
export function Can({ permission, children, fallback = null }) {
  const { can } = usePermissions()
  return can(permission) ? children : fallback
}
