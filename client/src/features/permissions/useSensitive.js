import { usePermissions } from './PermissionsContext'

const MASK = '••••'
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Mascaramento de dados sensíveis conforme permissão de visualização.
//  - money(v): valor numérico → "R$ x" ou "R$ ••••"
//  - phone(v): telefone → o número ou "••••"
export function useSensitive() {
  const { can } = usePermissions()
  const canValues = can('data.viewValues')
  const canPhone = can('data.viewPhone')
  return {
    canValues,
    canPhone,
    money: (v) => (canValues ? brl(v) : `R$ ${MASK}`),
    phone: (v) => (canPhone ? (v || '—') : MASK),
  }
}
