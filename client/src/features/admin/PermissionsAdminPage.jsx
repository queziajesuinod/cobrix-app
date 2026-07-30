import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControlLabel, Grid, IconButton, List, ListItemButton, MenuItem,
  Paper, Select, Snackbar, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SaveIcon from '@mui/icons-material/Save'
import TuneIcon from '@mui/icons-material/Tune'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import { useAuth } from '@/features/auth/AuthContext'
import { useConfirm } from '@/components/ConfirmDialog'
import { permissionsService } from '@/features/permissions/permissions.service'

function ProfilesTab({ notify }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [selectedId, setSelectedId] = React.useState(null)
  const [name, setName] = React.useState('')
  const [permSet, setPermSet] = React.useState(() => new Set())

  const catalogQ = useQuery({ queryKey: ['perm-catalog'], queryFn: permissionsService.catalog })
  const profilesQ = useQuery({ queryKey: ['perm-profiles'], queryFn: permissionsService.listProfiles })
  const profiles = profilesQ.data?.profiles || []
  const catalog = catalogQ.data?.catalog || []

  React.useEffect(() => {
    if (selectedId == null && profiles.length) setSelectedId(profiles[0].id)
  }, [profiles, selectedId])

  const detailQ = useQuery({
    queryKey: ['perm-profile', selectedId],
    queryFn: () => permissionsService.getProfile(selectedId),
    enabled: Number.isInteger(selectedId),
  })
  React.useEffect(() => {
    if (detailQ.data) {
      setName(detailQ.data.name || '')
      setPermSet(new Set(detailQ.data.permissions || []))
    }
  }, [detailQ.data])

  const selected = profiles.find((p) => p.id === selectedId)

  const savePerms = useMutation({
    mutationFn: () => permissionsService.setProfilePermissions(selectedId, [...permSet]),
    onSuccess: () => { notify('Permissões salvas.'); qc.invalidateQueries({ queryKey: ['perm-profiles'] }); qc.invalidateQueries({ queryKey: ['me-permissions'] }) },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error'),
  })
  const rename = useMutation({
    mutationFn: () => permissionsService.renameProfile(selectedId, name.trim()),
    onSuccess: () => { notify('Nome atualizado.'); qc.invalidateQueries({ queryKey: ['perm-profiles'] }) },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao renomear.', 'error'),
  })
  const create = useMutation({
    mutationFn: (n) => permissionsService.createProfile(n),
    onSuccess: (p) => { notify('Perfil criado.'); qc.invalidateQueries({ queryKey: ['perm-profiles'] }); setSelectedId(p.id) },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao criar.', 'error'),
  })
  const remove = useMutation({
    mutationFn: () => permissionsService.deleteProfile(selectedId),
    onSuccess: () => { notify('Perfil excluído.'); setSelectedId(null); qc.invalidateQueries({ queryKey: ['perm-profiles'] }) },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error'),
  })

  const toggle = (key) => setPermSet((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleModule = (mod, on) => setPermSet((s) => {
    const n = new Set(s)
    mod.permissions.forEach((p) => (on ? n.add(p.key) : n.delete(p.key)))
    return n
  })

  const handleNew = async () => {
    const ok = await confirm({ title: 'Novo perfil', description: 'Criar um novo perfil em branco?', confirmText: 'Criar' })
    if (ok) create.mutate(`Novo perfil ${profiles.length + 1}`)
  }
  const handleDelete = async () => {
    const ok = await confirm({ title: 'Excluir perfil', description: `Excluir o perfil "${selected?.name}"?`, confirmText: 'Excluir', tone: 'danger' })
    if (ok) remove.mutate()
  }

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={4}>
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontWeight: 700 }}>Perfis</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={handleNew} sx={{ textTransform: 'none' }}>Novo</Button>
          </Box>
          <Divider />
          <List disablePadding>
            {profiles.map((p) => (
              <ListItemButton key={p.id} selected={p.id === selectedId} onClick={() => setSelectedId(p.id)} sx={{ px: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }} noWrap>{p.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {p.permission_count} permissão(ões) · {p.user_count} usuário(s)
                  </Typography>
                </Box>
                {p.is_system && <Chip label="sistema" size="small" variant="outlined" />}
              </ListItemButton>
            ))}
            {!profiles.length && <Box sx={{ p: 2, color: 'text.secondary' }}>Nenhum perfil.</Box>}
          </List>
        </Paper>
      </Grid>

      <Grid item xs={12} md={8}>
        {!selected ? (
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 4, textAlign: 'center', color: 'text.secondary' }}>
            Selecione um perfil para editar as permissões.
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ borderRadius: 3 }}>
            <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" label="Nome do perfil" value={name} onChange={(e) => setName(e.target.value)} sx={{ flex: 1, minWidth: 200 }} />
              <Button variant="outlined" onClick={() => rename.mutate()} disabled={rename.isPending || !name.trim()}>Renomear</Button>
              <Tooltip title={selected.is_system ? 'Perfil do sistema não pode ser excluído' : (selected.user_count > 0 ? 'Perfil em uso' : 'Excluir perfil')}>
                <span>
                  <IconButton color="error" onClick={handleDelete} disabled={selected.is_system || selected.user_count > 0}>
                    <DeleteOutlineIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
            <Divider />
            <Box sx={{ p: 2, maxHeight: 460, overflowY: 'auto' }}>
              {detailQ.isLoading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></Box>
              ) : (
                catalog.map((mod) => {
                  const total = mod.permissions.length
                  const on = mod.permissions.filter((p) => permSet.has(p.key)).length
                  return (
                    <Box key={mod.module} sx={{ mb: 1.5 }}>
                      <FormControlLabel
                        control={<Checkbox indeterminate={on > 0 && on < total} checked={on === total} onChange={(e) => toggleModule(mod, e.target.checked)} />}
                        label={<Typography sx={{ fontWeight: 700 }}>{mod.label}</Typography>}
                      />
                      <Stack sx={{ pl: 4 }}>
                        {mod.permissions.map((p) => (
                          <FormControlLabel
                            key={p.key}
                            control={<Checkbox size="small" checked={permSet.has(p.key)} onChange={() => toggle(p.key)} />}
                            label={
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Typography variant="body2">{p.label}</Typography>
                                <Chip
                                  label={p.type === 'view' ? 'tela' : p.type === 'data' ? 'dado' : 'ação'}
                                  size="small" variant="outlined"
                                  color={p.type === 'view' ? 'default' : p.type === 'data' ? 'warning' : 'primary'}
                                  sx={{ height: 18, fontSize: 10 }}
                                />
                              </Stack>
                            }
                          />
                        ))}
                      </Stack>
                    </Box>
                  )
                })
              )}
            </Box>
            <Divider />
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={() => savePerms.mutate()} disabled={savePerms.isPending} disableElevation>
                Salvar permissões
              </Button>
            </Box>
          </Paper>
        )}
      </Grid>
    </Grid>
  )
}

