import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, Grid, Skeleton, Snackbar,
  Stack, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import InsightsIcon from '@mui/icons-material/Insights'
import RefreshIcon from '@mui/icons-material/Refresh'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import RiskBadge from '@/components/RiskBadge'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { useSensitive } from '@/features/permissions/useSensitive'
import { useConfirm } from '@/components/ConfirmDialog'
import { reportsService } from './reports.service'

const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const BANDS = [
  { key: 'todos', label: 'Todos', color: 'primary' },
  { key: 'alto', label: 'Alto', color: 'error' },
  { key: 'medio', label: 'Médio', color: 'warning' },
  { key: 'baixo', label: 'Baixo', color: 'success' },
  { key: 'bom_pagador', label: 'Bons pagadores', color: 'success' },
]

const PAGE_SIZE = 20

// Cartão de KPI no padrão do app (Card outlined) + badge de ícone colorido.
function StatTile({ label, value, icon, color }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            flex: '0 0 auto',
            display: 'grid',
            placeItems: 'center',
            color: `${color}.main`,
            bgcolor: (t) => alpha(t.palette[color].main, t.palette.mode === 'dark' ? 0.22 : 0.12),
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2, display: 'block' }}>
            {label}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.1 }} noWrap>
            {value}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

function RiskRow({ rank, row, onCobrar, cobrando, onVer, canCobrar, money }) {
  return (
    <Box
      sx={{
        px: { xs: 2, md: 3 },
        py: 2,
        display: 'flex',
        gap: 2,
        alignItems: { xs: 'flex-start', md: 'center' },
        flexDirection: { xs: 'column', md: 'row' },
        transition: 'background-color .15s ease',
        '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.03) },
      }}
    >
      {/* Rank + score + identidade */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1, width: '100%' }}>
        <Typography sx={{ width: 22, textAlign: 'center', color: 'text.disabled', fontWeight: 700, flex: '0 0 auto' }}>
          {rank}
        </Typography>
        <RiskBadge score={row.score} band={row.band} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }} noWrap>{row.client_name}</Typography>
          {row.client_responsavel && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {row.client_responsavel}
            </Typography>
          )}
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
            {(row.factors || []).map((f) => (
              <Chip
                key={f.key}
                label={f.label}
                size="small"
                variant="outlined"
                sx={{ height: 22, fontSize: 11 }}
              />
            ))}
          </Stack>
        </Box>
      </Box>

      {/* Valor em aberto + ações */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          width: { xs: '100%', md: 'auto' },
          justifyContent: { xs: 'space-between', md: 'flex-end' },
          pl: { xs: 6, md: 0 },
        }}
      >
        <Box sx={{ textAlign: { md: 'right' }, minWidth: 96 }}>
          {row.open_overdue_count > 0 ? (
            <>
              <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {money(row.open_overdue_amount)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.open_overdue_count} em aberto · {row.max_open_days}d
              </Typography>
            </>
          ) : (
            <Typography variant="caption" color="text.secondary">Em dia</Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ flex: '0 0 auto' }}>
          {row.open_overdue_count > 0 && canCobrar && (
            <Tooltip title="Enviar cobrança por WhatsApp">
              <span>
                <Button
                  size="small"
                  color="success"
                  variant="contained"
                  disableElevation
                  startIcon={<WhatsAppIcon />}
                  disabled={cobrando}
                  onClick={() => onCobrar(row)}
                  sx={{ borderRadius: 2, textTransform: 'none' }}
                >
                  Cobrar
                </Button>
              </span>
            </Tooltip>
          )}
          <Tooltip title="Ver cliente">
            <span>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<PersonOutlineIcon />}
                onClick={() => onVer(row)}
                sx={{ borderRadius: 2, textTransform: 'none' }}
              >
                Cliente
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Box>
    </Box>
  )
}

