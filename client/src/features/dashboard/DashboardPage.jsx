import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Grid, Card, CardContent, Typography, Stack, Box, Alert, Skeleton } from '@mui/material'
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn'
import PeopleAltIcon from '@mui/icons-material/PeopleAlt'
import PendingActionsIcon from '@mui/icons-material/PendingActions'
import TodayIcon from '@mui/icons-material/Today'
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { dashboardService } from '@/features/dashboard/dashboard.service'

// Gradientes dos KPI cards (contraste AA para texto branco).
const GRAD = {
  blue: 'linear-gradient(135deg, #1565c0 0%, #0d47a1 100%)',
  purple: 'linear-gradient(135deg, #7b1fa2 0%, #4a148c 100%)',
  orange: 'linear-gradient(135deg, #e65100 0%, #bf360c 100%)',
  green: 'linear-gradient(135deg, #00796b 0%, #004d40 100%)',
  cyan: 'linear-gradient(135deg, #00838f 0%, #006064 100%)',
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
            <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.15 }}>
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

export default function DashboardPage() {
  const { selectedCompanyId, user } = useAuth()
  const enabled = Number.isInteger(selectedCompanyId)

  const summaryQuery = useQuery({
    queryKey: ['dashboard-summary', selectedCompanyId],
    queryFn: dashboardService.getSummary,
    enabled,
    staleTime: 30_000,
  })

  const totals = summaryQuery.data?.totals || {
    contractsActive: 0,
    clientsActive: 0,
    contractsPending: 0,
    contractsDueToday: 0,
    clientsNewMonth: 0,
  }
  const loading = summaryQuery.isLoading && enabled

  const cards = [
    { title: 'Contratos ativos', value: totals.contractsActive, subtitle: 'no mês vigente', icon: <AssignmentTurnedInIcon />, gradient: GRAD.blue },
    { title: 'Clientes ativos', value: totals.clientsActive, subtitle: '', icon: <PeopleAltIcon />, gradient: GRAD.purple },
    { title: 'Contratos pendentes', value: totals.contractsPending, subtitle: 'no mês vigente', icon: <PendingActionsIcon />, gradient: GRAD.orange },
    { title: 'Vencem hoje', value: totals.contractsDueToday, subtitle: 'contratos no dia de hoje', icon: <TodayIcon />, gradient: GRAD.green },
    { title: 'Novos clientes', value: totals.clientsNewMonth, subtitle: 'criados no mês vigente', icon: <PersonAddAlt1Icon />, gradient: GRAD.cyan },
  ]

  return (
    <>
      <CompanyRequiredAlert />
      {!enabled && user?.role !== 'master' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Selecione uma empresa para visualizar seus indicadores.
        </Alert>
      )}
      {summaryQuery.isError && enabled && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {summaryQuery.error?.response?.data?.error || summaryQuery.error?.message || 'Erro ao carregar o dashboard.'}
        </Alert>
      )}

      <Grid container spacing={3}>
        {cards.map((card) => (
          <Grid item xs={12} sm={6} md={4} lg={2.4} key={card.title}>
            {loading ? (
              <Skeleton variant="rounded" height={100} />
            ) : (
              <StatCard {...card} />
            )}
          </Grid>
        ))}
      </Grid>
    </>
  )
}
