import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Stack,
  Box,
  Alert,
  Skeleton,
  useTheme,
} from '@mui/material'
import { PieChart } from '@mui/x-charts/PieChart'
import { BarChart } from '@mui/x-charts/BarChart'
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn'
import PaymentsIcon from '@mui/icons-material/Payments'
import TodayIcon from '@mui/icons-material/Today'
import PeopleAltIcon from '@mui/icons-material/PeopleAlt'
import TimelineIcon from '@mui/icons-material/Timeline'
import DonutLargeIcon from '@mui/icons-material/DonutLarge'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import PapperBlock from '@/components/PapperBlock'
import { useAuth } from '@/features/auth/AuthContext'
import { dashboardService } from '@/features/dashboard/dashboard.service'

// Gradientes vibrantes dos KPI cards (assinatura visual Dandelion).
const GRAD = {
  blue: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)',
  purple: 'linear-gradient(135deg, #8E2DE2 0%, #4A00E0 100%)',
  orange: 'linear-gradient(135deg, #f7971e 0%, #ffb300 100%)',
  green: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
}

const formatCurrency = (value) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Formato compacto para eixos/tooltip (ex.: R$ 1,2 mil)
const formatCompactCurrency = (value) => {
  const n = Number(value || 0)
  if (Math.abs(n) >= 1000) {
    return `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  }
  return formatCurrency(n)
}

function StatCard({ icon, title, value, subtitle, gradient }) {
  return (
    <Card sx={{ height: '100%', background: gradient, color: '#fff', border: 'none' }}>
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box
            sx={{
              width: 54,
              height: 54,
              borderRadius: 2.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(255,255,255,0.22)',
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.4, opacity: 0.9 }}>
              {title}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}

function BillingDonutCard({ paid, pending }) {
  const theme = useTheme()
  const colorPaid = theme.palette.success.main
  const colorPending = theme.palette.warning.main
  const total = paid + pending
  const hasData = total > 0
  const paidPct = hasData ? Math.round((paid / total) * 100) : 0

  return (
    <PapperBlock
      title="Faturamento do mês"
      subtitle="Distribuição entre valores pagos e pendentes"
      icon={<DonutLargeIcon />}
      iconColor={GRAD.purple}
    >
      {hasData ? (
        <Box sx={{ position: 'relative' }}>
          <PieChart
            height={260}
            skipAnimation
            series={[
              {
                innerRadius: 62,
                outerRadius: 100,
                paddingAngle: 2,
                cornerRadius: 4,
                data: [
                  { id: 'paid', value: paid, label: 'Pago', color: colorPaid },
                  { id: 'pending', value: pending, label: 'Pendente', color: colorPending },
                ],
                valueFormatter: (item) => formatCurrency(item.value),
              },
            ]}
            slotProps={{
              legend: { direction: 'row', position: { vertical: 'bottom', horizontal: 'middle' } },
            }}
          />
          <Box sx={{ position: 'absolute', top: 96, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: colorPaid }}>{paidPct}%</Typography>
            <Typography variant="caption" color="text.secondary">pago</Typography>
          </Box>
        </Box>
      ) : (
        <Box sx={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body2" color="text.secondary">Sem valores para exibir neste mês.</Typography>
        </Box>
      )}

      <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.5 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Pago</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: colorPaid }}>{formatCurrency(paid)}</Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary">Pendente</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: colorPending }}>{formatCurrency(pending)}</Typography>
        </Box>
      </Stack>
    </PapperBlock>
  )
}

function FutureReceivablesCard({ data }) {
  const theme = useTheme()
  const values = [Number(data.next7 || 0), Number(data.next15 || 0), Number(data.next30 || 0)]
  const hasData = values.some((v) => v > 0)

  return (
    <PapperBlock
      title="Recebimentos futuros"
      subtitle="Valor acumulado a receber por janela de dias"
      icon={<TimelineIcon />}
      iconColor={GRAD.blue}
    >
      {hasData ? (
        <BarChart
          height={260}
          skipAnimation
          xAxis={[{ scaleType: 'band', data: ['Até 7 dias', 'Até 15 dias', 'Até 30 dias'] }]}
          yAxis={[{ valueFormatter: formatCompactCurrency }]}
          series={[
            {
              data: values,
              label: 'A receber',
              color: theme.palette.primary.main,
              valueFormatter: (v) => formatCurrency(v),
            },
          ]}
          borderRadius={6}
          slotProps={{ legend: { hidden: true } }}
        />
      ) : (
        <Box sx={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body2" color="text.secondary">Nenhum recebimento previsto nos próximos 30 dias.</Typography>
        </Box>
      )}
    </PapperBlock>
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

  const loading = summaryQuery.isLoading && enabled

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

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} lg={3}>
          {loading ? <Skeleton variant="rounded" height={100} /> : (
            <StatCard
              title="Contratos ativos"
              value={totals.contractsActive}
              subtitle="no período vigente"
              icon={<AssignmentTurnedInIcon />}
              gradient={GRAD.blue}
            />
          )}
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          {loading ? <Skeleton variant="rounded" height={100} /> : (
            <StatCard
              title="Clientes ativos"
              value={totals.clientsActive}
              subtitle="com contrato vigente"
              icon={<PeopleAltIcon />}
              gradient={GRAD.purple}
            />
          )}
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          {loading ? <Skeleton variant="rounded" height={100} /> : (
            <StatCard
              title="A receber (pendente)"
              value={formatCurrency(billing.pendingAmount)}
              subtitle={`Pago: ${formatCurrency(billing.paidAmount)}`}
              icon={<PaymentsIcon />}
              gradient={GRAD.orange}
            />
          )}
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          {loading ? <Skeleton variant="rounded" height={100} /> : (
            <StatCard
              title="Vencimentos de hoje"
              value={today.dueCount}
              subtitle={`Total do dia: ${formatCurrency(today.dueAmount)}`}
              icon={<TodayIcon />}
              gradient={GRAD.green}
            />
          )}
        </Grid>

        <Grid item xs={12} md={5}>
          {loading ? <Skeleton variant="rounded" height={430} /> : (
            <BillingDonutCard paid={billing.paidAmount} pending={billing.pendingAmount} />
          )}
        </Grid>
        <Grid item xs={12} md={7}>
          {loading ? <Skeleton variant="rounded" height={430} /> : (
            <FutureReceivablesCard data={future} />
          )}
        </Grid>
      </Grid>
    </>
  )
}
