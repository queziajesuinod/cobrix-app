import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Grid, IconButton, Skeleton, Snackbar, Stack, Switch,
  TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import LayersIcon from '@mui/icons-material/Layers'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import EmptyState from '@/components/EmptyState'
import { useConfirm } from '@/components/ConfirmDialog'
import { useAuth } from '@/features/auth/AuthContext'
import { permissionsService } from '@/features/permissions/permissions.service'
import { plansService } from './plans.service'

const BRL = (v) => v == null
  ? '—'
  : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const EMPTY = {
  id: null, name: '', description: '', price_monthly: '', price_annual: '',
  clients_limit: '', contracts_limit: '', active: true, permission_keys: [],
}

// Editor de plano (dialog). O checklist de módulos é o "teto de acesso".
function PlanDialog({ open, initial, catalog, onClose, onSave, saving }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)

  React.useEffect(() => {
    if (open) {
      setForm(initial ? {
        id: initial.id,
        name: initial.name || '',
        description: initial.description || '',
        price_monthly: initial.price_monthly ?? '',
        price_annual: initial.price_annual ?? '',
        clients_limit: initial.clients_limit ?? '',
        contracts_limit: initial.contracts_limit ?? '',
        active: initial.active ?? true,
        permission_keys: Array.isArray(initial.permission_keys) ? [...initial.permission_keys] : [],
      } : { ...EMPTY })
      setError(null)
    }
  }, [open, initial])

  const selected = useMemo(() => new Set(form.permission_keys), [form.permission_keys])
  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const toggleKey = (key) => setForm((f) => {
    const s = new Set(f.permission_keys)
    if (s.has(key)) s.delete(key); else s.add(key)
    return { ...f, permission_keys: [...s] }
  })

  const toggleModule = (mod) => setForm((f) => {
    const keys = mod.permissions.map((p) => p.key)
    const s = new Set(f.permission_keys)
    const allOn = keys.every((k) => s.has(k))
    keys.forEach((k) => (allOn ? s.delete(k) : s.add(k)))
    return { ...f, permission_keys: [...s] }
  })

  const handleSave = () => {
    if (form.name.trim().length < 2) { setError('Informe o nome do plano.'); return }
    if (form.price_monthly === '' && form.price_annual === '') {
      setError('Informe ao menos um preço (mensal ou anual).'); return
    }
    setError(null)
    onSave(form)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{form.id ? 'Editar plano' : 'Novo plano'}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={8}>
            <TextField fullWidth label="Nome do plano" value={form.name} onChange={setField('name')} autoFocus />
          </Grid>
          <Grid item xs={12} sm={4} sx={{ display: 'flex', alignItems: 'center' }}>
            <FormControlLabel
              control={<Switch checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />}
              label={form.active ? 'Disponível' : 'Inativo'}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Descrição (opcional)" value={form.description} onChange={setField('description')} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth type="number" label="Preço mensal (R$)" value={form.price_monthly} onChange={setField('price_monthly')} inputProps={{ min: 0, step: '0.01' }} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth type="number" label="Preço anual (R$)" value={form.price_annual} onChange={setField('price_annual')} inputProps={{ min: 0, step: '0.01' }} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth type="number" label="Limite de clientes" value={form.clients_limit} onChange={setField('clients_limit')} inputProps={{ min: 0, step: 1 }} helperText="Vazio = ilimitado" />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth type="number" label="Limite de contratos" value={form.contracts_limit} onChange={setField('contracts_limit')} inputProps={{ min: 0, step: 1 }} helperText="Vazio = ilimitado" />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2.5 }} />
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Acessos liberados (teto do plano)</Typography>
          <Chip size="small" color="primary" variant="outlined" label={`${form.permission_keys.length} selecionada(s)`} sx={{ fontWeight: 700 }} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Marque os módulos que este plano libera. A empresa nunca acessa nada fora daqui — nem o Administrador dela.
        </Typography>

        <Grid container spacing={1.5}>
          {(catalog || []).map((mod) => {
            const keys = mod.permissions.map((p) => p.key)
            const allOn = keys.every((k) => selected.has(k))
            const someOn = !allOn && keys.some((k) => selected.has(k))
            return (
              <Grid item xs={12} md={6} key={mod.module}>
                <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, height: '100%' }}>
                  <FormControlLabel
                    control={<Checkbox checked={allOn} indeterminate={someOn} onChange={() => toggleModule(mod)} />}
                    label={<Typography sx={{ fontWeight: 700 }}>{mod.label}</Typography>}
                  />
                  <Box sx={{ pl: 3.5, display: 'flex', flexDirection: 'column' }}>
                    {mod.permissions.map((p) => (
                      <FormControlLabel
                        key={p.key}
                        control={<Checkbox size="small" checked={selected.has(p.key)} onChange={() => toggleKey(p.key)} />}
                        label={<Typography variant="body2">{p.label}</Typography>}
                      />
                    ))}
                  </Box>
                </Box>
              </Grid>
            )
          })}
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? 'Salvando…' : (form.id ? 'Salvar alterações' : 'Criar plano')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function PlansAdminPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { user } = useAuth()
  const isMaster = user?.role === 'master'
  const [dialog, setDialog] = useState({ open: false, plan: null })
  const [snack, setSnack] = useState(null)

  const plansQuery = useQuery({ queryKey: ['plans'], queryFn: plansService.list, enabled: isMaster })
  const catalogQuery = useQuery({ queryKey: ['permissions-catalog'], queryFn: permissionsService.catalog, enabled: isMaster })

  const plans = plansQuery.data?.plans || []
  const catalog = catalogQuery.data?.catalog || []

  const saveMutation = useMutation({
    mutationFn: (form) => {
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        price_monthly: form.price_monthly === '' ? null : form.price_monthly,
        price_annual: form.price_annual === '' ? null : form.price_annual,
        clients_limit: form.clients_limit === '' ? null : form.clients_limit,
        contracts_limit: form.contracts_limit === '' ? null : form.contracts_limit,
        active: form.active,
        permission_keys: form.permission_keys,
      }
      return form.id ? plansService.update(form.id, payload) : plansService.create(payload)
    },
    onSuccess: (_data, form) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] })
      setDialog({ open: false, plan: null })
      setSnack({ severity: 'success', msg: form.id ? 'Plano atualizado.' : 'Plano criado.' })
    },
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao salvar o plano.' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => plansService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] })
      setSnack({ severity: 'success', msg: 'Plano excluído.' })
    },
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao excluir o plano.' }),
  })

  const handleDelete = async (plan) => {
    const ok = await confirm({
      title: 'Excluir plano',
      description: `Excluir o plano "${plan.name}"? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      color: 'error',
    })
    if (ok) deleteMutation.mutate(plan.id)
  }

  if (!isMaster) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Planos" subtitle="Catálogo de planos do sistema." />
        <Alert severity="warning">Esta área é exclusiva do perfil master.</Alert>
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Planos"
        subtitle="Defina os planos que você vende: preço, cotas e os acessos que cada plano libera para a empresa-cliente."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, plan: null })}>
            Novo plano
          </Button>
        }
      />

      {plansQuery.isError && (
        <Alert severity="error">{plansQuery.error?.response?.data?.error || 'Falha ao carregar os planos.'}</Alert>
      )}

      <PapperBlock title="Catálogo de planos" subtitle="Planos disponíveis para inscrição" icon={<LayersIcon />} noPadding>
        <Box sx={{ p: 2 }}>
          {plansQuery.isLoading ? (
            <Stack spacing={1}>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={72} />)}</Stack>
          ) : plans.length === 0 ? (
            <EmptyState icon={<LayersIcon />} title="Nenhum plano ainda" description="Crie o primeiro plano para começar a vender o sistema." />
          ) : (
            <Grid container spacing={2}>
              {plans.map((plan) => (
                <Grid item xs={12} md={6} lg={4} key={plan.id}>
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1, opacity: plan.active ? 1 : 0.6 }}>
                    <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>{plan.name}</Typography>
                        {plan.description && (
                          <Typography variant="body2" color="text.secondary" noWrap>{plan.description}</Typography>
                        )}
                      </Box>
                      <Chip size="small" color={plan.active ? 'success' : 'default'} variant={plan.active ? 'filled' : 'outlined'} label={plan.active ? 'Ativo' : 'Inativo'} sx={{ fontWeight: 700 }} />
                    </Stack>

                    <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Mensal</Typography>
                        <Typography sx={{ fontWeight: 700 }}>{BRL(plan.price_monthly)}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Anual</Typography>
                        <Typography sx={{ fontWeight: 700 }}>{BRL(plan.price_annual)}</Typography>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      <Chip size="small" variant="outlined" label={`${(plan.permission_keys || []).length} acessos`} />
                      <Chip size="small" variant="outlined" label={plan.clients_limit == null ? 'Clientes: ∞' : `Clientes: ${plan.clients_limit}`} />
                      <Chip size="small" variant="outlined" label={plan.contracts_limit == null ? 'Contratos: ∞' : `Contratos: ${plan.contracts_limit}`} />
                    </Stack>

                    <Box sx={{ flex: 1 }} />
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {plan.company_count > 0 ? `${plan.company_count} empresa(s)` : 'Sem empresas'}
                      </Typography>
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="Editar">
                          <IconButton size="small" onClick={() => setDialog({ open: true, plan })}><EditIcon fontSize="small" /></IconButton>
                        </Tooltip>
                        <Tooltip title={plan.company_count > 0 ? 'Migre as empresas antes de excluir' : 'Excluir'}>
                          <span>
                            <IconButton size="small" color="error" disabled={plan.company_count > 0} onClick={() => handleDelete(plan)}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </Box>
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      </PapperBlock>

      <PlanDialog
        open={dialog.open}
        initial={dialog.plan}
        catalog={catalog}
        saving={saveMutation.isPending}
        onClose={() => setDialog({ open: false, plan: null })}
        onSave={(form) => saveMutation.mutate(form)}
      />

      <Snackbar open={Boolean(snack)} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.msg}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
