import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Grid, Card, CardContent, Typography, Stack, Box, Alert, Skeleton, Button, Chip, Divider,
} from '@mui/material'
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn'
import PeopleAltIcon from '@mui/icons-material/PeopleAlt'
import PendingActionsIcon from '@mui/icons-material/PendingActions'
import TodayIcon from '@mui/icons-material/Today'
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import AssignmentIcon from '@mui/icons-material/Assignment'
import ExtensionIcon from '@mui/icons-material/Extension'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import PapperBlock from '@/components/PapperBlock'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { useSensitive } from '@/features/permissions/useSensitive'
import { dashboardService } from '@/features/dashboard/dashboard.service'
import { companyIntegrationService } from '@/features/companies/company.integration.service'

// Gradientes dos KPI cards (contraste AA para texto branco).
const GRAD = {
  blue: 'linear-gradient(135deg, #1565c0 0%, #0d47a1 100%)',
  purple: 'linear-gradient(135deg, #7b1fa2 0%, #4a148c 100%)',
  orange: 'linear-gradient(135deg, #e65100 0%, #bf360c 100%)',
  green: 'linear-gradient(135deg, #00796b 0%, #004d40 100%)',
  cyan: 'linear-gradient(135deg, #00838f 0%, #006064 100%)',
}

