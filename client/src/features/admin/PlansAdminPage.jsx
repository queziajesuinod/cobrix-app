import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Grid, IconButton, MenuItem, Skeleton, Snackbar, Stack, Switch,
  TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import PriceChangeIcon from '@mui/icons-material/PriceChange'
import EventIcon from '@mui/icons-material/Event'
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
  partner_commission_type: 'percent', partner_commission_value: '',
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
        partner_commission_type: initial.partner_commission_type || 'percent',
        partner_commission_value: initial.partner_commission_value ?? '',
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
            <TextField
              fullWidth type="number" label="Preço mensal (plano anual)" value={form.price_annual}
              onChange={setField('price_annual')} inputProps={{ min: 0, step: '0.01' }}
              helperText={form.price_annual !== '' && Number(form.price_annual) > 0
                ? `× 12 = ${BRL(Number(form.price_annual) * 12)} cobrado 1×/ano`
                : 'Valor por mês · cobrado 12× de uma vez no ano'}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth type="number" label="Limite de clientes" value={form.clients_limit} onChange={setField('clients_limit')} inputProps={{ min: 0, step: 1 }} helperText="Vazio = ilimitado" />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth type="number" label="Limite de contratos" value={form.contracts_limit} onChange={setField('contracts_limit')} inputProps={{ min: 0, step: 1 }} helperText="Vazio = ilimitado" />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              select fullWidth label="Comissão de revenda"
              value={form.partner_commission_type} onChange={setField('partner_commission_type')}
            >
              <MenuItem value="percent">Percentual (%)</MenuItem>
              <MenuItem value="fixed">Valor fixo (R$)</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth type="number" label="Comissão da plataforma"
              value={form.partner_commission_value} onChange={setField('partner_commission_value')}
              inputProps={{ min: 0, step: '0.01' }}
              helperText="Quanto a plataforma recebe por assinatura deste plano na revenda. Incide sobre o piso (este preço). Sempre garantida."
            />
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

