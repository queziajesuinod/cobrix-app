import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert, Box, Card, CardContent, Chip, Grid, LinearProgress, MenuItem, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import TaskAltIcon from '@mui/icons-material/TaskAlt'
import PendingActionsIcon from '@mui/icons-material/PendingActions'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import LeaderboardIcon from '@mui/icons-material/Leaderboard'
import BarChartIcon from '@mui/icons-material/BarChart'
import DonutLargeIcon from '@mui/icons-material/DonutLarge'
import TimelineIcon from '@mui/icons-material/Timeline'
import { BarChart } from '@mui/x-charts/BarChart'
import { LineChart } from '@mui/x-charts/LineChart'
import { PieChart } from '@mui/x-charts/PieChart'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { tasksService } from './tasks.service'

const pct = (x) => (x == null ? '—' : `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`)
const onTimeColor = (x) => (x == null ? 'text.secondary' : x >= 0.8 ? 'success.main' : x >= 0.5 ? 'warning.main' : 'error.main')
const pad = (n) => String(n).padStart(2, '0')
const weekLabel = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
// Segundas-feiras das últimas n semanas (casa com date_trunc('week') do Postgres).
function lastNWeeks(n) {
  const now = new Date()
  const day = now.getDay() // 0=Dom
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (day === 0 ? -6 : 1 - day))
  return Array.from({ length: n }, (_, i) => {
    const w = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (n - 1 - i) * 7)
    return `${w.getFullYear()}-${pad(w.getMonth() + 1)}-${pad(w.getDate())}`
  })
}

function StatTile({ label, value, color, icon }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 2, flex: '0 0 auto', display: 'grid', placeItems: 'center', color: `${color}.main`, bgcolor: (t) => alpha(t.palette[color].main, t.palette.mode === 'dark' ? 0.22 : 0.12) }}>
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2, display: 'block' }}>{label}</Typography>
          <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>{value}</Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

