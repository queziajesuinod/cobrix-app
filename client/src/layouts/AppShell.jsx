import React from 'react'
import {
  AppBar, Toolbar, Typography, IconButton, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText, Box, Divider, useMediaQuery, Collapse
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useNavigate, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import CompanySelector from '@/components/CompanySelector'

// Ícones
import MenuIcon from '@mui/icons-material/Menu'
import HomeIcon from '@mui/icons-material/Home'
import PeopleIcon from '@mui/icons-material/People'
import AssignmentIcon from '@mui/icons-material/Assignment'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import BusinessIcon from '@mui/icons-material/Business'
import LogoutIcon from '@mui/icons-material/Logout'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import SendIcon from '@mui/icons-material/Send'
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined'
import QrCodeIcon from '@mui/icons-material/QrCode'
import EditNoteIcon from '@mui/icons-material/EditNote'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'

const drawerWidth = 264

// agora o navItems também recebe o companyId para montar o link de Config Empresa
const navItems = (role, companyId) => [
  { type: 'item', to: '/dashboard', label: 'Início', icon: <HomeIcon /> },
  { type: 'item', to: '/clients', label: 'Clientes', icon: <PeopleIcon /> },
  { type: 'item', to: '/contracts', label: 'Contratos', icon: <AssignmentIcon /> },
  { type: 'item', to: '/integration/evo', label: 'Integração', icon: <QrCodeIcon /> },

  {
    type: 'group',
    key: 'notifications',
    label: 'Notificações',
    icon: <NotificationsOutlinedIcon />,
    children: [
      { to: '/notifications/auto', label: 'Automático', icon: <AutorenewIcon /> },
      { to: '/notifications/manual', label: 'Manual', icon: <SendIcon /> },
      { to: '/notifications/templates', label: 'Modelos', icon: <EditNoteIcon /> },
    ],
  },

  ...(role === 'master'
    ? [
        {
          type: 'group',
          key: 'admin',
          label: 'Admin',
          icon: <AdminPanelSettingsIcon />,
          children: [
    
            { to: '/companies', label: 'Empresas', icon: <BusinessIcon /> },
          ],
        },
      ]
    : []),
]

export default function AppShell({ children }) {
  const theme = useTheme()
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'))
  const [open, setOpen] = React.useState(isMdUp)
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, selectedCompanyId } = useAuth()

  const [openGroups, setOpenGroups] = React.useState({})

  React.useEffect(() => { setOpen(isMdUp) }, [isMdUp])

  // abre grupo automaticamente quando a rota bater
  React.useEffect(() => {
    const path = location.pathname
    setOpenGroups(prev => ({
      ...prev,
      notifications: prev.notifications ?? path.startsWith('/notifications'),
      admin: prev.admin ?? path.startsWith('/companies'),
    }))
  }, [location.pathname])

  const toggleGroup = (key) => setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }))

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Cobrix</Typography>
        <Typography variant="caption" color="text.secondary">
          USUÁRIO LOGADO: {user?.email}<br />
          
        </Typography>
      </Box>
      <Divider />
      
      {/* Seletor de empresa para usuários master */}
      <CompanySelector />

      <List sx={{ flex: 1 }}>
        {navItems(user?.role, selectedCompanyId).map((item) => {
          if (item.type === 'item') {
            return (
              <ListItemButton
                key={item.to}
                component={NavLink}
                to={item.to}
                sx={{ mx: 1, borderRadius: 1, '&.active': { bgcolor: 'action.selected' } }}
                onClick={() => { if (!isMdUp) setOpen(false) }}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            )
          }

          if (item.type === 'group') {
            const isOpen = !!openGroups[item.key]
            return (
              <React.Fragment key={`group-${item.key}`}>
                <ListItemButton
                  onClick={() => toggleGroup(item.key)}
                  sx={{ mx: 1, borderRadius: 1 }}
                >
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.label} />
                  {isOpen ? <ExpandLess /> : <ExpandMore />}
                </ListItemButton>

                <Collapse in={isOpen} timeout="auto" unmountOnExit>
                  <List component="div" disablePadding>
                    {item.children.map((child) => (
                      <ListItemButton
                        key={child.to}
                        component={NavLink}
                        to={child.to}
                        sx={{ pl: 7, mx: 1, borderRadius: 1, '&.active': { bgcolor: 'action.selected' } }}
                        onClick={() => { if (!isMdUp) setOpen(false) }}
                      >
                        <ListItemIcon>{child.icon}</ListItemIcon>
                        <ListItemText primary={child.label} />
                      </ListItemButton>
                    ))}
                  </List>
                </Collapse>
              </React.Fragment>
            )
          }

          return null
        })}
      </List>

      <Divider />
      <List>
        <ListItemButton onClick={() => { logout(); navigate('/login') }}>
          <ListItemIcon><LogoutIcon /></ListItemIcon>
          <ListItemText primary="Sair" />
        </ListItemButton>
      </List>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Toolbar>
          <IconButton color="inherit" onClick={() => setOpen(!open)} sx={{ mr: 1, display: { md: 'none' } }}>
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Cobrix</Typography>
          <Box sx={{ flexGrow: 1 }} />
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        {isMdUp ? (
          <Drawer
            variant="permanent"
            open
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box', borderRight: '1px solid', borderColor: 'divider' } }}
          >
            {drawer}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={open}
            onClose={() => setOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}
          >
            {drawer}
          </Drawer>
        )}
      </Box>

      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  )
}
