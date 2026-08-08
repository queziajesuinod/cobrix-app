import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Grid, Skeleton, Snackbar, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import EmptyState from '@/components/EmptyState'
import { useConfirm } from '@/components/ConfirmDialog'
import { useAuth } from '@/features/auth/AuthContext'
import { subscriptionsService } from './subscriptions.service'
import { plansService } from './plans.service'

const BRL = (v) => v == null
  ? '—'
  : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const qrSrc = (v) => !v ? null : (String(v).startsWith('data:') ? v : `data:image/png;base64,${v}`)

const fmtDate = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

const STATUS_META = {
  pending_payment: { label: 'Pendente', color: 'warning' },
  active: { label: 'Ativa', color: 'success' },
  canceling: { label: 'Cancelando', color: 'warning' },
  canceled: { label: 'Cancelada', color: 'default' },
}
const statusChip = (status) => {
  const meta = STATUS_META[status] || { label: status || '—', color: 'default' }
  return <Chip size="small" color={meta.color} variant={meta.color === 'default' ? 'outlined' : 'filled'} label={meta.label} sx={{ fontWeight: 700 }} />
}

const PERIODS = [{ value: 'monthly', label: 'Mensal' }, { value: 'annual', label: 'Anual' }]

const FILTERS = [
  { value: 'pending_payment', label: 'Pendentes' },
  { value: 'active', label: 'Ativas' },
  { value: 'canceling', label: 'Cancelando' },
  { value: 'canceled', label: 'Canceladas' },
  { value: 'all', label: 'Todas' },
]

// Diálogo do PIX (reemitido). Reaproveita o layout da tela pública de inscrição.
function PixDialog({ open, loading, pix, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>PIX da mensalidade</DialogTitle>
      <DialogContent dividers sx={{ textAlign: 'center' }}>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress /></Stack>
        ) : pix && (pix.qrCodeImage || pix.copyPaste) ? (
          <Stack spacing={2} alignItems="center">
            {pix.amount != null && (
              <Typography variant="h6" sx={{ fontWeight: 800 }}>{BRL(pix.amount)}</Typography>
            )}
            {pix.qrCodeImage && (
              <img src={qrSrc(pix.qrCodeImage)} alt="QR Code PIX" style={{ width: 220, maxWidth: '100%', borderRadius: 12 }} />
            )}
            {pix.copyPaste && (
              <Stack spacing={1} sx={{ width: '100%' }}>
                <TextField value={pix.copyPaste} fullWidth size="small" InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
                <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => navigator?.clipboard?.writeText(pix.copyPaste).catch(() => {})}>
                  Copiar código PIX
                </Button>
              </Stack>
            )}
          </Stack>
        ) : (
          <Alert severity="warning">Não foi possível gerar o PIX.</Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}

