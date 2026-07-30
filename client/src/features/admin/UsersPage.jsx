import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Select, Snackbar, Stack, Switch, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1'
import GroupIcon from '@mui/icons-material/Group'
import EditIcon from '@mui/icons-material/Edit'
import TuneIcon from '@mui/icons-material/Tune'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { useConfirm } from '@/components/ConfirmDialog'
import { permissionsService } from '@/features/permissions/permissions.service'

function UserFormDialog({ mode, user, profiles, onClose, onDone, notify }) {
  const isEdit = mode === 'edit'
  const [form, setForm] = React.useState({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    profileId: user?.profile_id || '',
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const mut = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return permissionsService.updateManageUser(user.id, {
          name: form.name.trim() || null,
          password: form.password || undefined,
        })
      }
      return permissionsService.createUser({
        name: form.name.trim() || null,
        email: form.email.trim(),
        password: form.password,
        profileId: Number(form.profileId),
      })
    },
    onSuccess: () => { notify(isEdit ? 'Usuário atualizado.' : 'Usuário criado.'); onDone(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error'),
  })

  const emailOk = isEdit || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)
  const pwOk = isEdit ? (form.password === '' || form.password.length >= 6) : form.password.length >= 6
  const valid = emailOk && pwOk && (isEdit || form.profileId)

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>{isEdit ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Nome" value={form.name} onChange={set('name')} fullWidth />
          <TextField label="E-mail" type="email" value={form.email} onChange={set('email')} required={!isEdit} disabled={isEdit} fullWidth />
          <TextField
            label={isEdit ? 'Nova senha (opcional)' : 'Senha'}
            type="password"
            value={form.password}
            onChange={set('password')}
            required={!isEdit}
            fullWidth
            helperText={isEdit ? 'Deixe em branco para manter a senha atual' : 'Mínimo 6 caracteres'}
          />
          {!isEdit && (
            <>
              <TextField label="Perfil" select value={form.profileId} onChange={set('profileId')} required fullWidth>
                {profiles.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
              </TextField>
              <Typography variant="caption" color="text.secondary">
                Você só pode atribuir perfis que não sejam Administrador.
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>
          {isEdit ? 'Salvar' : 'Criar usuário'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Permissões personalizadas (overrides) de um usuário — só as chaves que o ator
// pode gerenciar aparecem (backend filtra o catálogo).
function OverridesDialog({ userId, userLabel, onClose, notify }) {
  const qc = useQueryClient()
  const [state, setState] = React.useState({}) // key -> 'inherit' | 'allow' | 'deny'
  const catalogQ = useQuery({ queryKey: ['manage-catalog'], queryFn: permissionsService.manageCatalog })
  const q = useQuery({ queryKey: ['manage-overrides', userId], queryFn: () => permissionsService.getManageUserOverrides(userId), enabled: Boolean(userId) })
  React.useEffect(() => {
    const map = {}
    ;(q.data?.overrides || []).forEach((o) => { map[o.permission_key] = o.allowed ? 'allow' : 'deny' })
    setState(map)
  }, [q.data])
  const catalog = catalogQ.data?.catalog || []

  const save = useMutation({
    mutationFn: () => {
      const overrides = Object.entries(state)
        .filter(([, v]) => v === 'allow' || v === 'deny')
        .map(([key, v]) => ({ key, allowed: v === 'allow' }))
      return permissionsService.setManageUserOverrides(userId, overrides)
    },
    onSuccess: () => { notify('Permissões personalizadas salvas.'); qc.invalidateQueries({ queryKey: ['me-permissions'] }); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error'),
  })
  const setVal = (k, v) => setState((s) => ({ ...s, [k]: v }))

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Permissões personalizadas — {userLabel}</DialogTitle>
      <DialogContent dividers sx={{ maxHeight: 460 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          "Herdar" segue o perfil. "Permitir"/"Negar" ajustam só para este usuário. Você só vê as permissões que pode conceder.
        </Typography>
        {catalog.map((mod) => (
          <Box key={mod.module} sx={{ mb: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 0.5 }}>{mod.label}</Typography>
            {mod.permissions.map((p) => (
              <Box key={p.key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, py: 0.5 }}>
                <Typography variant="body2" sx={{ minWidth: 0 }}>{p.label}</Typography>
                <ToggleButtonGroup size="small" exclusive value={state[p.key] || 'inherit'} onChange={(_e, v) => v && setVal(p.key, v)}>
                  <ToggleButton value="inherit">Herdar</ToggleButton>
                  <ToggleButton value="allow">Permitir</ToggleButton>
                  <ToggleButton value="deny">Negar</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            ))}
          </Box>
        ))}
        {!catalog.length && <Typography variant="body2" color="text.secondary">Nenhuma permissão gerenciável.</Typography>}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function UsersPage() {
  const { selectedCompanyId, user } = useAuth()
  const { can } = usePermissions()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const enabled = Number.isInteger(selectedCompanyId)
  const isMaster = user?.role === 'master'
  const canManage = can('users.create')
  const [dialog, setDialog] = React.useState(null) // { mode, user }
  const [overrideUser, setOverrideUser] = React.useState(null)
  const [toast, setToast] = React.useState(null)
  const notify = (msg, severity = 'success') => setToast({ msg, severity })
  const refresh = () => qc.invalidateQueries({ queryKey: ['manage-users'] })

  const usersQ = useQuery({ queryKey: ['manage-users', selectedCompanyId], queryFn: permissionsService.manageUsers, enabled })
  const profilesQ = useQuery({ queryKey: ['assignable-profiles'], queryFn: permissionsService.assignableProfiles, enabled: canManage })
  const users = usersQ.data?.users || []
  const profiles = profilesQ.data?.profiles || []

  const setProfile = useMutation({
    mutationFn: ({ id, profileId }) => permissionsService.setManageUserProfile(id, profileId),
    onSuccess: () => { notify('Perfil atualizado.'); refresh(); qc.invalidateQueries({ queryKey: ['me-permissions'] }) },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao atualizar perfil.', 'error'),
  })
  const setStatus = useMutation({
    mutationFn: ({ id, active }) => permissionsService.setManageUserStatus(id, active),
    onSuccess: () => { notify('Status atualizado.'); refresh() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao atualizar status.', 'error'),
  })

  // Um usuário só é gerenciável aqui se não for o próprio ator e, para não-master,
  // não tiver o perfil Administrador (o backend também valida).
  const manageable = (u) => canManage && (isMaster || u.profile_name !== 'Administrador')
  // Overrides: só master, ou o Admin para usuários que ELE cadastrou.
  const canCustomize = (u) => manageable(u) && (isMaster || u.created_by === user?.id)

  const handleToggle = async (u) => {
    if (u.id === user?.id) return
    const next = !u.active
    const ok = await confirm({
      title: next ? 'Ativar usuário' : 'Desativar usuário',
      description: `${next ? 'Ativar' : 'Desativar'} o acesso de "${u.name || u.email}"?`,
      confirmText: next ? 'Ativar' : 'Desativar',
      tone: next ? 'default' : 'danger',
    })
    if (ok) setStatus.mutate({ id: u.id, active: next })
  }

  if (!enabled) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Usuários" subtitle="Crie e gerencie os usuários da empresa." />
        <CompanyRequiredAlert />
      </Stack>
    )
  }

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="Usuários"
        subtitle="Crie usuários, troque perfis e ative/desative acessos."
        actions={canManage ? (
          <Button variant="contained" startIcon={<PersonAddAlt1Icon />} onClick={() => setDialog({ mode: 'create' })}>Novo usuário</Button>
        ) : null}
      />

      {usersQ.isError && <Alert severity="error">{usersQ.error?.response?.data?.error || 'Falha ao carregar usuários.'}</Alert>}

      <PapperBlock title="Usuários da empresa" subtitle={`${users.length} usuário(s)`} icon={<GroupIcon />} iconColor="linear-gradient(135deg,#0ea5e9,#6366f1)" noPadding>
        <Box sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Usuário</TableCell>
                <TableCell>Perfil</TableCell>
                <TableCell>Ativo</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => {
                const editable = manageable(u)
                return (
                  <TableRow key={u.id} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{u.name || u.email}</Typography>
                      {u.name && <Typography variant="caption" color="text.secondary">{u.email}</Typography>}
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <Select
                          size="small"
                          value={u.profile_id ?? ''}
                          displayEmpty
                          onChange={(e) => setProfile.mutate({ id: u.id, profileId: e.target.value === '' ? null : e.target.value })}
                          sx={{ minWidth: 170 }}
                        >
                          <MenuItem value=""><em>Sem perfil (sem acesso)</em></MenuItem>
                          {profiles.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                        </Select>
                      ) : (
                        u.profile_name
                          ? <Chip label={u.profile_name} size="small" variant="outlined" />
                          : <Typography variant="caption" color="text.secondary">Sem perfil</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={u.id === user?.id ? 'Você não pode alterar o próprio status' : (u.active ? 'Desativar' : 'Ativar')}>
                        <span>
                          <Switch
                            checked={u.active}
                            disabled={!editable || u.id === user?.id}
                            onChange={() => handleToggle(u)}
                          />
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={canCustomize(u) ? 'Permissões personalizadas' : 'Disponível apenas para usuários que você cadastrou'}>
                        <span>
                          <IconButton size="small" disabled={!canCustomize(u)} onClick={() => setOverrideUser(u)}>
                            <TuneIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Editar">
                        <span>
                          <IconButton size="small" disabled={!editable} onClick={() => setDialog({ mode: 'edit', user: u })}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!users.length && (
                <TableRow><TableCell colSpan={4}><Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>Nenhum usuário.</Box></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </PapperBlock>

      {dialog && (
        <UserFormDialog
          mode={dialog.mode}
          user={dialog.user}
          profiles={profiles}
          onClose={() => setDialog(null)}
          onDone={refresh}
          notify={notify}
        />
      )}

      {overrideUser && (
        <OverridesDialog
          userId={overrideUser.id}
          userLabel={overrideUser.name || overrideUser.email}
          onClose={() => setOverrideUser(null)}
          notify={notify}
        />
      )}

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
