import React from 'react'
import {
  AppBar, Toolbar, Typography, IconButton, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText, Box, useMediaQuery, Avatar, Menu, MenuItem,
  Tooltip, Badge, Breadcrumbs, Link as MuiLink, Divider, ListSubheader, Button, Chip,
} from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import { useNavigate, NavLink, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { useColorMode } from '@/theme/ColorModeProvider'
import CompanySelector from '@/components/CompanySelector'
import { notificationsService } from '@/features/notifications/notifications.service'
import { companyService } from '@/features/companies/company.service'
import HandshakeIcon from '@mui/icons-material/Handshake'
import { tasksService } from '@/features/tasks/tasks.service'
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn'
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail'
import LeaderboardIcon from '@mui/icons-material/Leaderboard'
import { menuService } from '@/features/menu/menu.service'

// Ícones
import MenuIcon from '@mui/icons-material/Menu'
import HomeIcon from '@mui/icons-material/Home'
import PeopleIcon from '@mui/icons-material/People'
import AssignmentIcon from '@mui/icons-material/Assignment'
import CategoryIcon from '@mui/icons-material/Category'
import BusinessIcon from '@mui/icons-material/Business'
import LogoutIcon from '@mui/icons-material/Logout'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import QrCodeIcon from '@mui/icons-material/QrCode'
import ExtensionIcon from '@mui/icons-material/Extension'
import LayersIcon from '@mui/icons-material/Layers'
import EditNoteIcon from '@mui/icons-material/EditNote'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1'
import PostAddIcon from '@mui/icons-material/PostAdd'
import InsightsIcon from '@mui/icons-material/Insights'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import GroupIcon from '@mui/icons-material/Group'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import ViewKanbanIcon from '@mui/icons-material/ViewKanban'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'

const drawerWidth = 268
const miniWidth = 76

// Etiqueta "Novo" nos itens de menu: aparece por N dias a partir da data de
// publicação (campo `since: 'AAAA-MM-DD'` no item). É "versionada" — defina a
// data uma vez ao publicar o módulo; a etiqueta some sozinha após o prazo, sem
// nenhuma alteração manual depois.
const NEW_BADGE_DAYS = 7
function isNewItem(since) {
  if (!since) return false
  const d = new Date(`${since}T00:00:00`)
  if (Number.isNaN(d.getTime())) return false
  const ms = Date.now() - d.getTime()
  return ms >= 0 && ms <= NEW_BADGE_DAYS * 24 * 60 * 60 * 1000
}

// Estrutura de navegação em seções (padrão Dandelion). `perm` = permissão de
// acesso à tela (usada para filtrar o menu e barrar acesso). Itens sem `perm`
// (área master) não passam pelo filtro de permissão.
const buildSections = (role, isPartner) => [
  {
    label: 'Principal',
    items: [
      { to: '/dashboard', label: 'Início', icon: <HomeIcon />, perm: 'dashboard.view' },
      { to: '/clients', label: 'Clientes', icon: <PeopleIcon />, perm: 'clients.view' },
      { to: '/contracts', label: 'Contratos', icon: <AssignmentIcon />, perm: 'contracts.view' },
      { to: '/contracts/types', label: 'Tipos de contrato', icon: <CategoryIcon />, perm: 'contractTypes.view' },
      { to: '/integrations', label: 'Integrações', icon: <ExtensionIcon />, perm: 'integration.view' },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { to: '/cadastro', label: 'Novo cadastro', icon: <PersonAddAlt1Icon />, perm: 'cadastro.view' },
    ],
  },
  {
    label: 'Notificações',
    items: [
      { to: '/notifications/auto', label: 'Automático', icon: <AutorenewIcon />, perm: 'notifications.auto.view' },
      { to: '/notifications/templates', label: 'Modelos', icon: <EditNoteIcon />, perm: 'notifications.templates.view' },
      { to: '/billings/paid', label: 'Contratos pagos', icon: <CheckCircleIcon />, perm: 'billings.paid.view' },
      { to: '/reports/overdue-clients', label: 'Inadimplentes', icon: <WarningAmberIcon />, perm: 'reports.overdue.view' },
    ],
  },
  {
    label: 'Inteligência',
    items: [
      { to: '/reports/risk', label: 'Carteira em risco', icon: <InsightsIcon />, perm: 'reports.risk.view', since: '2026-07-30' },
    ],
  },
  {
    label: 'Administração',
    items: [
      { to: '/admin/users', label: 'Usuários', icon: <GroupIcon />, perm: 'users.view', since: '2026-07-30' },
    ],
  },
  {
    label: 'Tarefas',
    items: [
      { to: '/tasks', label: 'Gerenciador de Tarefas', icon: <ViewKanbanIcon />, perm: 'tasks.view', since: '2026-08-04' },
      { to: '/tasks/productivity', label: 'Produtividade', icon: <LeaderboardIcon />, perm: 'tasks.gestor', since: '2026-08-08' },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { to: '/finance/dashboard', label: 'Dashboard Financeiro', icon: <QueryStatsIcon />, perm: 'finance.dashboard.view', since: '2026-07-30' },
      { to: '/finance', label: 'Gerenciador Financeiro', icon: <AccountBalanceIcon />, perms: ['finance.revenues.view', 'finance.expenses.view', 'finance.resumo.view'], since: '2026-07-30' },
    ],
  },
  ...(isPartner
    ? [{
        label: 'Revenda',
        items: [
          { to: '/partner', label: 'Meu portal', icon: <HandshakeIcon />, perm: 'partner.portal.view', since: '2026-08-19' },
          { to: '/commissions', label: 'Comissões', icon: <ReceiptLongIcon />, perm: 'partner.portal.view', since: '2026-08-19' },
        ],
      }]
    : []),
  ...(role === 'master'
    ? [{
        label: 'Admin',
        items: [
          { to: '/companies', label: 'Empresas', icon: <BusinessIcon /> },
          { to: '/admin/plans', label: 'Planos', icon: <LayersIcon /> },
          { to: '/admin/coupons', label: 'Cupons', icon: <LocalOfferIcon />, since: '2026-08-19' },
          { to: '/admin/subscriptions', label: 'Assinaturas', icon: <ReceiptLongIcon />, since: '2026-08-04' },
          { to: '/commissions', label: 'Comissões', icon: <ReceiptLongIcon />, since: '2026-08-19' },
          { to: '/admin/permissions', label: 'Perfis e permissões', icon: <AdminPanelSettingsIcon /> },
          { to: '/system/health', label: 'Saúde do sistema', icon: <MonitorHeartIcon /> },
        ],
      }]
    : []),
]

// Encontra o item de navegação correspondente à rota atual (match exato ou por prefixo).
function findCurrent(sections, pathname) {
  const flat = sections.flatMap((s) => s.items.map((it) => ({ ...it, section: s.label })))
  const exact = flat.find((it) => it.to === pathname)
  if (exact) return exact
  const byPrefix = flat
    .filter((it) => pathname.startsWith(it.to))
    .sort((a, b) => b.to.length - a.to.length)[0]
  return byPrefix || null
}

export default function AppShell({ children }) {
  const theme = useTheme()
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'))
  const [open, setOpen] = React.useState(isMdUp)
  // Sidebar "mini" (só ícones) no desktop — preferência persistida.
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === '1' } catch { return false }
  })
  const toggleCollapsed = () => setCollapsed((c) => {
    const next = !c
    try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0') } catch { /* ignore */ }
    return next
  })
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, selectedCompanyId } = useAuth()
  const { can } = usePermissions()
  const { mode, toggle } = useColorMode()

  const [anchorEl, setAnchorEl] = React.useState(null)
  const [notifAnchor, setNotifAnchor] = React.useState(null)
  const [myTasksAnchor, setMyTasksAnchor] = React.useState(null)

  React.useEffect(() => { setOpen(isMdUp) }, [isMdUp])

  // Notificações in-app (sino). Poll leve enquanto uma empresa está selecionada.
  const qc = useQueryClient()
  const { data: notifData } = useQuery({
    queryKey: ['app-notifications', selectedCompanyId],
    queryFn: notificationsService.list,
    enabled: Boolean(selectedCompanyId),
    refetchInterval: 60000,
  })
  const notifications = notifData?.items || []
  const unreadCount = notifData?.unreadCount || 0

  // Minhas tarefas (pop-up do topo): só as tarefas em que sou responsável, por prazo.
  const canTasks = can('tasks.view')
  const { data: myTasks } = useQuery({
    queryKey: ['tasks-my', selectedCompanyId],
    queryFn: () => tasksService.my(),
    enabled: Boolean(selectedCompanyId) && canTasks,
    refetchInterval: 60000,
  })
  const myCount = myTasks?.counts?.total || 0
  const TASK_PRIO = { baixa: { l: 'Baixa', c: 'default' }, media: { l: 'Média', c: 'info' }, alta: { l: 'Alta', c: 'warning' }, urgente: { l: 'Urgente', c: 'error' } }
  const fmtTaskDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10).split('-').reverse().join('/') : '')

  // Etiqueta "Novo": aparece na janela de publicação E some quando o usuário
  // abre o item (registro por usuário, persistido no backend).
  const { data: seenData } = useQuery({
    queryKey: ['menu-seen'],
    queryFn: menuService.getSeen,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  })
  const seenKeys = React.useMemo(() => new Set(seenData?.keys || []), [seenData])
  const markSeen = useMutation({
    mutationFn: (key) => menuService.markSeen(key),
    onMutate: (key) => {
      qc.setQueryData(['menu-seen'], (old) => ({ keys: [...new Set([...(old?.keys || []), key])] }))
    },
  })
  const showNewBadge = (item) => isNewItem(item.since) && !seenKeys.has(item.to)

  const notifIcon = (type) => {
    if (type === 'client_created') return <PersonAddAlt1Icon fontSize="small" color="primary" />
    if (type === 'contract_due_today') return <AssignmentIcon fontSize="small" color="info" />
    if (type === 'billing_overdue_60') return <WarningAmberIcon fontSize="small" color="warning" />
    if (type === 'task_mention') return <AlternateEmailIcon fontSize="small" color="primary" />
    if (type === 'task_assigned' || type === 'task_comment' || type === 'task_due') return <AssignmentTurnedInIcon fontSize="small" color="info" />
    return <NotificationsNoneIcon fontSize="small" />
  }

  const handleNotifClick = async (n) => {
    setNotifAnchor(null)
    try { await notificationsService.markRead(n.id) } catch { /* ignore */ }
    qc.invalidateQueries({ queryKey: ['app-notifications'] })
    if (n.link) navigate(n.link)
  }

  const handleMarkAll = async () => {
    try { await notificationsService.markAllRead() } catch { /* ignore */ }
    qc.invalidateQueries({ queryKey: ['app-notifications'] })
  }

  // Empresa selecionada é parceira? Libera a seção "Revenda" (portal + comissões).
  const companyQ = useQuery({
    queryKey: ['appshell-company', selectedCompanyId],
    queryFn: () => companyService.get(selectedCompanyId),
    enabled: Boolean(selectedCompanyId),
    staleTime: 60000,
  })
  const isPartner = Boolean(companyQ.data?.is_partner)

  const sections = React.useMemo(() => buildSections(user?.role, isPartner), [user?.role, isPartner])
  // Um item aparece se o usuário tem sua permissão (ou QUALQUER uma de `perms`).
  const canNav = React.useCallback((it) => (it?.perms ? it.perms.some((p) => can(p)) : can(it?.perm)), [can])
  const visibleSections = React.useMemo(
    () =>
      sections
        .map((s) => ({ ...s, items: s.items.filter((it) => canNav(it)) }))
        .filter((s) => s.items.length > 0),
    [sections, canNav]
  )
  const current = React.useMemo(() => findCurrent(sections, location.pathname), [sections, location.pathname])
  const pageAllowed = !current || canNav(current)

  const userEmail = user?.email || ''
  const userName = user?.name || ''
  const displayName = userName || userEmail || 'Usuário'
  const initials = (displayName.trim()[0] || 'U').toUpperCase()
  const roleLabel = user?.role === 'master' ? 'Administrador' : 'Usuário'

  // Cor de destaque do item ativo (segue o tema).
  const activeBg = alpha(theme.palette.primary.main, mode === 'dark' ? 0.24 : 0.12)

  // `mini` = sidebar recolhida (só no desktop). Define a largura efetiva usada
  // pela AppBar, pelo main e pela própria gaveta.
  const mini = isMdUp && collapsed
  const navWidth = mini ? miniWidth : drawerWidth

  const drawerContent = (compact) => (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        color: 'text.primary',
        borderRight: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Logo */}
      <Box sx={{ px: compact ? 0 : 2.5, py: 2.25, display: 'flex', alignItems: 'center', justifyContent: compact ? 'center' : 'flex-start', gap: 1 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: '10px', flexShrink: 0, background: 'linear-gradient(135deg,#5b8def,#8E2DE2)' }} />
        {!compact && <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 0.3 }}>Cobrix</Typography>}
      </Box>

      {/* Bloco de perfil */}
      {compact ? (
        <Box sx={{ pb: 2, textAlign: 'center' }}>
          <Tooltip title={`${displayName} · ${roleLabel}`} placement="right">
            <Avatar sx={{ width: 40, height: 40, mx: 'auto', bgcolor: 'primary.main', fontSize: 16, fontWeight: 700 }}>
              {initials}
            </Avatar>
          </Tooltip>
        </Box>
      ) : (
        <Box sx={{ px: 2, pb: 2, textAlign: 'center' }}>
          <Avatar sx={{ width: 64, height: 64, mx: 'auto', mb: 1, bgcolor: 'primary.main', fontSize: 26, fontWeight: 700 }}>
            {initials}
          </Avatar>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, wordBreak: 'break-word' }} noWrap>
            {displayName}
          </Typography>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#4caf50' }} />
            <Typography variant="caption" color="text.secondary">{roleLabel} · Online</Typography>
          </Box>
        </Box>
      )}

      {/* Seletor de empresa (master) — oculto no modo mini */}
      {!compact && <CompanySelector />}

      {/* Navegação em seções — scroll sem barra visível */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          py: 1,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { width: 0, height: 0, display: 'none' },
        }}
      >
        {visibleSections.map((section) => (
          <List
            key={section.label}
            subheader={
              compact ? null : (
                <ListSubheader
                  disableSticky
                  sx={{
                    bgcolor: 'transparent',
                    color: '#ec407a',
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    lineHeight: '32px',
                  }}
                >
                  {section.label}
                </ListSubheader>
              )
            }
            sx={{ px: compact ? 0.75 : 1.25 }}
          >
            {section.items.map((item) => (
              <Tooltip key={item.to} title={compact ? item.label : ''} placement="right" disableHoverListener={!compact}>
                <ListItemButton
                  component={NavLink}
                  to={item.to}
                  end
                  onClick={() => {
                    if (showNewBadge(item)) markSeen.mutate(item.to)
                    if (!isMdUp) setOpen(false)
                  }}
                  sx={{
                    mb: 0.5,
                    borderRadius: 2,
                    color: 'text.secondary',
                    justifyContent: compact ? 'center' : 'flex-start',
                    px: compact ? 1 : 2,
                    '& .MuiListItemIcon-root': { color: 'text.secondary', minWidth: compact ? 0 : 40 },
                    '&:hover': { bgcolor: 'action.hover' },
                    '&.active': {
                      bgcolor: activeBg,
                      color: 'primary.main',
                      '& .MuiListItemIcon-root': { color: 'primary.main' },
                    },
                  }}
                >
                  <ListItemIcon sx={{ justifyContent: 'center' }}>{item.icon}</ListItemIcon>
                  {!compact && <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} />}
                  {!compact && showNewBadge(item) && (
                    <Chip
                      label="Novo"
                      size="small"
                      sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: '#ec407a', color: '#fff', '& .MuiChip-label': { px: 0.75 } }}
                    />
                  )}
                </ListItemButton>
              </Tooltip>
            ))}
          </List>
        ))}
      </Box>

      <Divider />
      <List sx={{ px: compact ? 0.75 : 1.25 }}>
        <Tooltip title={compact ? 'Sair' : ''} placement="right" disableHoverListener={!compact}>
          <ListItemButton
            onClick={() => { logout(); navigate('/login') }}
            sx={{
              borderRadius: 2,
              color: 'text.secondary',
              justifyContent: compact ? 'center' : 'flex-start',
              px: compact ? 1 : 2,
              '& .MuiListItemIcon-root': { color: 'text.secondary', minWidth: compact ? 0 : 40 },
            }}
          >
            <ListItemIcon sx={{ justifyContent: 'center' }}><LogoutIcon /></ListItemIcon>
            {!compact && <ListItemText primary="Sair" primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} />}
          </ListItemButton>
        </Tooltip>
      </List>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { md: `calc(100% - ${navWidth}px)` },
          ml: { md: `${navWidth}px` },
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderBottom: '1px solid',
          borderColor: 'divider',
          transition: theme.transitions.create(['width', 'margin']),
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <Tooltip title={isMdUp ? (collapsed ? 'Expandir menu' : 'Recolher menu') : 'Menu'}>
            <IconButton
              onClick={() => (isMdUp ? toggleCollapsed() : setOpen(!open))}
              sx={{
                color: 'primary.contrastText',
                bgcolor: 'primary.main',
                '&:hover': { bgcolor: 'primary.dark' },
              }}
              size="small"
            >
              <MenuIcon />
            </IconButton>
          </Tooltip>

          {/* Breadcrumb */}
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.1 }} noWrap>
              {current?.label || 'Início'}
            </Typography>
            <Breadcrumbs separator="›" sx={{ fontSize: 12, '& .MuiBreadcrumbs-li': { fontSize: 12 } }}>
              <MuiLink component={NavLink} to="/dashboard" underline="hover" color="text.secondary" sx={{ fontSize: 12 }}>
                Cobrix
              </MuiLink>
              {current?.section && (
                <Typography color="text.secondary" sx={{ fontSize: 12 }}>{current.section}</Typography>
              )}
              {current?.label && (
                <Typography color="text.primary" sx={{ fontSize: 12, fontWeight: 600 }}>{current.label}</Typography>
              )}
            </Breadcrumbs>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          {canTasks && (
            <>
              <Tooltip title="Minhas tarefas">
                <IconButton color="inherit" onClick={(e) => setMyTasksAnchor(e.currentTarget)}>
                  <Badge color="warning" badgeContent={myCount} max={99}>
                    <AssignmentTurnedInIcon />
                  </Badge>
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={myTasksAnchor}
                open={Boolean(myTasksAnchor)}
                onClose={() => setMyTasksAnchor(null)}
                slotProps={{ paper: { sx: { width: 400, maxWidth: '92vw', maxHeight: '70vh' } } }}
              >
                <Box sx={{ px: 2, py: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Minhas tarefas</Typography>
                  <Typography variant="caption" color="text.secondary">Onde você é o responsável</Typography>
                </Box>
                <Divider />
                {myCount === 0 ? (
                  <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Nada vencendo atribuído a você 🎉</Typography>
                  </Box>
                ) : (
                  [
                    { key: 'atrasada', label: 'ATRASADAS', color: 'error.main', list: myTasks?.atrasada || [] },
                    { key: 'hoje', label: 'VENCE HOJE', color: 'warning.main', list: myTasks?.hoje || [] },
                    { key: 'prox7', label: 'PRÓXIMOS 7 DIAS', color: 'info.main', list: myTasks?.prox7 || [] },
                  ].filter((g) => g.list.length).map((g) => (
                    <Box key={g.key}>
                      <Typography variant="overline" sx={{ px: 2, pt: 1, display: 'block', color: g.color, fontWeight: 700, lineHeight: 2 }}>
                        {g.label} ({g.list.length})
                      </Typography>
                      {g.list.map((t) => {
                        const p = TASK_PRIO[t.priority] || TASK_PRIO.media
                        return (
                          <MenuItem key={t.id} onClick={() => { setMyTasksAnchor(null); navigate(`/tasks?open=${t.id}`) }} sx={{ whiteSpace: 'normal', alignItems: 'flex-start', gap: 1, py: 1 }}>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.title}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {t.group_name || 'Avulsa'}{t.due_date ? ` · ${fmtTaskDate(t.due_date)}` : ''}
                              </Typography>
                            </Box>
                            <Chip size="small" label={p.l} color={p.c} variant="outlined" sx={{ height: 20 }} />
                          </MenuItem>
                        )
                      })}
                    </Box>
                  ))
                )}
                <Divider />
                <MenuItem onClick={() => { setMyTasksAnchor(null); navigate('/tasks') }} sx={{ justifyContent: 'center', color: 'primary.main', fontWeight: 600 }}>
                  Ver todas as minhas tarefas
                </MenuItem>
              </Menu>
            </>
          )}

          <Tooltip title="Notificações">
            <IconButton color="inherit" onClick={(e) => setNotifAnchor(e.currentTarget)}>
              <Badge color="error" badgeContent={unreadCount} max={99}>
                <NotificationsNoneIcon />
              </Badge>
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={notifAnchor}
            open={Boolean(notifAnchor)}
            onClose={() => setNotifAnchor(null)}
            slotProps={{ paper: { sx: { width: 380, maxWidth: '92vw' } } }}
          >
            <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Notificações</Typography>
              {unreadCount > 0 && (
                <Button size="small" onClick={handleMarkAll} sx={{ textTransform: 'none' }}>
                  Marcar todas como lidas
                </Button>
              )}
            </Box>
            <Divider />
            {notifications.length === 0 ? (
              <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">Nenhuma notificação nova</Typography>
              </Box>
            ) : (
              notifications.map((n) => (
                <MenuItem
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  sx={{ whiteSpace: 'normal', alignItems: 'flex-start', gap: 1, py: 1.1 }}
                >
                  <ListItemIcon sx={{ mt: 0.3, minWidth: 32 }}>{notifIcon(n.type)}</ListItemIcon>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{n.title}</Typography>
                    {n.body && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {n.body}
                      </Typography>
                    )}
                  </Box>
                </MenuItem>
              ))
            )}
          </Menu>

          <Tooltip title={mode === 'dark' ? 'Modo claro' : 'Modo escuro'}>
            <IconButton color="inherit" onClick={toggle} aria-label="alternar tema">
              {mode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
            </IconButton>
          </Tooltip>

          <Tooltip title="Conta">
            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} sx={{ p: 0.5 }}>
              <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 15, fontWeight: 700 }}>{initials}</Avatar>
            </IconButton>
          </Tooltip>
          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{displayName}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{userEmail}</Typography>
            </Box>
            <Divider />
            {user?.role !== 'master' && (
              <MenuItem onClick={() => { setAnchorEl(null); navigate('/minha-assinatura') }}>
                <ListItemIcon><ReceiptLongIcon fontSize="small" /></ListItemIcon>
                Minha assinatura
              </MenuItem>
            )}
            <MenuItem onClick={() => { setAnchorEl(null); logout(); navigate('/login') }}>
              <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
              Sair
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: navWidth }, flexShrink: { md: 0 }, transition: theme.transitions.create('width') }}>
        {isMdUp ? (
          <Drawer
            variant="permanent"
            open
            sx={{ '& .MuiDrawer-paper': { width: navWidth, boxSizing: 'border-box', border: 'none', overflowX: 'hidden', transition: theme.transitions.create('width') } }}
          >
            {drawerContent(mini)}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={open}
            onClose={() => setOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box', border: 'none' } }}
          >
            {drawerContent(false)}
          </Drawer>
        )}
      </Box>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, width: { md: `calc(100% - ${navWidth}px)` } }}>
        <Toolbar />
        {pageAllowed ? children : (
          <Box sx={{ py: 10, textAlign: 'center', color: 'text.secondary' }}>
            <LockOutlinedIcon sx={{ fontSize: 48, opacity: 0.4 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, mt: 1 }}>Sem acesso a esta tela</Typography>
            <Typography variant="body2">Seu perfil não tem permissão para acessar esta área. Fale com o administrador.</Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}