// Diálogo de detalhes (somente leitura).
function DetailsDialog({ open, id, onClose }) {
  const detailQuery = useQuery({
    queryKey: ['subscription', id],
    queryFn: () => subscriptionsService.get(id),
    enabled: open && Boolean(id),
  })
  const s = detailQuery.data?.subscription
  const Row = ({ label, value }) => (
    <Grid container spacing={1} sx={{ py: 0.5 }}>
      <Grid item xs={5}><Typography variant="body2" color="text.secondary">{label}</Typography></Grid>
      <Grid item xs={7}><Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>{value ?? '—'}</Typography></Grid>
    </Grid>
  )
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Detalhes da assinatura</DialogTitle>
      <DialogContent dividers>
        {detailQuery.isLoading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress /></Stack>
        ) : !s ? (
          <Alert severity="error">Não foi possível carregar os detalhes.</Alert>
        ) : (
          <Box>
            <Row label="Empresa" value={s.company_name} />
            <Row label="Status da empresa" value={s.company_status} />
            <Row label="Plano" value={s.plan_name} />
            <Row label="Período" value={s.period === 'annual' ? 'Anual' : 'Mensal'} />
            <Row label="Valor" value={BRL(s.amount)} />
            <Row label="Status da assinatura" value={STATUS_META[s.status]?.label || s.status} />
            <Divider sx={{ my: 1 }} />
            <Row label="Responsável" value={s.client_name} />
            <Row label="E-mail" value={s.client_email} />
            <Row label="Telefone" value={s.client_phone} />
            <Row label="CPF/CNPJ" value={s.document_cpf || s.document_cnpj} />
            <Divider sx={{ my: 1 }} />
            <Row label="Status da cobrança" value={s.billing_status} />
            <Row label="TXID" value={s.txid} />
            <Row label="Cupom" value={s.promo_code} />
            <Row label="Criada em" value={fmtDate(s.created_at)} />
            <Row label="Ativada em" value={s.activated_at ? fmtDate(s.activated_at) : '—'} />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}

// Diálogo de reativação: escolhe plano + período para reativar a assinatura.
function ReactivateDialog({ open, sub, onClose, onConfirm, saving }) {
  const plansQuery = useQuery({ queryKey: ['plans'], queryFn: plansService.list, enabled: open })
  const plans = plansQuery.data?.plans || []
  const [planId, setPlanId] = useState('')
  const [period, setPeriod] = useState('monthly')

  React.useEffect(() => {
    if (open) { setPlanId(sub?.plan_id || ''); setPeriod(sub?.period || 'monthly') }
  }, [open, sub])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Reativar assinatura</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Reativa a empresa <strong>{sub?.company_name}</strong> e seus usuários, aplica o plano escolhido e gera uma nova cobrança.
          </Typography>
          <TextField select SelectProps={{ native: true }} label="Plano" value={planId} onChange={(e) => setPlanId(e.target.value)} fullWidth>
            <option value="" disabled>Selecione…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </TextField>
          <ToggleButtonGroup exclusive size="small" color="primary" value={period} onChange={(_, v) => v && setPeriod(v)}>
            {PERIODS.map((p) => <ToggleButton key={p.value} value={p.value} sx={{ px: 2.5, fontWeight: 700 }}>{p.label}</ToggleButton>)}
          </ToggleButtonGroup>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disabled={saving || !planId} onClick={() => onConfirm({ plan_id: Number(planId), period })}>
          {saving ? 'Reativando…' : 'Reativar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function SubscriptionsAdminPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { user } = useAuth()
  const isMaster = user?.role === 'master'

  const [filter, setFilter] = useState('pending_payment')
  const [snack, setSnack] = useState(null)
  const [pixDialog, setPixDialog] = useState({ open: false, loading: false, pix: null })
  const [detailsId, setDetailsId] = useState(null)
  const [reactivateSub, setReactivateSub] = useState(null)

  const statusParam = filter === 'all' ? undefined : filter
  const listQuery = useQuery({
    queryKey: ['subscriptions', filter],
    queryFn: () => subscriptionsService.list(statusParam),
    enabled: isMaster,
  })
  const subscriptions = listQuery.data?.subscriptions || []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['subscriptions'] })

  const confirmMutation = useMutation({
    mutationFn: (id) => subscriptionsService.confirm(id),
    onSuccess: () => { invalidate(); setSnack({ severity: 'success', msg: 'Pagamento confirmado — empresa ativada.' }) },
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao confirmar o pagamento.' }),
  })

  const cancelMutation = useMutation({
    mutationFn: (id) => subscriptionsService.cancel(id),
    onSuccess: () => { invalidate(); setSnack({ severity: 'success', msg: 'Assinatura cancelada.' }) },
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao cancelar a assinatura.' }),
  })

  const resendMutation = useMutation({
    mutationFn: (id) => subscriptionsService.resendPix(id),
    onMutate: () => setPixDialog({ open: true, loading: true, pix: null }),
    onSuccess: (data) => setPixDialog({ open: true, loading: false, pix: data?.pix || null }),
    onError: (err) => {
      setPixDialog({ open: false, loading: false, pix: null })
      setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao gerar o PIX.' })
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: ({ id, payload }) => subscriptionsService.reactivate(id, payload),
    onSuccess: () => { invalidate(); setReactivateSub(null); setSnack({ severity: 'success', msg: 'Assinatura reativada.' }) },
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao reativar.' }),
  })

  const handleConfirm = async (sub) => {
    const ok = await confirm({
      title: 'Confirmar pagamento',
      description: `Confirmar o pagamento da assinatura de "${sub.company_name}" e liberar o acesso da empresa?`,
      confirmText: 'Confirmar pagamento',
    })
    if (ok) confirmMutation.mutate(sub.id)
  }

  const handleCancel = async (sub) => {
    const active = sub.status === 'active' || sub.status === 'canceling'
    const ok = await confirm({
      title: 'Cancelar assinatura',
      description: active
        ? `Cancelar imediatamente a assinatura de "${sub.company_name}"? A empresa e seus usuários serão inativados na hora.`
        : `Cancelar a inscrição de "${sub.company_name}"? A empresa não terá acesso liberado. Esta ação não pode ser desfeita.`,
      confirmText: 'Cancelar assinatura',
      color: 'error',
    })
    if (ok) cancelMutation.mutate(sub.id)
  }

  if (!isMaster) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Assinaturas" subtitle="Gestão das assinaturas do sistema." />
        <Alert severity="warning">Esta área é exclusiva do perfil master.</Alert>
      </Stack>
    )
  }

  const busyId = confirmMutation.isPending ? confirmMutation.variables
    : cancelMutation.isPending ? cancelMutation.variables : null

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Assinaturas"
        subtitle="Acompanhe as inscrições, confirme pagamentos manualmente e libere o acesso das empresas-cliente."
      />

      <Stack direction="row" justifyContent="center">
        <ToggleButtonGroup exclusive value={filter} onChange={(_, v) => v && setFilter(v)} size="small" color="primary">
          {FILTERS.map((f) => (
            <ToggleButton key={f.value} value={f.value} sx={{ px: 2.5, fontWeight: 700 }}>{f.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {listQuery.isError && (
        <Alert severity="error">{listQuery.error?.response?.data?.error || 'Falha ao carregar as assinaturas.'}</Alert>
      )}

      <PapperBlock title="Assinaturas" subtitle="Inscrições e seus pagamentos" icon={<ReceiptLongIcon />} noPadding>
        <Box sx={{ p: 2 }}>
          {listQuery.isLoading ? (
            <Stack spacing={1}>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={96} />)}</Stack>
          ) : subscriptions.length === 0 ? (
            <EmptyState icon={<ReceiptLongIcon />} title="Nenhuma assinatura" description="Não há assinaturas para o filtro selecionado." />
          ) : (
            <Grid container spacing={2}>
              {subscriptions.map((sub) => {
                const pending = sub.status === 'pending_payment'
                const isActive = sub.status === 'active'
                const isCanceling = sub.status === 'canceling'
                const isCanceled = sub.status === 'canceled'
                const busy = busyId === sub.id
                return (
                  <Grid item xs={12} md={6} key={sub.id}>
                    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>{sub.company_name}</Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {sub.plan_name || 'Sem plano'} · {sub.period === 'annual' ? 'Anual' : 'Mensal'} · {BRL(sub.amount)}
                          </Typography>
                        </Box>
                        {statusChip(sub.status)}
                      </Stack>

                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        <Chip size="small" variant="outlined" label={`Criada: ${fmtDate(sub.created_at)}`} />
                        <Chip size="small" variant="outlined" label={`Cobrança: ${sub.billing_status || '—'}`} />
                        {sub.has_pix && <Chip size="small" variant="outlined" color="info" label="PIX gerado" />}
                        {isCanceling && sub.access_until && (
                          <Chip size="small" variant="outlined" color="warning" label={`Ativa até ${fmtDate(sub.access_until)}`} />
                        )}
                      </Stack>

                      <Box sx={{ flex: 1 }} />
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                        {pending && (
                          <Button size="small" variant="contained" color="success" startIcon={<CheckCircleIcon />} disabled={busy} onClick={() => handleConfirm(sub)}>
                            Confirmar
                          </Button>
                        )}
                        {pending && (
                          <Button size="small" variant="outlined" startIcon={<QrCode2Icon />} disabled={resendMutation.isPending} onClick={() => resendMutation.mutate(sub.id)}>
                            Reenviar PIX
                          </Button>
                        )}
                        {(isCanceled || isCanceling) && (
                          <Button size="small" variant="contained" color="success" startIcon={<RestartAltIcon />} onClick={() => setReactivateSub(sub)}>
                            Reativar
                          </Button>
                        )}
                        {(pending || isActive || isCanceling) && (
                          <Button size="small" variant="outlined" color="error" startIcon={<CancelOutlinedIcon />} disabled={busy} onClick={() => handleCancel(sub)}>
                            Cancelar
                          </Button>
                        )}
                        <Tooltip title="Detalhes">
                          <Button size="small" variant="text" startIcon={<InfoOutlinedIcon />} onClick={() => setDetailsId(sub.id)}>
                            Detalhes
                          </Button>
                        </Tooltip>
                      </Stack>
                    </Box>
                  </Grid>
                )
              })}
            </Grid>
          )}
        </Box>
      </PapperBlock>

      <PixDialog
        open={pixDialog.open}
        loading={pixDialog.loading}
        pix={pixDialog.pix}
        onClose={() => setPixDialog({ open: false, loading: false, pix: null })}
      />
      <DetailsDialog open={Boolean(detailsId)} id={detailsId} onClose={() => setDetailsId(null)} />
      <ReactivateDialog
        open={Boolean(reactivateSub)}
        sub={reactivateSub}
        saving={reactivateMutation.isPending}
        onClose={() => setReactivateSub(null)}
        onConfirm={(payload) => reactivateMutation.mutate({ id: reactivateSub.id, payload })}
      />

      <Snackbar open={Boolean(snack)} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.msg}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
