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
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { tasksService } from './tasks.service'

const pct = (x) => (x == null ? '—' : `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`)
const onTimeColor = (x) => (x == null ? 'text.secondary' : x >= 0.8 ? 'success.main' : x >= 0.5 ? 'warning.main' : 'error.main')

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