export default function RiskPortfolioPage() {
  const { selectedCompanyId } = useAuth()
  const enabled = Number.isInteger(selectedCompanyId)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { can } = usePermissions()
  const { money } = useSensitive()
  const [band, setBand] = React.useState('todos')
  const [toast, setToast] = React.useState(null)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['risk', selectedCompanyId],
    queryFn: reportsService.risk,
    enabled,
  })

  const notify = useMutation({
    // minDaysOverdue: 0 → cobra qualquer cobrança vencida (alinha com o que a
    // carteira conta como "em aberto"), não só as de +30 dias.
    mutationFn: (clientId) => reportsService.notifyOverdueClient(clientId, { minDaysOverdue: 0 }),
    onSuccess: (res) =>
      setToast({ severity: 'success', msg: `Cobrança enviada para ${res?.clientName || 'o cliente'} (${res?.billingsCount || 0} cobrança(s)).` }),
    onError: (err) =>
      setToast({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao enviar a cobrança.' }),
  })

  const [visible, setVisible] = React.useState(PAGE_SIZE)

  const summary = data?.summary
  const counts = {
    todos: summary?.totalClients ?? 0,
    alto: summary?.alto ?? 0,
    medio: summary?.medio ?? 0,
    baixo: summary?.baixo ?? 0,
    bom_pagador: summary?.bomPagador ?? 0,
  }
  const rows = React.useMemo(() => {
    const list = data?.data || []
    return band === 'todos' ? list : list.filter((r) => r.band === band)
  }, [data, band])

  // Ao trocar de faixa (ou recarregar), volta a mostrar só a primeira página.
  React.useEffect(() => { setVisible(PAGE_SIZE) }, [band, data])
  const visibleRows = rows.slice(0, visible)

  const handleCobrar = async (row) => {
    const ok = await confirm({
      title: 'Enviar cobrança por WhatsApp',
      description: `Enviar a lista de cobranças em atraso para "${row.client_name}"?`,
      confirmText: 'Enviar cobrança',
      color: 'success',
    })
    if (ok) notify.mutate(row.client_id)
  }

  if (!enabled) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Carteira em risco" subtitle="Priorize a cobrança pelos clientes com maior risco de inadimplência." />
        <CompanyRequiredAlert />
      </Stack>
    )
  }

  const bandChips = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
      {BANDS.map((b) => (
        <Chip
          key={b.key}
          label={`${b.label} (${counts[b.key] ?? 0})`}
          color={band === b.key ? b.color : 'default'}
          variant={band === b.key ? 'filled' : 'outlined'}
          onClick={() => setBand(b.key)}
          sx={{ fontWeight: band === b.key ? 700 : 500 }}
        />
      ))}
    </Stack>
  )

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="Carteira em risco"
        subtitle="Score de inadimplência por cliente — comece a cobrança pelo topo da lista."
        actions={
          <Button onClick={() => refetch()} startIcon={<RefreshIcon />} variant="outlined" disabled={isFetching}>
            Recalcular
          </Button>
        }
      />

      {isError && <Alert severity="error">{error?.response?.data?.error || 'Falha ao carregar a carteira.'}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <StatTile label="Risco alto" value={summary?.alto ?? '—'} color="error" icon={<WhatshotIcon />} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label="Risco médio" value={summary?.medio ?? '—'} color="warning" icon={<TrendingUpIcon />} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label="Risco baixo" value={summary?.baixo ?? '—'} color="success" icon={<VerifiedUserIcon />} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label="Total em aberto" value={money(summary?.totalOpenOverdueAmount)} color="primary" icon={<AccountBalanceWalletIcon />} />
        </Grid>
      </Grid>

      <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', sm: 'flex-end' } }}>{bandChips}</Box>

      <PapperBlock
        title="Priorização de cobrança"
        subtitle={`${summary?.totalClients ?? 0} cliente(s) analisado(s)${data?.generatedAt ? ` · ${String(data.generatedAt).split('-').reverse().join('/')}` : ''}`}
        icon={<InsightsIcon />}
        iconColor="linear-gradient(135deg, #6366f1, #8b5cf6)"
        noPadding
      >
        {isLoading && (
          <Box sx={{ p: 3 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Stack key={i} direction="row" spacing={2} alignItems="center" sx={{ py: 1.5 }}>
                <Skeleton variant="circular" width={56} height={56} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton width="40%" />
                  <Skeleton width="65%" />
                </Box>
                <Skeleton variant="rounded" width={90} height={32} />
              </Stack>
            ))}
          </Box>
        )}

        {!isLoading && rows.length === 0 && (
          <Box sx={{ py: 7, textAlign: 'center', color: 'text.secondary' }}>
            <InsightsIcon sx={{ fontSize: 44, opacity: 0.35 }} />
            <Typography sx={{ mt: 1 }}>Nenhum cliente nesta faixa.</Typography>
          </Box>
        )}

        {!isLoading && visibleRows.map((row, idx) => (
          <React.Fragment key={row.client_id}>
            {idx > 0 && <Divider />}
            <RiskRow
              rank={idx + 1}
              row={row}
              money={money}
              cobrando={notify.isPending}
              canCobrar={can('billings.notify')}
              onCobrar={handleCobrar}
              onVer={(r) => navigate(`/clients/${r.client_id}/edit`)}
            />
          </React.Fragment>
        ))}

        {!isLoading && rows.length > visible && (
          <>
            <Divider />
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
              <Button variant="outlined" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Ver mais ({visible} de {rows.length})
              </Button>
            </Box>
          </>
        )}
      </PapperBlock>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