function OverridesDialog({ userId, userLabel, catalog, onClose, notify }) {
  const qc = useQueryClient()
  const [state, setState] = React.useState({}) // key -> 'inherit' | 'allow' | 'deny'
  const q = useQuery({ queryKey: ['perm-overrides', userId], queryFn: () => permissionsService.getUserOverrides(userId), enabled: Boolean(userId) })
  React.useEffect(() => {
    const map = {}
    ;(q.data?.overrides || []).forEach((o) => { map[o.permission_key] = o.allowed ? 'allow' : 'deny' })
    setState(map)
  }, [q.data])

  const save = useMutation({
    mutationFn: () => {
      const overrides = Object.entries(state)
        .filter(([, v]) => v === 'allow' || v === 'deny')
        .map(([key, v]) => ({ key, allowed: v === 'allow' }))
      return permissionsService.setUserOverrides(userId, overrides)
    },
    onSuccess: () => { notify('Overrides salvos.'); qc.invalidateQueries({ queryKey: ['me-permissions'] }); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error'),
  })

  const setVal = (key, v) => setState((s) => ({ ...s, [key]: v }))

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Overrides — {userLabel}</DialogTitle>
      <DialogContent dividers sx={{ maxHeight: 460 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          "Herdar" segue o perfil. "Permitir"/"Negar" sobrescrevem para este usuário.
        </Typography>
        {catalog.map((mod) => (
          <Box key={mod.module} sx={{ mb: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 0.5 }}>{mod.label}</Typography>
            {mod.permissions.map((p) => (
              <Box key={p.key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, py: 0.5 }}>
                <Typography variant="body2" sx={{ minWidth: 0 }}>{p.label}</Typography>
                <ToggleButtonGroup size="small" exclusive value={state[p.key] || 'inherit'} onChange={(_e, v) => v && setVal(p.key, v)}>
                  <ToggleButton value="inherit">Herdar</ToggleButton>
                  <ToggleButton value="allow" color="success">Permitir</ToggleButton>
                  <ToggleButton value="deny" color="error">Negar</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            ))}
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending} disableElevation>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

function UsersTab({ notify }) {
  const qc = useQueryClient()
  const [overrideUser, setOverrideUser] = React.useState(null)
  const catalogQ = useQuery({ queryKey: ['perm-catalog'], queryFn: permissionsService.catalog })
  const usersQ = useQuery({ queryKey: ['perm-users'], queryFn: permissionsService.listUsers })
  const profilesQ = useQuery({ queryKey: ['perm-profiles'], queryFn: permissionsService.listProfiles })
  const users = usersQ.data?.users || []
  const profiles = profilesQ.data?.profiles || []

  const assign = useMutation({
    mutationFn: ({ userId, profileId }) => permissionsService.setUserProfile(userId, profileId),
    onSuccess: () => { notify('Perfil atribuído.'); qc.invalidateQueries({ queryKey: ['perm-users'] }); qc.invalidateQueries({ queryKey: ['perm-profiles'] }); qc.invalidateQueries({ queryKey: ['me-permissions'] }) },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao atribuir.', 'error'),
  })

  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <Box sx={{ overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Usuário</TableCell>
              <TableCell>Papel</TableCell>
              <TableCell>Perfil</TableCell>
              <TableCell align="right">Overrides</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} hover>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }}>{u.name || u.email}</Typography>
                  {u.name && <Typography variant="caption" color="text.secondary">{u.email}</Typography>}
                </TableCell>
                <TableCell><Chip label={u.role} size="small" variant="outlined" /></TableCell>
                <TableCell>
                  {u.role === 'master' ? (
                    <Typography variant="body2" color="text.secondary">Acesso total (master)</Typography>
                  ) : (
                    <Select
                      size="small"
                      value={u.profile_id ?? ''}
                      displayEmpty
                      onChange={(e) => assign.mutate({ userId: u.id, profileId: e.target.value === '' ? null : e.target.value })}
                      sx={{ minWidth: 180 }}
                    >
                      <MenuItem value=""><em>Sem perfil (sem acesso)</em></MenuItem>
                      {profiles.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                    </Select>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Button size="small" startIcon={<TuneIcon />} disabled={u.role === 'master'}
                    onClick={() => setOverrideUser(u)} sx={{ textTransform: 'none' }}>
                    Ajustar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {overrideUser && (
        <OverridesDialog
          userId={overrideUser.id}
          userLabel={overrideUser.name || overrideUser.email}
          catalog={catalogQ.data?.catalog || []}
          onClose={() => setOverrideUser(null)}
          notify={notify}
        />
      )}
    </Paper>
  )
}

export default function PermissionsAdminPage() {
  const { user } = useAuth()
  const [tab, setTab] = React.useState(0)
  const [toast, setToast] = React.useState(null)
  const notify = (msg, severity = 'success') => setToast({ msg, severity })

  if (user?.role !== 'master') {
    return (
      <Stack spacing={2}>
        <PageHeader title="Perfis e permissões" />
        <Alert severity="warning">Apenas o master pode administrar perfis e permissões.</Alert>
      </Stack>
    )
  }

  return (
    <Stack spacing={2.5}>
      <PageHeader title="Perfis e permissões" subtitle="Defina o que cada perfil acessa e ajuste permissões por usuário." />
      <PapperBlock
        title="Controle de acesso"
        subtitle="Perfis (globais) e overrides por usuário"
        icon={<AdminPanelSettingsIcon />}
        iconColor="linear-gradient(135deg,#0ea5e9,#6366f1)"
        noPadding
      >
        <Box sx={{ px: 2, pt: 1 }}>
          <Tabs value={tab} onChange={(_e, v) => setTab(v)}>
            <Tab label="Perfis" />
            <Tab label="Usuários" />
          </Tabs>
        </Box>
        <Divider />
        <Box sx={{ p: 2 }}>
          {tab === 0 ? <ProfilesTab notify={notify} /> : <UsersTab notify={notify} />}
        </Box>
      </PapperBlock>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
