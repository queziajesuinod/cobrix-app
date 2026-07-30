import React from 'react'
import {
  AppBar, Toolbar, Typography, IconButton, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText, Box, useMediaQuery, Avatar, Menu, MenuItem,
  Tooltip, Badge, InputBase, Breadcrumbs, Link as MuiLink, Divider, ListSubheader,
} from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import { useNavigate, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { useColorMode } from '@/theme/ColorModeProvider'
import CompanySelector from '@/components/CompanySelector'

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
import EditNoteIcon from '@mui/icons-material/EditNote'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import SearchIcon from '@mui/icons-material/Search'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'

const drawerWidth = 268

// Estrutura de navegação em seções (padrão Dandelion).
const buildSections = (role) => [
  {
    label: 'Principal',
    items: [
      { to: '/dashboard', label: 'Início', icon: <HomeIcon /> },
      { to: '/clients', label: 'Clientes', icon: <PeopleIcon /> },
      { to: '/contracts', label: 'Contratos', icon: <AssignmentIcon /> },
      { to: '/contracts/types', label: 'Tipos de contrato', icon: <CategoryIcon /> },
      { to: '/integration/evo', label: 'Integração', icon: <QrCodeIcon /> },
    ],
  },
  {
    label: 'Notificações',
    items: [
      { to: '/notifications/auto', label: 'Automático', icon: <AutorenewIcon /> },
      { to: '/notifications/templates', label: 'Modelos', icon: <EditNoteIcon /> },
      { to: '/billings/paid', label: 'Contratos pagos', icon: <CheckCircleIcon /> },
      { to: '/reports/overdue-clients', label: 'Clientes em atraso', icon: <WarningAmberIcon /> },
    ],
  },
  ...(role === 'master'
    ? [{
        label: 'Admin',
        items: [
          { to: '/companies', label: 'Empresas', icon: <BusinessIcon /> },
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
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, selectedCompanyId } = useAuth()
  const { mode, toggle } = useColorMode()

  const [anchorEl, setAnchorEl] = React.useState(null)

  React.useEffect(() => { setOpen(isMdUp) }, [isMdUp])

  const sections = React.useMemo(() => buildSections(user?.role), [user?.role])
  const current = React.useMemo(() => findCurrent(sections, location.pathname), [sections, location.pathname])

  const userEmail = user?.email || ''
  const userName = user?.name || ''
  const displayName = userName || userEmail || 'Usuário'
  const initials = (displayName.trim()[0] || 'U').toUpperCase()
  const roleLabel = user?.role === 'master' ? 'Administrador' : 'Usuário'

  // Cor de destaque do item ativo (segue o tema).
  const activeBg = alpha(theme.palette.primary.main, mode === 'dark' ? 0.24 : 0.12)

  const drawer = (
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
      <Box sx={{ px: 2.5, py: 2.25, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: '10px', background: 'linear-gradient(135deg,#5b8def,#8E2DE2)' }} />
        <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 0.3 }}>Cobrix</Typography>
      </Box>

      {/* Bloco de perfil */}
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

      {/* Seletor de empresa (master) */}
      <CompanySelector />

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
        {sections.map((section) => (
          <List
            key={section.label}
            subheader={
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
            }
            sx={{ px: 1.25 }}
          >
            {section.items.map((item) => (
              <ListItemButton
                key={item.to}
                component={NavLink}
                to={item.to}
                end
                onClick={() => { if (!isMdUp) setOpen(false) }}
                sx={{
                  mb: 0.5,
                  borderRadius: 2,
                  color: 'text.secondary',
                  '& .MuiListItemIcon-root': { color: 'text.secondary', minWidth: 40 },
                  '&:hover': { bgcolor: 'action.hover' },
                  '&.active': {
                    bgcolor: activeBg,
                    color: 'primary.main',
                    '& .MuiListItemIcon-root': { color: 'primary.main' },
                  },
                }}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} />
              </ListItemButton>
            ))}
          </List>
        ))}
      </Box>

      <Divider />
      <List sx={{ px: 1.25 }}>
        <ListItemButton
          onClick={() => { logout(); navigate('/login') }}
          sx={{ borderRadius: 2, color: 'text.secondary', '& .MuiListItemIcon-root': { color: 'text.secondary', minWidth: 40 } }}
        >
          <ListItemIcon><LogoutIcon /></ListItemIcon>
          <ListItemText primary="Sair" primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} />
        </ListItemButton>
      </List>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton
            onClick={() => setOpen(!open)}
            sx={{
              display: { md: 'none' },
              color: 'primary.contrastText',
              bgcolor: 'primary.main',
              '&:hover': { bgcolor: 'primary.dark' },
            }}
            size="small"
          >
            <MenuIcon />
          </IconButton>

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

          {/* Busca (visual — busca global em breve) */}
          <Box
            sx={{
              display: { xs: 'none', sm: 'flex' },
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              height: 40,
              borderRadius: 999,
              bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
            }}
          >
            <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            <InputBase placeholder="Buscar…" sx={{ fontSize: 14, width: { sm: 120, md: 200 } }} />
          </Box>

          <Tooltip title="Notificações">
            <IconButton color="inherit" onClick={() => navigate('/notifications/auto')}>
              <Badge color="error" variant="dot">
                <NotificationsNoneIcon />
              </Badge>
            </IconButton>
          </Tooltip>

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
            <MenuItem onClick={() => { setAnchorEl(null); logout(); navigate('/login') }}>
              <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
              Sair
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        {isMdUp ? (
          <Drawer
            variant="permanent"
            open
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box', border: 'none' } }}
          >
            {drawer}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={open}
            onClose={() => setOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box', border: 'none' } }}
          >
            {drawer}
          </Drawer>
        )}
      </Box>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, width: { md: `calc(100% - ${drawerWidth}px)` } }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  )
}