// Reajuste de assinantes: mostra a prévia (de/para por assinante ativo) e aplica
// o valor vigente do plano nos contratos — valendo do próximo ciclo em diante.
function AdjustSubscribersDialog({ open, plan, onClose, onDone }) {
  const previewQuery = useQuery({
    queryKey: ['plan-adjust-preview', plan?.id],
    queryFn: () => plansService.adjustPreview(plan.id),
    enabled: open && Boolean(plan?.id),
  })
  const data = previewQuery.data
  const items = data?.items || []
  const summary = data?.summary

  const applyMutation = useMutation({
    mutationFn: () => plansService.adjustApply(plan.id, {}),
    onSuccess: (res) => onDone(res),
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Reajustar assinantes — {plan?.name}</DialogTitle>
      <DialogContent dividers>
        {previewQuery.isLoading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress /></Stack>
        ) : previewQuery.isError ? (
          <Alert severity="error">{previewQuery.error?.response?.data?.error || 'Falha ao carregar a prévia.'}</Alert>
        ) : items.length === 0 ? (
          <Alert severity="info">Nenhuma assinatura ativa neste plano.</Alert>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              O valor vigente do plano será gravado no contrato de cada assinante, valendo <strong>a partir do próximo ciclo</strong> (o ciclo já pago não é recobrado).
            </Typography>
            <Alert severity={summary?.will_change ? 'warning' : 'success'}>
              {summary?.will_change
                ? `${summary.will_change} de ${summary.total} assinante(s) serão reajustados.`
                : `Nenhum reajuste necessário — os ${summary?.total} assinante(s) já estão no valor vigente.`}
            </Alert>
            <Stack spacing={0} divider={<Divider flexItem />}>
              {items.map((it) => (
                <Stack key={it.subscription_id} direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ py: 0.75, opacity: it.changed ? 1 : 0.55 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{it.company_name}</Typography>
                    <Typography variant="caption" color="text.secondary">{it.period === 'annual' ? 'Anual' : 'Mensal'}</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {it.new_value == null ? (
                      <Typography variant="caption" color="text.secondary">{it.skipped_reason}</Typography>
                    ) : it.changed ? (
                      <Typography variant="body2">
                        <Box component="span" sx={{ textDecoration: 'line-through', color: 'text.secondary' }}>{BRL(it.current_value)}</Box>
                        {' → '}
                        <Box component="span" sx={{ fontWeight: 700, color: it.delta > 0 ? 'error.main' : 'success.main' }}>{BRL(it.new_value)}</Box>
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">{BRL(it.current_value)} · sem mudança</Typography>
                    )}
                  </Box>
                </Stack>
              ))}
            </Stack>
            {applyMutation.isError && (
              <Alert severity="error">{applyMutation.error?.response?.data?.error || 'Falha ao aplicar o reajuste.'}</Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Fechar</Button>
        <Button
          variant="contained"
          disabled={applyMutation.isPending || !summary?.will_change}
          onClick={() => applyMutation.mutate()}
        >
          {applyMutation.isPending ? 'Aplicando…' : `Reajustar${summary?.will_change ? ` ${summary.will_change}` : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Dialog: agendar reajuste de PISO (revenda) + ver/cancelar agendamentos.
function FloorScheduleDialog({ open, plan, onClose, notify }) {
  const qc = useQueryClient()
  const brDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-')
  const [form, setForm] = useState({ new_price_monthly: '', new_price_annual: '', effective_date: '', note: '' })
  React.useEffect(() => {
    if (open) setForm({ new_price_monthly: '', new_price_annual: '', effective_date: '', note: '' })
  }, [open, plan?.id])

  const listQ = useQuery({
    queryKey: ['floor-schedule', plan?.id],
    queryFn: () => plansService.floorSchedule(plan.id),
    enabled: open && Boolean(plan?.id),
  })
  const items = listQ.data?.items || []

  const createM = useMutation({
    mutationFn: () => plansService.floorScheduleCreate(plan.id, {
      new_price_monthly: form.new_price_monthly === '' ? null : Number(form.new_price_monthly),
      new_price_annual: form.new_price_annual === '' ? null : Number(form.new_price_annual),
      effective_date: form.effective_date,
      note: form.note || null,
    }),
    onSuccess: () => {
      notify('Reajuste agendado. Parceiros avisados.')
      qc.invalidateQueries({ queryKey: ['floor-schedule', plan.id] })
      setForm({ new_price_monthly: '', new_price_annual: '', effective_date: '', note: '' })
    },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao agendar.', 'error'),
  })
  const cancelM = useMutation({
    mutationFn: (adjId) => plansService.floorScheduleCancel(plan.id, adjId),
    onSuccess: () => { notify('Agendamento cancelado.'); qc.invalidateQueries({ queryKey: ['floor-schedule', plan.id] }) },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao cancelar.', 'error'),
  })

  if (!open || !plan) return null
  const valid = (form.new_price_monthly !== '' || form.new_price_annual !== '') && /^\d{4}-\d{2}-\d{2}$/.test(form.effective_date)

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Piso agendado — {plan.name}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Agende um novo piso com data futura. Os parceiros são avisados na hora e em lembretes (30/15/7/1 dias antes).
          Na data, o piso troca e os preços de parceiro abaixo dele sobem automaticamente.
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField fullWidth type="number" label="Novo piso mensal" value={form.new_price_monthly}
              onChange={(e) => setForm((f) => ({ ...f, new_price_monthly: e.target.value }))}
              inputProps={{ min: 0, step: '0.01' }} helperText={`Atual: ${BRL(plan.price_monthly)}`} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth type="number" label="Novo piso anual (por mês)" value={form.new_price_annual}
              onChange={(e) => setForm((f) => ({ ...f, new_price_annual: e.target.value }))}
              inputProps={{ min: 0, step: '0.01' }} helperText={`Atual: ${BRL(plan.price_annual)}`} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth type="date" label="Vigência" InputLabelProps={{ shrink: true }} value={form.effective_date}
              onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Observação (opcional)" value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </Grid>
        </Grid>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button variant="contained" disableElevation disabled={!valid || createM.isPending} onClick={() => createM.mutate()}>
            Agendar e avisar
          </Button>
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Agendamentos</Typography>
        {listQ.isLoading ? (
          <Stack alignItems="center" sx={{ py: 2 }}><CircularProgress size={20} /></Stack>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Nenhum agendamento.</Typography>
        ) : (
          <Stack spacing={1}>
            {items.map((it) => (
              <Stack key={it.id} direction="row" alignItems="center" justifyContent="space-between"
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Vigência {brDate(it.effective_date)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Mensal {BRL(it.new_price_monthly)} · Anual {BRL(it.new_price_annual)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  {it.applied_at
                    ? <Chip size="small" color="success" label="Aplicado" />
                    : <Chip size="small" color="warning" variant="outlined" label="Agendado" />}
                  {!it.applied_at && (
                    <Button size="small" color="error" disabled={cancelM.isPending} onClick={() => cancelM.mutate(it.id)}>
                      Cancelar
                    </Button>
                  )}
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose} color="inherit">Fechar</Button></DialogActions>
    </Dialog>
  )
}

export default function PlansAdminPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { user } = useAuth()
  const isMaster = user?.role === 'master'
  const [dialog, setDialog] = useState({ open: false, plan: null })
  const [adjust, setAdjust] = useState({ open: false, plan: null })
  const [floor, setFloor] = useState({ open: false, plan: null })
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
        partner_commission_type: form.partner_commission_type || 'percent',
        partner_commission_value: form.partner_commission_value === '' ? 0 : form.partner_commission_value,
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
                        <Typography variant="caption" color="text.secondary" display="block">Anual (por mês)</Typography>
                        <Typography sx={{ fontWeight: 700 }}>{BRL(plan.price_annual)}</Typography>
                        {plan.price_annual != null && (
                          <Typography variant="caption" color="text.secondary">{BRL(plan.price_annual * 12)}/ano</Typography>
                        )}
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
                        <Tooltip title={plan.company_count > 0 ? 'Reajustar assinantes' : 'Sem assinantes para reajustar'}>
                          <span>
                            <IconButton size="small" disabled={!(plan.company_count > 0)} onClick={() => setAdjust({ open: true, plan })}>
                              <PriceChangeIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Piso agendado (revenda)">
                          <IconButton size="small" onClick={() => setFloor({ open: true, plan })}><EventIcon fontSize="small" /></IconButton>
                        </Tooltip>
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

      <AdjustSubscribersDialog
        open={adjust.open}
        plan={adjust.plan}
        onClose={() => setAdjust({ open: false, plan: null })}
        onDone={(res) => {
          queryClient.invalidateQueries({ queryKey: ['plans'] })
          queryClient.invalidateQueries({ queryKey: ['plan-adjust-preview'] })
          setAdjust({ open: false, plan: null })
          setSnack({ severity: 'success', msg: res?.adjusted ? `${res.adjusted} assinante(s) reajustado(s).` : 'Nenhum reajuste aplicado.' })
        }}
      />

      <FloorScheduleDialog
        open={floor.open}
        plan={floor.plan}
        onClose={() => setFloor({ open: false, plan: null })}
        notify={(msg, severity) => setSnack({ severity: severity || 'success', msg })}
      />

      <Snackbar open={Boolean(snack)} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.msg}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