export default function ProductivityPage() {
  const { selectedCompanyId } = useAuth()
  const { can } = usePermissions()
  const isGestor = can('tasks.gestor')
  const enabled = Number.isInteger(selectedCompanyId)
  const q = useQuery({ queryKey: ['tasks-productivity', selectedCompanyId], queryFn: () => tasksService.productivity(), enabled: enabled && isGestor })
  const items = q.data?.items || []
  const [userId, setUserId] = React.useState('')

  if (!isGestor) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Produtividade" />
        <Alert severity="warning">Somente o Gestor (permissão de produtividade) pode ver este painel.</Alert>
      </Stack>
    )
  }
  if (!enabled) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Produtividade" subtitle="Desempenho da equipe nas tarefas." />
        <CompanyRequiredAlert />
      </Stack>
    )
  }

  // Filtro por usuário: '' = todos. Os KPIs recalculam a partir do conjunto filtrado.
  const filtered = userId ? items.filter((i) => String(i.userId) === userId) : items
  const totalDone = filtered.reduce((a, i) => a + (i.done || 0), 0)
  const totalOpen = filtered.reduce((a, i) => a + (i.open || 0), 0)
  const totalOverdue = filtered.reduce((a, i) => a + (i.overdue || 0), 0)
  const sumOnTime = filtered.reduce((a, i) => a + (i.onTime || 0), 0)
  const sumDoneWithDue = filtered.reduce((a, i) => a + (i.doneWithDue || 0), 0)
  const onTimeAgg = sumDoneWithDue ? sumOnTime / sumDoneWithDue : null

  // Dados dos gráficos (empresa toda; independem do filtro por usuário).
  const series = q.data?.series || []
  const distribution = q.data?.distribution || { open: 0, done: 0, overdue: 0 }
  const weeks = lastNWeeks(12)
  const byWk = new Map(series.map((s) => [s.wk, s]))
  const wkLabels = weeks.map(weekLabel)
  const doneSeries = weeks.map((w) => byWk.get(w)?.done || 0)
  const onTimeSeries = weeks.map((w) => { const s = byWk.get(w); const den = (s?.on_time || 0) + (s?.late || 0); return den ? Math.round((s.on_time / den) * 100) : null })
  const hasSeriesData = doneSeries.some((v) => v > 0)
  const pieData = [
    { id: 0, value: distribution.done, label: 'Concluídas', color: '#10b981' },
    { id: 1, value: Math.max((distribution.open || 0) - (distribution.overdue || 0), 0), label: 'Abertas', color: '#3b82f6' },
    { id: 2, value: distribution.overdue, label: 'Atrasadas', color: '#ef4444' },
  ].filter((d) => d.value > 0)

  const filterControl = (
    <TextField select size="small" label="Usuário" value={userId} onChange={(e) => setUserId(e.target.value)} sx={{ minWidth: 200 }}>
      <MenuItem value="">Todos</MenuItem>
      {items.map((u) => <MenuItem key={u.userId} value={String(u.userId)}>{u.name}</MenuItem>)}
    </TextField>
  )

  return (
    <Stack spacing={2.5}>
      <PageHeader title="Produtividade" subtitle="Desempenho de cada usuário nas tarefas (visão do Gestor)." actions={filterControl} />

      {q.isError && <Alert severity="error">Falha ao carregar a produtividade.</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={6} md={3}><StatTile label="Concluídas" value={totalDone} color="success" icon={<TaskAltIcon />} /></Grid>
        <Grid item xs={6} md={3}><StatTile label="Abertas (carga)" value={totalOpen} color="info" icon={<PendingActionsIcon />} /></Grid>
        <Grid item xs={6} md={3}><StatTile label="Atrasadas" value={totalOverdue} color="error" icon={<WarningAmberIcon />} /></Grid>
        <Grid item xs={6} md={3}><StatTile label="No prazo" value={pct(onTimeAgg)} color="primary" icon={<AccessTimeIcon />} /></Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <PapperBlock title="Throughput" subtitle="Tarefas concluídas por semana (12 semanas)" icon={<BarChartIcon />} noPadding>
            <Box sx={{ p: 2 }}>
              {hasSeriesData ? (
                <BarChart height={300} xAxis={[{ scaleType: 'band', data: wkLabels }]}
                  series={[{ data: doneSeries, label: 'Concluídas', color: '#3b82f6' }]}
                  margin={{ top: 20, right: 10, bottom: 24, left: 40 }} slotProps={{ legend: { hidden: true } }} />
              ) : <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>Sem conclusões nas últimas 12 semanas.</Box>}
            </Box>
          </PapperBlock>
        </Grid>
        <Grid item xs={12} md={5}>
          <PapperBlock title="Distribuição" subtitle="Situação atual das tarefas" icon={<DonutLargeIcon />} noPadding>
            <Box sx={{ p: 2 }}>
              {pieData.length ? (
                <PieChart height={300} series={[{ data: pieData, innerRadius: 50, paddingAngle: 2, cornerRadius: 4 }]}
                  margin={{ top: 10, right: 10, bottom: 40, left: 10 }}
                  slotProps={{ legend: { direction: 'row', position: { vertical: 'bottom', horizontal: 'middle' } } }} />
              ) : <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>Sem tarefas.</Box>}
            </Box>
          </PapperBlock>
        </Grid>
      </Grid>

      <PapperBlock title="% no prazo por semana" subtitle="Concluídas dentro do prazo ÷ concluídas com prazo" icon={<TimelineIcon />} noPadding>
        <Box sx={{ p: 2 }}>
          {hasSeriesData ? (
            <LineChart height={280} xAxis={[{ scaleType: 'point', data: wkLabels }]}
              yAxis={[{ min: 0, max: 100, valueFormatter: (v) => `${v}%` }]}
              series={[{ data: onTimeSeries, label: '% no prazo', color: '#10b981', area: true, connectNulls: false, valueFormatter: (v) => (v == null ? '—' : `${v}%`) }]}
              margin={{ top: 20, right: 16, bottom: 24, left: 44 }} slotProps={{ legend: { hidden: true } }} />
          ) : <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>Sem dados de prazo ainda.</Box>}
        </Box>
      </PapperBlock>

      <PapperBlock title="Por usuário" subtitle="Concluídas, carga, atrasadas, % no prazo e tempo médio de entrega" icon={<LeaderboardIcon />} noPadding>
        <Box sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Usuário</TableCell>
                <TableCell align="right">Concluídas</TableCell>
                <TableCell align="right">Abertas</TableCell>
                <TableCell align="right">Atrasadas</TableCell>
                <TableCell sx={{ minWidth: 160 }}>No prazo</TableCell>
                <TableCell align="right">Tempo médio</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.userId} hover>
                  <TableCell><Typography sx={{ fontWeight: 600 }}>{u.name}</Typography></TableCell>
                  <TableCell align="right">{u.done}</TableCell>
                  <TableCell align="right">{u.open}</TableCell>
                  <TableCell align="right">
                    {u.overdue > 0
                      ? <Chip size="small" color="error" variant="outlined" label={u.overdue} />
                      : <Typography variant="body2" color="text.secondary">0</Typography>}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ flex: 1, minWidth: 60 }}>
                        <LinearProgress
                          variant="determinate"
                          value={u.onTimePct == null ? 0 : Math.round(u.onTimePct * 100)}
                          color={u.onTimePct == null ? 'inherit' : u.onTimePct >= 0.8 ? 'success' : u.onTimePct >= 0.5 ? 'warning' : 'error'}
                          sx={{ height: 6, borderRadius: 3 }}
                        />
                      </Box>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: onTimeColor(u.onTimePct), minWidth: 34, textAlign: 'right' }}>{pct(u.onTimePct)}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{u.avgDays == null ? '—' : `${u.avgDays}d`}</TableCell>
                </TableRow>
              ))}
              {!filtered.length && !q.isLoading && (
                <TableRow><TableCell colSpan={6}><Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>{items.length ? 'Nenhum resultado para o filtro.' : 'Sem tarefas atribuídas ainda.'}</Box></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </PapperBlock>

      <Typography variant="caption" color="text.secondary">
        No prazo = concluídas com entrega até o prazo ÷ concluídas com prazo. Tempo médio = média de dias entre início e conclusão. Atrasadas = abertas com prazo vencido (fuso de Campo Grande).
      </Typography>
    </Stack>
  )
}