function greetingFor(hour) {
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

// Rótulo amigável do vencimento a partir dos dias restantes.
function dueLabel(daysUntil, iso) {
  if (daysUntil <= 0) return 'Hoje'
  if (daysUntil === 1) return 'Amanhã'
  const [, m, d] = String(iso || '').split('-')
  return d && m ? `${d}/${m}` : `${daysUntil} dias`
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

// Item 1 — saudação + resumo do dia + status do WhatsApp.
function GreetingBlock({ userName, totals, whatsapp, onOpenIntegrations }) {
  const now = new Date()
  const greeting = greetingFor(now.getHours())
  const dateLabel = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  const dueToday = totals.contractsDueToday || 0
  const pending = totals.contractsPending || 0

  return (
    <Card>
      <CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              {greeting}{userName ? `, ${userName}` : ''} 👋
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize', mb: 1 }}>
              {dateLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {dueToday > 0
                ? <>Você tem <strong>{dueToday}</strong> contrato(s) vencendo <strong>hoje</strong></>
                : <>Nenhum contrato vence hoje</>}
              {pending > 0 ? <> e <strong>{pending}</strong> pendente(s) neste mês.</> : '.'}
            </Typography>
          </Box>
          {whatsapp && (
            <Chip
              icon={<WhatsAppIcon />}
              onClick={onOpenIntegrations}
              variant="outlined"
              color={whatsapp.connected ? 'success' : 'warning'}
              label={whatsapp.connected ? 'WhatsApp conectado' : 'WhatsApp desconectado'}
              sx={{ fontWeight: 700, alignSelf: { xs: 'flex-start', md: 'center' } }}
            />
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

// Item 2 — atalhos filtrados por permissão.
function QuickActions({ actions }) {
  if (!actions.length) return null
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {actions.map((a) => (
        <Button
          key={a.label}
          variant={a.primary ? 'contained' : 'outlined'}
          color={a.color || 'primary'}
          startIcon={a.icon}
          onClick={a.onClick}
        >
          {a.label}
        </Button>
      ))}
    </Stack>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { selectedCompanyId, user } = useAuth()
  const { can } = usePermissions()
  const { money } = useSensitive()
  const enabled = Number.isInteger(selectedCompanyId)

  const canContracts = can('contracts.view')
  const canOverdue = can('reports.overdue.view')
  const canIntegration = can('integration.view')

  const summaryQuery = useQuery({
    queryKey: ['dashboard-summary', selectedCompanyId],
    queryFn: dashboardService.getSummary,
    enabled,
    staleTime: 30_000,
  })

  const upcomingQuery = useQuery({
    queryKey: ['dashboard-upcoming', selectedCompanyId],
    queryFn: () => dashboardService.getUpcoming(7),
    enabled: enabled && canContracts,
    staleTime: 30_000,
  })

  const overdueQuery = useQuery({
    queryKey: ['dashboard-overdue-top', selectedCompanyId],
    queryFn: () => dashboardService.getOverdueTop(5),
    enabled: enabled && canOverdue,
    staleTime: 30_000,
  })

  const evoQuery = useQuery({
    queryKey: ['company_evo_status', selectedCompanyId],
    queryFn: () => companyIntegrationService.getEvoStatus(selectedCompanyId),
    enabled: enabled && canIntegration,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })

  const totals = summaryQuery.data?.totals || {
    contractsActive: 0,
    clientsActive: 0,
    contractsPending: 0,
    contractsDueToday: 0,
    clientsNewMonth: 0,
  }
  const loading = summaryQuery.isLoading && enabled

  const whatsapp = useMemo(() => {
    if (!canIntegration) return null
    if (!evoQuery.data) return null
    const s = String(evoQuery.data?.connectionStatus || evoQuery.data?.state?.instance?.state || '').toLowerCase()
    return { connected: s === 'open' }
  }, [canIntegration, evoQuery.data])

  const quickActions = useMemo(() => {
    const list = []
    if (can('clients.create')) list.push({ label: 'Novo cliente', icon: <PersonAddAlt1Icon />, primary: true, onClick: () => navigate('/clients/new') })
    if (can('contracts.create')) list.push({ label: 'Novo contrato', icon: <AssignmentIcon />, onClick: () => navigate('/contracts/new') })
    if (canOverdue) list.push({ label: 'Inadimplentes', icon: <WarningAmberIcon />, color: 'warning', onClick: () => navigate('/reports/overdue-clients') })
    if (canIntegration) list.push({ label: 'Integrações', icon: <ExtensionIcon />, onClick: () => navigate('/integrations') })
    return list
  }, [can, canOverdue, canIntegration, navigate])

  const cards = [
    { title: 'Contratos ativos', value: totals.contractsActive, subtitle: 'no mês vigente', icon: <AssignmentTurnedInIcon />, gradient: GRAD.blue },
    { title: 'Clientes ativos', value: totals.clientsActive, subtitle: '', icon: <PeopleAltIcon />, gradient: GRAD.purple },
    { title: 'Contratos pendentes', value: totals.contractsPending, subtitle: 'no mês vigente', icon: <PendingActionsIcon />, gradient: GRAD.orange },
    { title: 'Vencem hoje', value: totals.contractsDueToday, subtitle: 'contratos no dia de hoje', icon: <TodayIcon />, gradient: GRAD.green },
    { title: 'Novos clientes', value: totals.clientsNewMonth, subtitle: 'criados no mês vigente', icon: <PersonAddAlt1Icon />, gradient: GRAD.cyan },
  ]

  const upcoming = upcomingQuery.data?.items || []
  const upcomingTotalAmount = upcomingQuery.data?.totalAmount || 0
  const overdue = overdueQuery.data?.items || []

  return (
    <Stack spacing={3}>
      <CompanyRequiredAlert />
      {!enabled && user?.role !== 'master' && (
        <Alert severity="info">
          Selecione uma empresa para visualizar seus indicadores.
        </Alert>
      )}
      {summaryQuery.isError && enabled && (
        <Alert severity="error">
          {summaryQuery.error?.response?.data?.error || summaryQuery.error?.message || 'Erro ao carregar o dashboard.'}
        </Alert>
      )}

      {enabled && (
        <GreetingBlock
          userName={user?.name || ''}
          totals={totals}
          whatsapp={whatsapp}
          onOpenIntegrations={() => navigate('/integrations')}
        />
      )}

      {enabled && <QuickActions actions={quickActions} />}

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

      {enabled && (canContracts || canOverdue) && (
        <Grid container spacing={3}>
          {canContracts && (
            <Grid item xs={12} md={canOverdue ? 6 : 12}>
              <PapperBlock
                title="Vencem em breve"
                subtitle="Cobranças pendentes nos próximos 7 dias"
                icon={<EventAvailableIcon />}
                iconColor="success.main"
                noPadding
                action={upcoming.length ? (
                  <Button size="small" endIcon={<ArrowForwardIcon />} onClick={() => navigate('/contracts')}>
                    Contratos
                  </Button>
                ) : null}
              >
                <Box sx={{ p: 2 }}>
                  {upcomingQuery.isLoading ? (
                    <Stack spacing={1}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={52} />)}</Stack>
                  ) : upcomingQuery.isError ? (
                    <Alert severity="error">Falha ao carregar vencimentos.</Alert>
                  ) : upcoming.length === 0 ? (
                    <EmptyState icon={<EventAvailableIcon />} title="Nada vencendo" description="Nenhuma cobrança nos próximos 7 dias." />
                  ) : (
                    <>
                      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
                        <Chip size="small" color="success" variant="outlined" label={`${upcoming.length} cobrança(s)`} sx={{ fontWeight: 700 }} />
                        <Chip size="small" color="success" label={`Total ${money(upcomingTotalAmount)}`} sx={{ fontWeight: 700 }} />
                      </Stack>
                      <Stack divider={<Divider flexItem />} spacing={0}>
                      {upcoming.map((it) => (
                        <Stack key={it.contractId} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1 }}>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{it.clientName || 'Cliente'}</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              #{it.contractId}{it.contractDescription ? ` · ${it.contractDescription}` : ''}
                            </Typography>
                          </Box>
                          <Chip
                            size="small"
                            color={it.daysUntil <= 0 ? 'success' : 'default'}
                            variant={it.daysUntil <= 0 ? 'filled' : 'outlined'}
                            label={dueLabel(it.daysUntil, it.dueDate)}
                            sx={{ fontWeight: 700 }}
                          />
                          <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 90, textAlign: 'right' }}>
                            {money(it.amount)}
                          </Typography>
                        </Stack>
                      ))}
                      </Stack>
                    </>
                  )}
                </Box>
              </PapperBlock>
            </Grid>
          )}

          {canOverdue && (
            <Grid item xs={12} md={canContracts ? 6 : 12}>
              <PapperBlock
                title="Inadimplentes"
                subtitle="Vencidos há mais de 30 dias — maiores atrasos"
                icon={<WarningAmberIcon />}
                iconColor="error.main"
                noPadding
                action={overdue.length ? (
                  <Button size="small" color="warning" endIcon={<ArrowForwardIcon />} onClick={() => navigate('/reports/overdue-clients')}>
                    Ver todos
                  </Button>
                ) : null}
              >
                <Box sx={{ p: 2 }}>
                  {overdueQuery.isLoading ? (
                    <Stack spacing={1}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={52} />)}</Stack>
                  ) : overdueQuery.isError ? (
                    <Alert severity="error">Falha ao carregar clientes em atraso.</Alert>
                  ) : overdue.length === 0 ? (
                    <EmptyState icon={<WarningAmberIcon />} title="Nenhum inadimplente" description="Nenhum cliente vencido há mais de 30 dias. 🎉" />
                  ) : (
                    <Stack divider={<Divider flexItem />} spacing={0}>
                      {overdue.map((it) => (
                        <Stack
                          key={it.clientId}
                          direction="row"
                          alignItems="center"
                          spacing={1.5}
                          sx={{ py: 1, cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                          onClick={() => navigate('/reports/overdue-clients')}
                        >
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{it.clientName || 'Cliente'}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {it.overdueCount} cobrança(s)
                            </Typography>
                          </Box>
                          <Chip size="small" variant="outlined" color="error" label={`${it.maxDaysLate} dias de inadimplência`} sx={{ fontWeight: 700 }} />
                          <Typography variant="body2" color="error.main" sx={{ fontWeight: 700, minWidth: 90, textAlign: 'right' }}>
                            {money(it.totalAmount)}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Box>
              </PapperBlock>
            </Grid>
          )}
        </Grid>
      )}
    </Stack>
  )
}
