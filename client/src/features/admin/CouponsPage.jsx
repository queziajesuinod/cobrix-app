import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Grid, IconButton, MenuItem, Skeleton, Snackbar, Stack, Switch,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import EmptyState from '@/components/EmptyState'
import { useConfirm } from '@/components/ConfirmDialog'
import { useAuth } from '@/features/auth/AuthContext'
import { plansService } from './plans.service'
import { couponsService } from './coupons.service'

const BRL = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (v) => {
  if (!v) return null
  const s = String(v).slice(0, 10)
  const [y, m, d] = s.split('-')
  return d ? `${d}/${m}/${y}` : s
}
const PERIOD_LABEL = { any: 'Mensal e anual', monthly: 'Só mensal', annual: 'Só anual' }

function discountLabel(c) {
  return c.discount_type === 'fixed'
    ? BRL(c.discount_value)
    : `${Number(c.discount_value).toLocaleString('pt-BR')}%`
}

const EMPTY = {
  id: null, code: '', description: '', discount_type: 'percent', discount_value: '',
  applies_to_period: 'any', plan_ids: [], min_amount: '', max_redemptions: '',
  starts_at: '', expires_at: '', active: true,
}

function CouponDialog({ open, initial, plans, onClose, onSave, saving }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)

  React.useEffect(() => {
    if (open) {
      setForm(initial ? {
        id: initial.id,
        code: initial.code || '',
        description: initial.description || '',
        discount_type: initial.discount_type || 'percent',
        discount_value: initial.discount_value ?? '',
        applies_to_period: initial.applies_to_period || 'any',
        plan_ids: Array.isArray(initial.plan_ids) ? [...initial.plan_ids] : [],
        min_amount: initial.min_amount ?? '',
        max_redemptions: initial.max_redemptions ?? '',
        starts_at: initial.starts_at ? String(initial.starts_at).slice(0, 10) : '',
        expires_at: initial.expires_at ? String(initial.expires_at).slice(0, 10) : '',
        active: initial.active ?? true,
      } : { ...EMPTY })
      setError(null)
    }
  }, [open, initial])

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const selectedPlans = useMemo(() => new Set((form.plan_ids || []).map(Number)), [form.plan_ids])

  const togglePlan = (id) => setForm((f) => {
    const s = new Set((f.plan_ids || []).map(Number))
    if (s.has(id)) s.delete(id); else s.add(id)
    return { ...f, plan_ids: [...s] }
  })

  const handleSave = () => {
    const code = form.code.trim().toUpperCase()
    if (code.length < 2) { setError('Informe o código do cupom.'); return }
    if (!/^[A-Z0-9_-]+$/.test(code)) { setError('Use apenas letras, números, hífen e underscore no código.'); return }
    const val = Number(String(form.discount_value).replace(',', '.'))
    if (!Number.isFinite(val) || val <= 0) { setError('Informe um valor de desconto maior que zero.'); return }
    if (form.discount_type === 'percent' && val > 100) { setError('Desconto em % não pode passar de 100.'); return }
    setError(null)
    onSave({ ...form, code })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{form.id ? 'Editar cupom' : 'Novo cupom'}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={8}>
            <TextField
              fullWidth label="Código" value={form.code} autoFocus
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="EX.: BEMVINDO20" helperText="Letras, números, - e _"
            />
          </Grid>
          <Grid item xs={12} sm={4} sx={{ display: 'flex', alignItems: 'center' }}>
            <FormControlLabel
              control={<Switch checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />}
              label={form.active ? 'Ativo' : 'Inativo'}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Descrição (opcional)" value={form.description} onChange={setField('description')} />
          </Grid>

          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>Tipo de desconto</Typography>
            <ToggleButtonGroup
              exclusive size="small" color="primary" value={form.discount_type}
              onChange={(_, v) => v && setForm((f) => ({ ...f, discount_type: v }))}
            >
              <ToggleButton value="percent" sx={{ px: 2, fontWeight: 700 }}>Porcentagem</ToggleButton>
              <ToggleButton value="fixed" sx={{ px: 2, fontWeight: 700 }}>Valor fixo</ToggleButton>
            </ToggleButtonGroup>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth type="number" label={form.discount_type === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}
              value={form.discount_value} onChange={setField('discount_value')}
              inputProps={{ min: 0, step: form.discount_type === 'percent' ? 1 : '0.01' }}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField select fullWidth label="Períodos elegíveis" value={form.applies_to_period} onChange={setField('applies_to_period')}>
              <MenuItem value="any">Mensal e anual</MenuItem>
              <MenuItem value="monthly">Só mensal</MenuItem>
              <MenuItem value="annual">Só anual</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField fullWidth type="number" label="Limite de usos" value={form.max_redemptions} onChange={setField('max_redemptions')} inputProps={{ min: 0, step: 1 }} helperText="Vazio = ilimitado" />
          </Grid>

          <Grid item xs={12} sm={4}>
            <TextField fullWidth type="number" label="Valor mínimo (R$)" value={form.min_amount} onChange={setField('min_amount')} inputProps={{ min: 0, step: '0.01' }} helperText="Vazio = sem mínimo" />
          </Grid>
          <Grid item xs={6} sm={4}>
            <TextField fullWidth type="date" label="Válido de" value={form.starts_at} onChange={setField('starts_at')} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={6} sm={4}>
            <TextField fullWidth type="date" label="Válido até" value={form.expires_at} onChange={setField('expires_at')} InputLabelProps={{ shrink: true }} />
          </Grid>

          <Grid item xs={12}>
            <Divider sx={{ mb: 1 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Planos elegíveis</Typography>
            <Typography variant="caption" color="text.secondary">Nenhum marcado = vale para todos os planos.</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {(plans || []).map((p) => (
                <FormControlLabel
                  key={p.id}
                  control={<Checkbox size="small" checked={selectedPlans.has(Number(p.id))} onChange={() => togglePlan(Number(p.id))} />}
                  label={<Typography variant="body2">{p.name}</Typography>}
                />
              ))}
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? 'Salvando…' : (form.id ? 'Salvar alterações' : 'Criar cupom')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function CouponsPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { user } = useAuth()
  const isMaster = user?.role === 'master'
  const [dialog, setDialog] = useState({ open: false, coupon: null })
  const [snack, setSnack] = useState(null)

  const couponsQuery = useQuery({ queryKey: ['coupons'], queryFn: couponsService.list, enabled: isMaster })
  const plansQuery = useQuery({ queryKey: ['plans'], queryFn: plansService.list, enabled: isMaster })

  const coupons = couponsQuery.data?.coupons || []
  const plans = plansQuery.data?.plans || []
  const planName = useMemo(() => Object.fromEntries(plans.map((p) => [Number(p.id), p.name])), [plans])

  const saveMutation = useMutation({
    mutationFn: (form) => {
      const payload = {
        code: form.code,
        description: form.description?.trim() || null,
        discount_type: form.discount_type,
        discount_value: form.discount_value,
        applies_to_period: form.applies_to_period,
        plan_ids: (form.plan_ids || []).length ? form.plan_ids : null,
        min_amount: form.min_amount === '' ? null : form.min_amount,
        max_redemptions: form.max_redemptions === '' ? null : form.max_redemptions,
        starts_at: form.starts_at || null,
        expires_at: form.expires_at || null,
        active: form.active,
      }
      return form.id ? couponsService.update(form.id, payload) : couponsService.create(payload)
    },
    onSuccess: (_data, form) => {
      queryClient.invalidateQueries({ queryKey: ['coupons'] })
      setDialog({ open: false, coupon: null })
      setSnack({ severity: 'success', msg: form.id ? 'Cupom atualizado.' : 'Cupom criado.' })
    },
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao salvar o cupom.' }),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }) => couponsService.setActive(id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coupons'] }),
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao atualizar o cupom.' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => couponsService.remove(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['coupons'] })
      setSnack({ severity: 'success', msg: res?.softDeleted ? 'Cupom já usado — desativado (mantido para auditoria).' : 'Cupom excluído.' })
    },
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao excluir o cupom.' }),
  })

  const handleDelete = async (coupon) => {
    const used = Number(coupon.redeemed_count) > 0
    const ok = await confirm({
      title: used ? 'Desativar cupom' : 'Excluir cupom',
      description: used
        ? `O cupom "${coupon.code}" já foi usado ${coupon.redeemed_count}×. Ele será desativado (mantido para auditoria). Continuar?`
        : `Excluir o cupom "${coupon.code}"? Esta ação não pode ser desfeita.`,
      confirmText: used ? 'Desativar' : 'Excluir',
      color: 'error',
    })
    if (ok) deleteMutation.mutate(coupon.id)
  }

  if (!isMaster) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Cupons" subtitle="Cupons de desconto da assinatura." />
        <Alert severity="warning">Esta área é exclusiva do perfil master.</Alert>
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Cupons de desconto"
        subtitle="Cupons aplicados na 1ª cobrança da assinatura, no cadastro. As renovações seguem o valor cheio do plano."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, coupon: null })}>
            Novo cupom
          </Button>
        }
      />

      {couponsQuery.isError && (
        <Alert severity="error">{couponsQuery.error?.response?.data?.error || 'Falha ao carregar os cupons.'}</Alert>
      )}

      <PapperBlock title="Cupons" subtitle="Códigos de desconto para novas assinaturas" icon={<LocalOfferIcon />} noPadding>
        <Box sx={{ p: 2 }}>
          {couponsQuery.isLoading ? (
            <Stack spacing={1}>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={72} />)}</Stack>
          ) : coupons.length === 0 ? (
            <EmptyState icon={<LocalOfferIcon />} title="Nenhum cupom ainda" description="Crie um cupom para oferecer desconto na assinatura." />
          ) : (
            <Grid container spacing={2}>
              {coupons.map((c) => {
                const exhausted = c.max_redemptions != null && Number(c.redeemed_count) >= Number(c.max_redemptions)
                return (
                  <Grid item xs={12} md={6} lg={4} key={c.id}>
                    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1, opacity: c.active ? 1 : 0.6 }}>
                      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'monospace' }} noWrap>{c.code}</Typography>
                          {c.description && <Typography variant="body2" color="text.secondary" noWrap>{c.description}</Typography>}
                        </Box>
                        <Chip size="small" color={c.active ? 'success' : 'default'} variant={c.active ? 'filled' : 'outlined'} label={c.active ? 'Ativo' : 'Inativo'} sx={{ fontWeight: 700 }} />
                      </Stack>

                      <Stack direction="row" alignItems="baseline" spacing={1}>
                        <Typography variant="h5" sx={{ fontWeight: 800, color: 'primary.main' }}>{discountLabel(c)}</Typography>
                        <Typography variant="caption" color="text.secondary">de desconto · {PERIOD_LABEL[c.applies_to_period] || 'Mensal e anual'}</Typography>
                      </Stack>

                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        <Chip size="small" variant="outlined" label={`Usos: ${c.redeemed_count}${c.max_redemptions != null ? ` / ${c.max_redemptions}` : ''}`} color={exhausted ? 'error' : 'default'} />
                        {c.min_amount != null && <Chip size="small" variant="outlined" label={`Mín. ${BRL(c.min_amount)}`} />}
                        {(c.starts_at || c.expires_at) && (
                          <Chip size="small" variant="outlined" label={`${c.starts_at ? brDate(c.starts_at) : '…'} → ${c.expires_at ? brDate(c.expires_at) : '…'}`} />
                        )}
                        <Chip
                          size="small" variant="outlined"
                          label={(Array.isArray(c.plan_ids) && c.plan_ids.length)
                            ? c.plan_ids.map((id) => planName[Number(id)] || `#${id}`).join(', ')
                            : 'Todos os planos'}
                        />
                      </Stack>

                      <Box sx={{ flex: 1 }} />
                      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
                        <FormControlLabel
                          control={<Switch size="small" checked={c.active} onChange={(e) => toggleMutation.mutate({ id: c.id, active: e.target.checked })} />}
                          label={<Typography variant="caption" color="text.secondary">{c.active ? 'Ativo' : 'Inativo'}</Typography>}
                        />
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title="Editar">
                            <IconButton size="small" onClick={() => setDialog({ open: true, coupon: c })}><EditIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          <Tooltip title={Number(c.redeemed_count) > 0 ? 'Já usado — desativa' : 'Excluir'}>
                            <IconButton size="small" color="error" onClick={() => handleDelete(c)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        </Stack>
                      </Stack>
                    </Box>
                  </Grid>
                )
              })}
            </Grid>
          )}
        </Box>
      </PapperBlock>

      <CouponDialog
        open={dialog.open}
        initial={dialog.coupon}
        plans={plans}
        saving={saveMutation.isPending}
        onClose={() => setDialog({ open: false, coupon: null })}
        onSave={(form) => saveMutation.mutate(form)}
      />

      <Snackbar open={Boolean(snack)} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.msg}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
