import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Grid, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import { useConfirm } from '@/components/ConfirmDialog'
import { subscriptionSelfService } from './subscription-self.service'
import { publicService } from '@/features/public/public.service'

const BRL = (v) => v == null
  ? '—'
  : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtDate = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

const qrSrc = (v) => !v ? null : (String(v).startsWith('data:') ? v : `data:image/png;base64,${v}`)

const STATUS_META = {
  pending_payment: { label: 'Aguardando pagamento', color: 'warning' },
  active: { label: 'Ativa', color: 'success' },
  canceling: { label: 'Cancelamento agendado', color: 'warning' },
  canceled: { label: 'Cancelada', color: 'default' },
}

// Diálogo de escolha do novo plano (upgrade / mudança de plano).
function UpgradeDialog({ open, currentPlanId, currentPeriod, currentAmount, onClose, onConfirm, saving }) {
  const plansQuery = useQuery({ queryKey: ['public-plans'], queryFn: publicService.plans, enabled: open })
  const plans = plansQuery.data?.plans || []
  const [period, setPeriod] = useState(currentPeriod || 'monthly')
  const [planId, setPlanId] = useState(null)

  React.useEffect(() => { if (open) { setPeriod(currentPeriod || 'monthly'); setPlanId(null) } }, [open, currentPeriod])

  const priceOf = (p) => period === 'annual' ? p.price_annual : p.price_monthly

  // Nota dinâmica sobre a cobrança conforme upgrade/downgrade/troca de período.
  const selected = plans.find((p) => p.id === planId)
  const samePeriod = period === (currentPeriod || 'monthly')
  const selPrice = selected ? priceOf(selected) : null
  let chargeNote = null
  if (selected && selPrice != null) {
    if (!samePeriod) chargeNote = { severity: 'info', text: 'Troca de período: a cobrança atual é encerrada e uma nova, com o valor cheio do plano, é gerada agora.' }
    else if (selPrice > Number(currentAmount || 0)) chargeNote = { severity: 'warning', text: 'Upgrade: você paga agora apenas a diferença proporcional aos dias restantes do período já pago.' }
    else chargeNote = { severity: 'success', text: 'Downgrade: sem cobrança agora e sem saldo. O novo valor passa a valer no próximo ciclo.' }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Mudar de plano</DialogTitle>
      <DialogContent dividers>
        <Stack alignItems="center" sx={{ mb: 2 }}>
          <ToggleButtonGroup exclusive size="small" color="primary" value={period} onChange={(_, v) => v && setPeriod(v)}>
            <ToggleButton value="monthly" sx={{ px: 3, fontWeight: 700 }}>Mensal</ToggleButton>
            <ToggleButton value="annual" sx={{ px: 3, fontWeight: 700 }}>Anual</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {plansQuery.isLoading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress /></Stack>
        ) : (
          <Grid container spacing={2}>
            {plans.map((p) => {
              const price = priceOf(p)
              const available = price != null
              const isCurrent = p.id === currentPlanId && period === currentPeriod
              const selected = planId === p.id
              return (
                <Grid item xs={12} sm={6} md={4} key={p.id}>
                  <Card
                    onClick={available && !isCurrent ? () => setPlanId(p.id) : undefined}
                    sx={{
                      p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 0.5,
                      cursor: available && !isCurrent ? 'pointer' : 'not-allowed',
                      opacity: available ? 1 : 0.5,
                      border: '2px solid', borderColor: selected ? 'primary.main' : 'divider',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>{p.name}</Typography>
                      {isCurrent && <Chip size="small" label="Atual" />}
                      {selected && <Chip size="small" color="primary" icon={<CheckIcon />} label="Escolhido" />}
                    </Stack>
                    {available ? (
                      <Typography variant="h5" sx={{ fontWeight: 800 }}>{BRL(price)}<Typography component="span" variant="caption" color="text.secondary">/{period === 'annual' ? 'ano' : 'mês'}</Typography></Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">Indisponível no {period === 'annual' ? 'anual' : 'mensal'}</Typography>
                    )}
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 'auto', pt: 1 }}>
                      <Chip size="small" variant="outlined" label={p.clients_limit == null ? 'Clientes ∞' : `${p.clients_limit} clientes`} />
                      <Chip size="small" variant="outlined" label={p.contracts_limit == null ? 'Contratos ∞' : `${p.contracts_limit} contratos`} />
                    </Stack>
                  </Card>
                </Grid>
              )
            })}
          </Grid>
        )}
        {chargeNote && (
          <Alert severity={chargeNote.severity} sx={{ mt: 2 }}>{chargeNote.text}</Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disabled={saving || !planId} onClick={() => onConfirm({ plan_id: planId, period })}>
          {saving ? 'Alterando…' : 'Confirmar mudança'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Diálogo do PIX gerado após a mudança de plano.
function PixResultDialog({ pix, onClose }) {
  return (
    <Dialog open={Boolean(pix)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Plano alterado — pague o novo valor</DialogTitle>
      <DialogContent dividers sx={{ textAlign: 'center' }}>
        {pix && (pix.qrCodeImage || pix.copyPaste) ? (
          <Stack spacing={2} alignItems="center">
            {pix.amount != null && <Typography variant="h6" sx={{ fontWeight: 800 }}>{BRL(pix.amount)}</Typography>}
            {pix.qrCodeImage && <img src={qrSrc(pix.qrCodeImage)} alt="QR Code PIX" style={{ width: 220, maxWidth: '100%', borderRadius: 12 }} />}
            {pix.copyPaste && (
              <Stack spacing={1} sx={{ width: '100%' }}>
                <TextField value={pix.copyPaste} fullWidth size="small" InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
                <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => navigator?.clipboard?.writeText(pix.copyPaste).catch(() => {})}>Copiar código PIX</Button>
              </Stack>
            )}
          </Stack>
        ) : (
          <Alert severity="success">Plano alterado com sucesso.</Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}><Button onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  )
}

export default function MySubscriptionPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [snack, setSnack] = useState(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [pixResult, setPixResult] = useState(null)

  const subQuery = useQuery({ queryKey: ['my-subscription'], queryFn: subscriptionSelfService.get })
  const sub = subQuery.data?.subscription || null

  const cancelMutation = useMutation({
    mutationFn: () => subscriptionSelfService.cancel(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] })
      setSnack({ severity: 'success', msg: 'Cancelamento registrado.' })
    },
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao cancelar.' }),
  })

  const changeMutation = useMutation({
    mutationFn: (payload) => subscriptionSelfService.changePlan(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] })
      setUpgradeOpen(false)
      // Só mostra o PIX quando há cobrança (upgrade/novo ciclo). Downgrade não cobra.
      if (data?.pix && (data.pix.copyPaste || data.pix.qrCodeImage)) {
        setPixResult(data.pix)
      }
      setSnack({
        severity: 'success',
        msg: data?.mode === 'downgrade'
          ? 'Plano alterado. O novo valor passa a valer no próximo ciclo (sem cobrança agora).'
          : 'Plano alterado com sucesso.',
      })
    },
    onError: (err) => setSnack({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao alterar o plano.' }),
  })

  const handleCancel = async () => {
    const ok = await confirm({
      title: 'Cancelar assinatura',
      description: 'Você continuará com acesso até o fim do período já pago. Depois disso, a conta será desativada e novas cobranças não serão geradas. Deseja cancelar?',
      confirmText: 'Cancelar assinatura',
      color: 'error',
    })
    if (ok) cancelMutation.mutate()
  }

  const meta = sub ? (STATUS_META[sub.status] || { label: sub.status, color: 'default' }) : null
  const canCancel = sub && (sub.status === 'active' || sub.status === 'pending_payment')
  const canChange = sub && (sub.status === 'active' || sub.status === 'canceling')

  return (
    <Stack spacing={2}>
      <PageHeader title="Minha assinatura" subtitle="Veja os detalhes do seu plano e gerencie sua assinatura." />

      <PapperBlock title="Plano atual" subtitle="Dados da sua assinatura" icon={<ReceiptLongIcon />}>
        {subQuery.isLoading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress /></Stack>
        ) : !sub ? (
          <Alert severity="info">Nenhuma assinatura encontrada para esta empresa.</Alert>
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{sub.plan_name || 'Plano'}</Typography>
              <Chip size="small" color={meta.color} variant={meta.color === 'default' ? 'outlined' : 'filled'} label={meta.label} sx={{ fontWeight: 700 }} />
            </Stack>
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Box>
                <Typography variant="caption" color="text.secondary">Valor</Typography>
                <Typography sx={{ fontWeight: 700 }}>{BRL(sub.amount)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Período</Typography>
                <Typography sx={{ fontWeight: 700 }}>{sub.period === 'annual' ? 'Anual' : 'Mensal'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Desde</Typography>
                <Typography sx={{ fontWeight: 700 }}>{fmtDate(sub.activated_at || sub.created_at)}</Typography>
              </Box>
            </Stack>

            {sub.status === 'canceling' && (
              <Alert severity="warning">
                Cancelamento agendado. Seu acesso continua ativo até <strong>{fmtDate(sub.access_until)}</strong>. Depois dessa data a conta será desativada.
              </Alert>
            )}
            {sub.status === 'canceled' && (
              <Alert severity="info">Sua assinatura foi cancelada. Para voltar a usar, entre em contato com o suporte.</Alert>
            )}

            {(canChange || canCancel) && (
              <>
                <Divider />
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {canChange && (
                    <Button variant="contained" startIcon={<TrendingUpIcon />} onClick={() => setUpgradeOpen(true)}>
                      Fazer upgrade / mudar plano
                    </Button>
                  )}
                  {canCancel && (
                    <Button variant="outlined" color="error" startIcon={<CancelOutlinedIcon />} onClick={handleCancel} disabled={cancelMutation.isPending}>
                      {cancelMutation.isPending ? 'Cancelando…' : 'Cancelar assinatura'}
                    </Button>
                  )}
                </Stack>
              </>
            )}
          </Stack>
        )}
      </PapperBlock>

      <UpgradeDialog
        open={upgradeOpen}
        currentPlanId={sub?.plan_id}
        currentPeriod={sub?.period}
        currentAmount={sub?.amount}
        saving={changeMutation.isPending}
        onClose={() => setUpgradeOpen(false)}
        onConfirm={(payload) => changeMutation.mutate(payload)}
      />
      <PixResultDialog pix={pixResult} onClose={() => setPixResult(null)} />

      {snack && <Alert severity={snack.severity} onClose={() => setSnack(null)}>{snack.msg}</Alert>}
    </Stack>
  )
}
