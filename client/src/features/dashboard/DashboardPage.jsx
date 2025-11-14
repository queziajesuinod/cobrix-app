import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Stack,
  Box,
  LinearProgress,
  Alert,
  Skeleton,
} from '@mui/material'
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn'
import PaymentsIcon from '@mui/icons-material/Payments'
import TodayIcon from '@mui/icons-material/Today'
import TimelineIcon from '@mui/icons-material/Timeline'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { dashboardService } from '@/features/dashboard/dashboard.service'

const formatCurrency = (value) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function IndicatorCard({ icon, title, value, subtitle, gradient, extra }) {
  return (
    <Card
      sx={{
        height: '100%',
        borderRadius: 3,
        background: gradient,
        color: 'common.white',
        boxShadow: '0 12px 30px rgba(15,23,42,0.25)',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <CardContent sx={{ width: '100%' }}>
        <Stack spacing={2} alignItems="center" textAlign="center">
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '20px',
              backgroundColor: 'rgba(255,255,255,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ textTransform: 'uppercase', opacity: 0.8 }}>
              {title}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {extra && <Box sx={{ width: '100%' }}>{extra}</Box>}
        </Stack>
      </CardContent>
    </Card>
  )
}

function FutureReceivablesCard({ data }) {
  const rows = [
    { label: 'Próximos 7 dias', value: data.next7 },
    { label: 'Próximos 15 dias', value: data.next15 },
    { label: 'Próximos 30 dias', value: data.next30 },
  ]

  return (
    <Card
      sx={{
        borderRadius: 3,
        background: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)',
        color: 'common.white',
        boxShadow: '0 12px 30px rgba(15,23,42,0.25)',
      }}
    >
      <CardContent>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
            <TimelineIcon />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Recebimentos futuros
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {rows.map((row) => (
              <Box
                key={row.label}
                sx={{
                  flex: 1,
                  textAlign: 'center',
                  borderRadius: 2,
                  border: '1px solid rgba(255,255,255,0.3)',
                  px: 2,
                  py: 2,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <Typography variant="caption" sx={{ textTransform: 'uppercase', opacity: 0.8 }}>
                  {row.label}
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  {formatCurrency(row.value)}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { selectedCompanyId, user } = useAuth()
  const enabled = Number.isInteger(selectedCompanyId)

  const summaryQuery = useQuery({
    queryKey: ['dashboard-summary', selectedCompanyId],
    queryFn: dashboardService.getSummary,
    enabled,
    staleTime: 30_000,
  })

  const summary = summaryQuery.data
  const billing = summary?.billing || { paidAmount: 0, pendingAmount: 0, totalAmount: 0 }
  const totals = summary?.totals || { contractsActive: 0, clientsActive: 0 }
  const today = summary?.today || { dueCount: 0, dueAmount: 0 }
  const future = summary?.futureReceivables || { next7: 0, next15: 0, next30: 0 }

  const paidRatio =
    billing.totalAmount > 0 ? Math.min(100, (billing.paidAmount / billing.totalAmount) * 100) : 0

  return (
    <>
      <CompanyRequiredAlert />
      {!enabled && user?.role !== 'master' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Selecione uma empresa para visualizar seus indicadores financeiros.
        </Alert>
      )}
      {summaryQuery.isError && enabled && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {summaryQuery.error?.response?.data?.error || summaryQuery.error?.message || 'Erro ao carregar o dashboard.'}
        </Alert>
      )}

      <Grid container spacing={3} justifyContent="center">
        <Grid item xs={12} md={6} lg={4} xl={3}>
          {summaryQuery.isLoading ? (
            <Skeleton variant="rounded" height={170} />
          ) : (
            <IndicatorCard
              title="Contratos ativos"
              value={totals.contractsActive}
              subtitle={`Clientes ativos: ${totals.clientsActive}`}
              icon={<AssignmentTurnedInIcon sx={{ fontSize: 30 }} />}
              gradient="linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)"
            />
          )}
        </Grid>

        <Grid item xs={12} md={6} lg={4} xl={3}>
          {summaryQuery.isLoading ? (
            <Skeleton variant="rounded" height={170} />
          ) : (
            <IndicatorCard
              title="Contratos pendentes vs pagos"
              value={formatCurrency(billing.pendingAmount)}
              subtitle={`Contratos pagos: ${formatCurrency(billing.paidAmount)}`}
              icon={<PaymentsIcon sx={{ fontSize: 30 }} />}
              gradient="linear-gradient(135deg, #8E2DE2 0%, #4A00E0 100%)"
              extra={
                <Stack spacing={1}>
                  <LinearProgress
                    variant="determinate"
                    value={paidRatio}
                    sx={{
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: 'rgba(255,255,255,0.25)',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 999,
                        backgroundColor: '#fff',
                      },
                    }}
                  />
                  <Typography variant="caption" sx={{ opacity: 0.85 }}>
                    {paidRatio.toFixed(0)}% do valor contratado já está marcado como pago
                  </Typography>
                </Stack>
              }
            />
          )}
        </Grid>

        <Grid item xs={12} md={6} lg={4} xl={3}>
          {summaryQuery.isLoading ? (
            <Skeleton variant="rounded" height={170} />
          ) : (
            <IndicatorCard
              title="Vencimentos de hoje"
              value={today.dueCount}
              subtitle={`Total do dia: ${formatCurrency(today.dueAmount)}`}
              icon={<TodayIcon sx={{ fontSize: 30 }} />}
              gradient="linear-gradient(135deg, #11998e 0%, #38ef7d 100%)"
            />
          )}
        </Grid>
        <Grid item xs={12}>
          {summaryQuery.isLoading ? (
            <Skeleton variant="rounded" height={190} />
          ) : (
            <FutureReceivablesCard data={future} />
          )}
        </Grid>
      </Grid>
    </>
  )
}
