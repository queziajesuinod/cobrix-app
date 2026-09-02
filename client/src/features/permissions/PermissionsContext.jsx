import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthContext'
import { queryClient } from '@/lib/queryClient'
import { permissionsService } from './permissions.service'

const PermissionsContext = React.createContext(null)
const VIEW_AS_KEY = 'viewAsProfileId'

function readStoredViewAs() {
  try {
    const n = Number(localStorage.getItem(VIEW_AS_KEY))
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function PermissionsProvider({ children }) {
  const { user } = useAuth()
  const realIsMaster = user?.role === 'master'

  // "Ver como perfil": só o master de verdade pode pré-visualizar o sistema com as
  // permissões de um perfil. Guardado no localStorage para o interceptor do axios
  // mandar o header X-View-As-Profile em toda requisição.
  const [previewProfileId, setPreviewProfileIdState] = React.useState(() => (realIsMaster ? readStoredViewAs() : null))
  const isPreviewing = realIsMaster && Boolean(previewProfileId)

  const setPreviewProfileId = React.useCallback((id) => {
    const n = Number(id)
    const val = Number.isInteger(n) && n > 0 ? n : null
    setPreviewProfileIdState(val)
    try {
      if (val) localStorage.setItem(VIEW_AS_KEY, String(val))
      else localStorage.removeItem(VIEW_AS_KEY)
    } catch {
      // ignore storage errors
    }
    // Trocar a prévia muda permissões E o escopo de dados de todas as queries: limpa
    // o cache para tudo recarregar como o perfil escolhido (igual à troca de empresa).
    queryClient.clear()
  }, [])

  // Se o master deixar de ser master (logout/troca), zera a prévia.
  React.useEffect(() => {
    if (!realIsMaster && previewProfileId) setPreviewProfileId(null)
  }, [realIsMaster, previewProfileId, setPreviewProfileId])

  // Busca as permissões efetivas quando NÃO é master, ou quando o master está
  // pré-visualizando um perfil (aí precisa saber o que aquele perfil enxerga).
  const { data, isLoading } = useQuery({
    queryKey: ['me-permissions', user?.id, previewProfileId],
    queryFn: permissionsService.me,
    enabled: Boolean(user) && (!realIsMaster || isPreviewing),
    staleTime: 5 * 60 * 1000,
  })

  const permissions = React.useMemo(() => new Set(data?.permissions || []), [data])
  // Master EFETIVO: master de verdade e fora do modo prévia. Na prévia, o app se
  // comporta como um usuário comum do perfil escolhido.
  const effectiveIsMaster = realIsMaster && !isPreviewing

  const can = React.useCallback(
    (key) => {
      if (effectiveIsMaster) return true
      if (!key) return true
      return permissions.has(key)
    },
    [effectiveIsMaster, permissions]
  )

  const value = React.useMemo(
    () => ({
      can,
      isMaster: effectiveIsMaster,
      realIsMaster,
      isPreviewing,
      previewProfileId,
      setPreviewProfileId,
      permissionsLoading: isLoading && (!realIsMaster || isPreviewing),
      permissions,
    }),
    [can, effectiveIsMaster, realIsMaster, isPreviewing, previewProfileId, setPreviewProfileId, isLoading, permissions]
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
