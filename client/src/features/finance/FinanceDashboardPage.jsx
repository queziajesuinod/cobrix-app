import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, AlertTitle, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Grid, LinearProgress, MenuItem, Slider, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Tooltip, Typography, Skeleton,
} from '@mui/material'
import { Gauge, gaugeClasses } from '@mui/x-charts/Gauge'
import EditIcon from '@mui/icons-material/Edit'
import FlagIcon from '@mui/icons-material/Flag'
import PieChartIcon from '@mui/icons-material/PieChart'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import SpeedIcon from '@mui/icons-material/Speed'
import TuneIcon from '@mui/icons-material/Tune'
import { alpha } from '@mui/material/styles'
import { BarChart } from '@mui/x-charts/BarChart'
import { PieChart } from '@mui/x-charts/PieChart'
import { LineChart } from '@mui/x-charts/LineChart'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import PaymentsIcon from '@mui/icons-material/Payments'
import GroupsIcon from '@mui/icons-material/Groups'
import PercentIcon from '@mui/icons-material/Percent'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import PriceCheckIcon from '@mui/icons-material/PriceCheck'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { financeService } from './finance.service'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
// Paleta cíclica para as fatias do donut (categorias são dinâmicas).
const PIE_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16']
const pad = (n) => String(n).padStart(2, '0')
const currentYm = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }

// Formatação pt-BR (Intl). Percentual chega como fração 0..1; null vira "—".
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const pctFmt = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 2 })
const intFmt = new Intl.NumberFormat('pt-BR')
const num2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })
const fmtMoney = (v) => (v == null ? '—' : brl.format(v))
const fmtPct = (v) => (v == null ? '—' : pctFmt.format(v))
const fmtInt = (v) => (v == null ? '—' : intFmt.format(v))
const fmtDeltaPct = (v) => (v == null ? null : `${v > 0 ? '+' : ''}${pctFmt.format(v)}`)
const fmtDeltaPts = (v) => (v == null ? null : `${num2.format(v)} p.p.`)

// Card de KPI com valor e (opcional) variação vs. mês anterior.
function KpiCard({ label, value, icon, color = 'primary', negative = false, delta, deltaGoodWhenUp = true, deltaRaw }) {
  const goodDelta = deltaRaw == null ? null : (deltaRaw > 0) === deltaGoodWhenUp
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: '100%' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: 2, flex: '0 0 auto', display: 'grid', placeItems: 'center', color: `${color}.main`, bgcolor: (t) => alpha(t.palette[color].main, t.palette.mode === 'dark' ? 0.22 : 0.12) }}>
            {icon}
          </Box>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2 }}>{label}</Typography>
        </Stack>
        <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.1, color: negative ? 'error.main' : 'text.primary', fontVariantNumeric: 'tabular-nums' }} noWrap>
          {value}
        </Typography>
        {delta != null && (
          <Chip size="small" variant="outlined"
            color={goodDelta == null ? 'default' : goodDelta ? 'success' : 'error'}
            label={`${delta} vs. mês ant.`} sx={{ alignSelf: 'flex-start', fontWeight: 600 }} />
        )}
      </CardContent>
    </Card>
  )
}

function TipoChip({ tipo }) {
  return <Chip size="small" label={tipo === 'FIXA' ? 'Fixa' : 'Variável'} color={tipo === 'FIXA' ? 'default' : 'warning'} variant="outlined" />
}

// Bloco de projeção anual (3 linhas x realizado/média/projeção) + nota de base.
function ProjecaoBlock({ p }) {
  if (!p) return null
  const linhas = [
    { key: 'honorarios', label: 'Faturamento' },
    { key: 'total_despesas', label: 'Despesas' },
    { key: 'lucro_operacional', label: 'Lucro' },
  ]
  const confColor = p.confiabilidade === 'ALTA' ? 'success' : p.confiabilidade === 'MEDIA' ? 'warning' : 'error'
  return (
    <Stack spacing={1.5}>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 420, '& td, & th': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }} />
              <TableCell align="right" sx={{ fontWeight: 700 }}>Realizado</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Média mensal</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, color: 'primary.main' }}>Projeção anual</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {linhas.map((l) => {
              const proj = p.projecao[l.key]
              return (
                <TableRow key={l.key} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{l.label}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(p.realizado[l.key])}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(p.media_mensal[l.key])}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: l.key === 'lucro_operacional' && proj < 0 ? 'error.main' : 'primary.main' }}>{fmtMoney(proj)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Chip size="small" color={confColor} label={`Confiabilidade: ${p.confiabilidade}`} />
        <Typography variant="caption" color="text.secondary">
          Base: {p.meses_base} {p.meses_base === 1 ? 'mês fechado' : 'meses fechados'}
          {p.competencias_consideradas.length ? ` (${p.competencias_consideradas.join(', ')})` : ''}.
          {' '}Lucro projetado = faturamento projetado − despesas projetadas.
        </Typography>
      </Stack>
    </Stack>
  )
}

// Aging da carteira em aberto: barra proporcional 0-30 / 31-60 / 61-90 / 90+ dias.
const AGING = [
  { key: 'b0_30', label: '1–30 dias', color: '#f59e0b' },
  { key: 'b31_60', label: '31–60 dias', color: '#f97316' },
  { key: 'b61_90', label: '61–90 dias', color: '#ef4444' },
  { key: 'b90_plus', label: '90+ dias', color: '#b91c1c' },
]
function AgingBar({ aging }) {
  if (!aging || !aging.total) {
    return <Alert severity="success" variant="outlined" sx={{ mt: 1 }}>Nenhuma cobrança vencida em aberto. 🎉</Alert>
  }
  return (
    <Stack spacing={1.25} sx={{ mt: 1 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography variant="body2" color="text.secondary">Carteira vencida em aberto</Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: 'error.main', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(aging.total)} · {aging.titulos} {aging.titulos === 1 ? 'título' : 'títulos'}
        </Typography>
      </Stack>
      <Box sx={{ display: 'flex', height: 14, borderRadius: 1, overflow: 'hidden' }}>
        {AGING.map((b) => {
          const w = aging.total ? (aging[b.key] / aging.total) * 100 : 0
          return w > 0 ? <Tooltip key={b.key} title={`${b.label}: ${fmtMoney(aging[b.key])}`}><Box sx={{ width: `${w}%`, bgcolor: b.color }} /></Tooltip> : null
        })}
      </Box>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {AGING.map((b) => (
          <Stack key={b.key} direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: b.color }} />
            <Typography variant="caption" color="text.secondary">{b.label}: <b>{fmtMoney(aging[b.key])}</b></Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}

// ---- Score de saúde financeira: gauge + fatores ----
const BAND = {
  excelente: { label: 'Excelente', color: '#10b981' },
  saudavel: { label: 'Saudável', color: '#3b82f6' },
  atencao: { label: 'Atenção', color: '#f59e0b' },
  critico: { label: 'Crítico', color: '#ef4444' },
  sem_dados: { label: 'Sem dados', color: '#94a3b8' },
}
const FATOR_FMT = {
  margem: (v) => fmtPct(v),
  inadimplencia: (v) => fmtPct(v),
  crescimento: (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${pctFmt.format(v)}`),
  concentracao: (v) => (v == null ? '—' : `maior cliente = ${pctFmt.format(v)}`),
  estrutura_custo: (v) => (v == null ? '—' : `${pctFmt.format(v)} da receita`),
}
function SaudeBlock({ data }) {
  if (!data) return <Skeleton variant="rounded" height={200} />
  const band = BAND[data.band] || BAND.sem_dados
  return (
    <Grid container spacing={2} alignItems="center">
      <Grid item xs={12} sm={4} md={3}>
        <Box sx={{ display: 'grid', placeItems: 'center' }}>
          <Gauge
            height={170} value={data.score ?? 0} valueMin={0} valueMax={100}
            startAngle={-110} endAngle={110} cornerRadius="50%"
            text={() => (data.score == null ? '—' : `${data.score}`)}
            sx={{ [`& .${gaugeClasses.valueText}`]: { fontSize: 34, fontWeight: 800 }, [`& .${gaugeClasses.valueArc}`]: { fill: band.color } }}
          />
          <Chip label={band.label} sx={{ mt: -1, fontWeight: 700, bgcolor: alpha(band.color, 0.15), color: band.color }} />
        </Box>
      </Grid>
      <Grid item xs={12} sm={8} md={9}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>O que pesa no score (do pior ao melhor)</Typography>
        <Stack spacing={1}>
          {data.fatores.map((f) => {
            const c = f.subscore < 40 ? '#ef4444' : f.subscore < 60 ? '#f59e0b' : f.subscore < 80 ? '#3b82f6' : '#10b981'
            return (
              <Box key={f.key}>
                <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{(FATOR_FMT[f.key] || ((v) => v))(f.valor)} · {f.subscore}/100</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={f.subscore} sx={{ height: 7, borderRadius: 5, mt: 0.25, '& .MuiLinearProgress-bar': { bgcolor: c } }} />
              </Box>
            )
          })}
          {data.fatores.length === 0 && <Alert severity="info">Sem dados suficientes para calcular o score.</Alert>}
        </Stack>
      </Grid>
    </Grid>
  )
}

// ---- Simulador de cenários "e se" ----
function SimSlider({ label, value, onChange, min, max, suffix = '%', color }) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, color: color || 'text.primary' }}>{value > 0 && suffix === '%' ? '+' : ''}{value}{suffix}</Typography>
      </Stack>
      <Slider value={value} onChange={(_e, v) => onChange(v)} min={min} max={max} size="small" sx={{ color }} />
    </Box>
  )
}
function SimuladorBlock({ baseReceita, baseFixa, baseVar, vencido }) {
  const [dRec, setDRec] = React.useState(0)
  const [dFix, setDFix] = React.useState(0)
  const [dVar, setDVar] = React.useState(0)
  const [rec, setRec] = React.useState(0)
  const reset = () => { setDRec(0); setDFix(0); setDVar(0); setRec(0) }

  if (!baseReceita) return <Alert severity="info">Sem base para simular ainda — é preciso ter meses fechados com lançamento no ano.</Alert>

  const receita = baseReceita * (1 + dRec / 100) + vencido * (rec / 100)
  const fixa = baseFixa * (1 + dFix / 100)
  const variavel = baseVar * (1 + dVar / 100)
  const desp = fixa + variavel
  const lucro = receita - desp
  const margem = receita ? lucro / receita : null
  const baseLucro = baseReceita - (baseFixa + baseVar)
  const baseMargem = baseReceita ? baseLucro / baseReceita : null
  const deltaLucro = lucro - baseLucro
  const deltaMargem = (margem != null && baseMargem != null) ? (margem - baseMargem) * 100 : null

  const Comp = ({ label, base, sim, money = true }) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
      <Typography variant="body2">{label}</Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        <Box component="span" sx={{ color: 'text.disabled', mr: 1 }}>{money ? fmtMoney(base) : fmtPct(base)}</Box>
        →<Box component="span" sx={{ fontWeight: 700, ml: 1 }}>{money ? fmtMoney(sim) : fmtPct(sim)}</Box>
      </Typography>
    </Stack>
  )

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <Stack spacing={2}>
          <SimSlider label="Receita (honorários)" value={dRec} onChange={setDRec} min={-30} max={50} color="#10b981" />
          <SimSlider label="Despesa fixa" value={dFix} onChange={setDFix} min={-40} max={40} color="#ef4444" />
          <SimSlider label="Despesa variável" value={dVar} onChange={setDVar} min={-40} max={40} color="#f59e0b" />
          <SimSlider label="Recuperar da carteira vencida" value={rec} onChange={setRec} min={0} max={100} color="#3b82f6" />
          <Button size="small" onClick={reset} sx={{ alignSelf: 'flex-start' }}>Zerar cenário</Button>
        </Stack>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Comp label="Receita" base={baseReceita} sim={receita} />
            <Comp label="Despesas" base={baseFixa + baseVar} sim={desp} />
            <Divider sx={{ my: 0.5 }} />
            <Comp label="Lucro" base={baseLucro} sim={lucro} />
            <Comp label="Margem" base={baseMargem} sim={margem} money={false} />
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="body2" color="text.secondary">Impacto no lucro</Typography>
              <Chip color={deltaLucro >= 0 ? 'success' : 'error'} label={`${deltaLucro >= 0 ? '+' : ''}${fmtMoney(deltaLucro)}${deltaMargem != null ? ` · ${num2.format(deltaMargem)} p.p.` : ''}`} sx={{ fontWeight: 700 }} />
            </Stack>
          </CardContent>
        </Card>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Base = projeção anual (média dos meses fechados × 12). Recuperação da carteira vencida entra como receita única.
        </Typography>
      </Grid>
    </Grid>
  )
}

// Barra de progresso orçado × realizado, com marcador de projeção.
function MetaProgress({ label, realizado, meta, projecao, invertido = false }) {
  const pctReal = meta ? Math.min((realizado / meta) * 100, 100) : 0
  const pctProj = meta ? Math.min((projecao / meta) * 100, 100) : 0
  const atingido = meta ? realizado / meta : null
  // Para despesas, ultrapassar a meta é ruim; para receita, é bom.
  const cor = meta == null ? 'inherit' : invertido ? (realizado > meta ? 'error.main' : 'success.main') : (realizado >= meta ? 'success.main' : 'warning.main')
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(realizado)} / {meta == null ? '—' : fmtMoney(meta)}{atingido != null ? ` · ${pctFmt.format(atingido)}` : ''}
        </Typography>
      </Stack>
      <Box sx={{ position: 'relative', mt: 0.5 }}>
        <LinearProgress variant="determinate" value={pctReal} sx={{ height: 10, borderRadius: 5, '& .MuiLinearProgress-bar': { bgcolor: cor } }} />
        {meta > 0 && projecao > 0 && (
          <Tooltip title={`Projeção anual: ${fmtMoney(projecao)}`}>
            <Box sx={{ position: 'absolute', top: -2, left: `calc(${pctProj}% - 1px)`, width: 2, height: 14, bgcolor: 'text.primary', opacity: 0.6 }} />
          </Tooltip>
        )}
      </Box>
    </Box>
  )
}

function MetasDialog({ ano, open, onClose, initial, onSaved }) {
  const [hon, setHon] = React.useState('')
  const [desp, setDesp] = React.useState('')
  React.useEffect(() => {
    if (open) { setHon(initial?.meta_honorarios != null ? String(initial.meta_honorarios) : ''); setDesp(initial?.meta_despesas != null ? String(initial.meta_despesas) : '') }
  }, [open, initial])
  const mut = useMutation({
    mutationFn: () => financeService.saveMetas(ano, { meta_honorarios: Number(hon || 0), meta_despesas: Number(desp || 0) }),
    onSuccess: () => { onSaved?.(); onClose() },
  })
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Metas de {ano}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Meta de receita (ano)" type="number" value={hon} onChange={(e) => setHon(e.target.value)} InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }} color="text.secondary">R$</Typography> }} fullWidth />
          <TextField label="Meta de despesa (ano)" type="number" value={desp} onChange={(e) => setDesp(e.target.value)} InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }} color="text.secondary">R$</Typography> }} fullWidth />
          {mut.isError && <Alert severity="error">Não foi possível salvar as metas.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => mut.mutate()} disabled={mut.isPending}>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function FinanceDashboardPage() {
  const { selectedCompanyId } = useAuth()
  const { can } = usePermissions()
  const canView = can('finance.dashboard.view')
  const enabled = Number.isInteger(selectedCompanyId)

  const [ym, setYm] = React.useState(currentYm())
  const [base, setBase] = React.useState('REALIZADO')
  const [periodo, setPeriodo] = React.useState('mes') // 'mes' | 'tri' (últimos 3 meses) | 'ano'
  const [ano, mes] = ym.split('-').map(Number)
  const periodoLabel = periodo === 'mes' ? `Competência ${ano}-${pad(mes)}` : periodo === 'ano' ? `Ano ${ano}` : `Últimos 3 meses (até ${ano}-${pad(mes)})`

  const on = enabled && canView
  const kpisQ = useQuery({ queryKey: ['fin-dash-kpis', ano, mes, base, periodo], queryFn: () => financeService.dashboardKpis({ ano, mes, base, periodo }), enabled: on, placeholderData: (p) => p })
  const catQ = useQuery({ queryKey: ['fin-dash-cat', ano, mes, periodo, base], queryFn: () => financeService.dashboardDespesasCategoria({ ano, mes, periodo, base }), enabled: on, placeholderData: (p) => p })
  const evoQ = useQuery({ queryKey: ['fin-dash-evo', ano, base], queryFn: () => financeService.dashboardEvolucao({ ano, base }), enabled: on, placeholderData: (p) => p })
  const projQ = useQuery({ queryKey: ['fin-dash-proj', ano], queryFn: () => financeService.dashboardProjecao({ ano }), enabled: on, placeholderData: (p) => p })
  const inadQ = useQuery({ queryKey: ['fin-dash-inad', ano], queryFn: () => financeService.dashboardInadimplencia({ ano }), enabled: on, placeholderData: (p) => p })
  const insQ = useQuery({ queryKey: ['fin-dash-ins', ano, mes], queryFn: () => financeService.dashboardInsights({ ano, mes }), enabled: on, placeholderData: (p) => p })
  const tipoQ = useQuery({ queryKey: ['fin-dash-tipo', ano, mes, periodo, base], queryFn: () => financeService.dashboardReceitaTipoContrato({ ano, mes, periodo, base }), enabled: on, placeholderData: (p) => p })
  const metasQ = useQuery({ queryKey: ['fin-dash-metas', ano], queryFn: () => financeService.dashboardMetas({ ano }), enabled: on, placeholderData: (p) => p })
  const metaEditQ = useQuery({ queryKey: ['fin-metas-edit', ano], queryFn: () => financeService.getMetas(ano), enabled: on })
  const saudeQ = useQuery({ queryKey: ['fin-dash-saude', ano], queryFn: () => financeService.dashboardSaude({ ano }), enabled: on, placeholderData: (p) => p })
  const canManageMetas = can('finance.metas.manage')
  const [metasOpen, setMetasOpen] = React.useState(false)
  const qc = useQueryClient()
  const onMetasSaved = () => { qc.invalidateQueries({ queryKey: ['fin-dash-metas', ano] }); qc.invalidateQueries({ queryKey: ['fin-metas-edit', ano] }); qc.invalidateQueries({ queryKey: ['fin-dash-ins', ano, mes] }) }

  if (!canView) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Dashboard Financeiro" />
        <Alert severity="warning">Seu perfil não tem permissão para acessar o Dashboard Financeiro.</Alert>
      </Stack>
    )
  }
  if (!enabled) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Dashboard Financeiro" subtitle="Indicadores do mês, evolução e projeção." />
        <CompanyRequiredAlert />
      </Stack>
    )
  }

  const k = kpisQ.data
  const fechado = k?.status_competencia === 'FECHADO'
  const v = k?.variacao_mes_anterior
  const evo = evoQ.data?.pontos || []
  // Meses sem lançamento entram como null → o gráfico interrompe a barra (não plota zero).
  const serie = (get) => evo.map((p) => (p.tem_lancamento ? get(p) : null))

  // Base do simulador: projeção anual + proporção fixa/variável do realizado.
  const evoR = evo.filter((p) => p.tem_lancamento)
  const sumFix = evoR.reduce((a, p) => a + p.despesas_fixas, 0)
  const sumVar = evoR.reduce((a, p) => a + p.despesas_variaveis, 0)
  const propFixa = sumFix + sumVar > 0 ? sumFix / (sumFix + sumVar) : 0.5
  const baseReceita = projQ.data?.projecao.honorarios || 0
  const baseDesp = projQ.data?.projecao.total_despesas || 0

  const controls = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
      <TextField select size="small" label="Período" value={periodo} onChange={(e) => setPeriodo(e.target.value)} sx={{ minWidth: 170 }}>
        <MenuItem value="mes">Mês</MenuItem>
        <MenuItem value="tri">Últimos 3 meses</MenuItem>
        <MenuItem value="ano">Ano (acumulado)</MenuItem>
      </TextField>
      <TextField type="month" size="small" label={periodo === 'ano' ? 'Ano (ref.)' : 'Mês'} value={ym} onChange={(e) => setYm(e.target.value || currentYm())} InputLabelProps={{ shrink: true }} />
      <TextField select size="small" label="Base de cálculo" value={base} onChange={(e) => setBase(e.target.value)} sx={{ minWidth: 210 }}>
        <MenuItem value="REALIZADO">Somente realizado</MenuItem>
        <MenuItem value="REALIZADO_E_PREVISTO">Realizado + previsto</MenuItem>
      </TextField>
    </Stack>
  )

  const KPIS = k && [
    { label: periodo === 'mes' ? 'Honorários do mês' : periodo === 'ano' ? 'Honorários do ano' : 'Honorários (3 meses)', value: fmtMoney(k.honorarios), icon: <TrendingUpIcon />, color: 'success', delta: fmtDeltaPct(v?.honorarios), deltaRaw: v?.honorarios, deltaGoodWhenUp: true },
    { label: 'Contratos ativos', value: fmtInt(k.contratos_ativos), icon: <GroupsIcon />, color: 'info' },
    { label: 'Honorário médio', value: fmtMoney(k.honorario_medio), icon: <PriceCheckIcon />, color: 'info' },
    { label: 'Total de despesas', value: fmtMoney(k.total_despesas), icon: <TrendingDownIcon />, color: 'error', delta: fmtDeltaPct(v?.total_despesas), deltaRaw: v?.total_despesas, deltaGoodWhenUp: false },
    { label: 'Lucro operacional', value: fmtMoney(k.lucro_operacional), icon: <PaymentsIcon />, color: k.lucro_operacional >= 0 ? 'success' : 'error', negative: k.lucro_operacional < 0, delta: fmtDeltaPct(v?.lucro_operacional), deltaRaw: v?.lucro_operacional, deltaGoodWhenUp: true },
    { label: 'Margem operacional', value: fmtPct(k.margem_operacional), icon: <PercentIcon />, color: 'primary', delta: fmtDeltaPts(v?.margem_pontos), deltaRaw: v?.margem_pontos, deltaGoodWhenUp: true },
    { label: 'AV% Despesas fixas', value: fmtPct(k.av_despesas_fixas), icon: <ReceiptLongIcon />, color: 'warning' },
    { label: 'AV% Despesas variáveis', value: fmtPct(k.av_despesas_variaveis), icon: <ReceiptLongIcon />, color: 'warning' },
  ]

  return (
    <Stack spacing={2.5}>
      <PageHeader title="Dashboard Financeiro" subtitle="Indicadores do mês, evolução anual e projeção — derivados de receitas, despesas e contratos." actions={controls} />

      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {periodo === 'mes' ? (
          <Chip icon={fechado ? <LockIcon /> : <LockOpenIcon />} color={fechado ? 'default' : 'success'} variant="outlined"
            label={`Competência ${ano}-${pad(mes)} · ${fechado ? 'FECHADA' : 'ABERTA'}`} />
        ) : (
          <Chip icon={<QueryStatsIcon />} color="primary" variant="outlined"
            label={periodo === 'ano' ? `Ano ${ano} · acumulado` : `Últimos 3 meses · até ${ano}-${pad(mes)}`} />
        )}
        <Chip size="small" variant="outlined" label={base === 'REALIZADO' ? 'Base: realizado' : 'Base: realizado + previsto'} />
      </Stack>

      {insQ.data && insQ.data.itens.length > 0 && !(insQ.data.itens.length === 1 && insQ.data.itens[0].codigo === 'ok') && (
        <Grid container spacing={1.5}>
          {insQ.data.itens.map((it) => (
            <Grid item xs={12} md={6} key={it.codigo}>
              <Alert severity={it.severity} icon={it.codigo === 'ok' ? <LightbulbIcon fontSize="inherit" /> : undefined} sx={{ '& .MuiAlert-message': { py: 0.25 } }}>
                <AlertTitle sx={{ mb: 0.25, fontWeight: 700 }}>{it.titulo}</AlertTitle>
                {it.detalhe}
              </Alert>
            </Grid>
          ))}
        </Grid>
      )}

      <PapperBlock title="Saúde financeira" subtitle={`${ano} · índice 0–100 do negócio`} icon={<SpeedIcon />} iconColor="linear-gradient(135deg,#3b82f6,#8b5cf6)">
        {saudeQ.isError ? <Alert severity="error">Não foi possível calcular o score.</Alert> : <SaudeBlock data={saudeQ.data} />}
      </PapperBlock>

      {kpisQ.isError && <Alert severity="error">Não foi possível carregar os indicadores.</Alert>}

      {k && !k.tem_lancamento ? (
        <Alert severity="info">Nenhum lançamento {periodo === 'mes' ? 'nesta competência' : 'neste período'}{base === 'REALIZADO' ? ' (base realizado)' : ''}. Selecione outro período ou inclua lançamentos no Gerenciador Financeiro.</Alert>
      ) : (
        <Grid container spacing={2}>
          {(KPIS || Array.from({ length: 8 })).map((c, i) => (
            <Grid item xs={12} sm={6} md={3} key={c?.label || i}>
              {c ? <KpiCard {...c} /> : <Skeleton variant="rounded" height={120} sx={{ borderRadius: 3 }} />}
            </Grid>
          ))}
        </Grid>
      )}

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={5}>
          <PapperBlock title="Despesas por categoria" subtitle={periodoLabel} icon={<ReceiptLongIcon />} iconColor="linear-gradient(135deg,#ef4444,#f87171)" noPadding>
            {catQ.data && catQ.data.itens.length > 0 && (
              <Box sx={{ display: 'grid', placeItems: 'center', pt: 1 }}>
                <PieChart
                  height={220}
                  series={[{
                    data: catQ.data.itens.map((it, i) => ({ id: i, value: it.valor, label: it.categoria_nome, color: PIE_COLORS[i % PIE_COLORS.length] })),
                    innerRadius: 52, paddingAngle: 1, cornerRadius: 3,
                    valueFormatter: (v) => fmtMoney(v.value),
                    highlightScope: { faded: 'global', highlighted: 'item' },
                  }]}
                  slotProps={{ legend: { hidden: true } }}
                />
              </Box>
            )}
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Categoria</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Tipo</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Valor</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      <Tooltip title="Análise vertical: valor ÷ receita do mês"><span>AV% receita</span></Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>% desp.</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(catQ.data?.itens || []).map((it, i) => (
                    <TableRow key={`${it.categoria_nome}-${it.tipo}-${i}`} hover>
                      <TableCell>{it.categoria_nome}</TableCell>
                      <TableCell><TipoChip tipo={it.tipo} /></TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(it.valor)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPct(it.av_sobre_receita)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPct(it.participacao_na_despesa)}</TableCell>
                    </TableRow>
                  ))}
                  {catQ.data && catQ.data.itens.length === 0 && (
                    <TableRow><TableCell colSpan={5}><Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>Sem despesas nesta competência.</Typography></TableCell></TableRow>
                  )}
                  {catQ.data && catQ.data.itens.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={2} sx={{ fontWeight: 700 }}>Total</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(catQ.data.total)}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </PapperBlock>
        </Grid>

        <Grid item xs={12} md={7}>
          <PapperBlock title="Evolução anual" subtitle={`${ano} · receita, despesa e lucro por mês`} icon={<QueryStatsIcon />} iconColor="linear-gradient(135deg,#3b82f6,#60a5fa)">
            {evo.length > 0 ? (
              <Box sx={{ width: '100%' }}>
                <BarChart
                  height={320}
                  xAxis={[{ scaleType: 'band', data: evo.map((p) => MESES[p.mes - 1]) }]}
                  series={[
                    { data: serie((p) => p.honorarios), label: 'Receita', color: '#10b981' },
                    { data: serie((p) => p.total_despesas), label: 'Despesa', color: '#ef4444' },
                    { data: serie((p) => p.lucro_operacional), label: 'Lucro', color: '#3b82f6' },
                  ]}
                  margin={{ top: 20, right: 10, bottom: 24, left: 64 }}
                  slotProps={{ legend: { direction: 'row', position: { vertical: 'top', horizontal: 'middle' } } }}
                />
              </Box>
            ) : (
              <Skeleton variant="rounded" height={320} />
            )}
          </PapperBlock>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <PapperBlock title="Tendência de margem" subtitle={`${ano} · margem operacional por mês`} icon={<PercentIcon />} iconColor="linear-gradient(135deg,#8b5cf6,#a78bfa)">
            {evo.length > 0 ? (
              <Box sx={{ width: '100%' }}>
                <LineChart
                  height={280}
                  xAxis={[{ scaleType: 'point', data: evo.map((p) => MESES[p.mes - 1]) }]}
                  yAxis={[{ valueFormatter: (v) => `${v}%` }]}
                  series={[{
                    // Fração → % para exibição; meses vazios interrompem a linha.
                    data: evo.map((p) => (p.tem_lancamento && p.margem_operacional != null ? Math.round(p.margem_operacional * 1000) / 10 : null)),
                    label: 'Margem', color: '#8b5cf6', area: true, connectNulls: false,
                    valueFormatter: (v) => (v == null ? '—' : `${num2.format(v)}%`),
                  }]}
                  margin={{ top: 20, right: 12, bottom: 24, left: 48 }}
                  slotProps={{ legend: { hidden: true } }}
                />
              </Box>
            ) : <Skeleton variant="rounded" height={280} />}
          </PapperBlock>
        </Grid>
        <Grid item xs={12} md={6}>
          <PapperBlock title="Realizado × previsto" subtitle={`${ano} · recebido vs. contratado a vencer`} icon={<TrendingUpIcon />} iconColor="linear-gradient(135deg,#10b981,#34d399)">
            {evo.length > 0 ? (
              <Box sx={{ width: '100%' }}>
                <BarChart
                  height={280}
                  xAxis={[{ scaleType: 'band', data: evo.map((p) => MESES[p.mes - 1]) }]}
                  series={[
                    { data: evo.map((p) => p.honorarios_realizado || null), label: 'Recebido', color: '#10b981', stack: 'fat' },
                    { data: evo.map((p) => p.honorarios_previsto || null), label: 'A receber', color: '#f59e0b', stack: 'fat' },
                  ]}
                  margin={{ top: 20, right: 10, bottom: 24, left: 64 }}
                  slotProps={{ legend: { direction: 'row', position: { vertical: 'top', horizontal: 'middle' } } }}
                />
              </Box>
            ) : <Skeleton variant="rounded" height={280} />}
          </PapperBlock>
        </Grid>
      </Grid>

      <PapperBlock title="Receita por tipo de contrato" subtitle={`${ano} · composição do mês e evolução anual`} icon={<PieChartIcon />} iconColor="linear-gradient(135deg,#10b981,#34d399)">
        {tipoQ.data ? (
          <Grid container spacing={2}>
            <Grid item xs={12} md={5}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>{periodoLabel}</Typography>
              {tipoQ.data.mes.itens.length > 0 ? (
                <>
                  <Box sx={{ display: 'grid', placeItems: 'center' }}>
                    <PieChart
                      height={220}
                      series={[{
                        data: tipoQ.data.mes.itens.map((it, i) => ({ id: i, value: it.valor, label: it.tipo_nome, color: PIE_COLORS[i % PIE_COLORS.length] })),
                        innerRadius: 52, paddingAngle: 1, cornerRadius: 3,
                        valueFormatter: (v) => fmtMoney(v.value),
                        highlightScope: { faded: 'global', highlighted: 'item' },
                      }]}
                      slotProps={{ legend: { hidden: true } }}
                    />
                  </Box>
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    {tipoQ.data.mes.itens.map((it, i) => (
                      <Stack key={it.tipo_nome} direction="row" justifyContent="space-between" alignItems="center">
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <Typography variant="body2">{it.tipo_nome}</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(it.valor)} · {fmtPct(it.participacao)}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </>
              ) : <Alert severity="info">Sem receita neste mês.</Alert>}
            </Grid>
            <Grid item xs={12} md={7}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>Evolução {ano}</Typography>
              <Box sx={{ width: '100%' }}>
                <BarChart
                  height={300}
                  xAxis={[{ scaleType: 'band', data: tipoQ.data.anual.meses.map((m) => MESES[m.mes - 1]) }]}
                  series={tipoQ.data.anual.tipos.map((t, i) => ({ data: tipoQ.data.anual.meses.map((m) => m.valores[t] ?? null), label: t, color: PIE_COLORS[i % PIE_COLORS.length], stack: 'r' }))}
                  margin={{ top: 20, right: 10, bottom: 24, left: 64 }}
                  slotProps={{ legend: { direction: 'row', position: { vertical: 'top', horizontal: 'middle' } } }}
                />
              </Box>
            </Grid>
          </Grid>
        ) : <Skeleton variant="rounded" height={300} />}
      </PapperBlock>

      <PapperBlock title="Recebimentos e inadimplência" subtitle={`${ano} · cobranças de contrato por vencimento`} icon={<PaymentsIcon />} iconColor="linear-gradient(135deg,#ef4444,#f87171)">
        {inadQ.isError ? <Alert severity="error">Não foi possível carregar a inadimplência.</Alert> : inadQ.data ? (
          <Stack spacing={1.5}>
            <Box sx={{ width: '100%' }}>
              <BarChart
                height={300}
                xAxis={[{ scaleType: 'band', data: inadQ.data.meses.map((m) => MESES[m.mes - 1]) }]}
                series={[
                  { data: inadQ.data.meses.map((m) => m.recebido || null), label: 'Recebido', color: '#10b981', stack: 'c' },
                  { data: inadQ.data.meses.map((m) => m.a_vencer || null), label: 'A vencer', color: '#3b82f6', stack: 'c' },
                  { data: inadQ.data.meses.map((m) => m.vencido || null), label: 'Vencido', color: '#ef4444', stack: 'c' },
                ]}
                margin={{ top: 20, right: 10, bottom: 24, left: 64 }}
                slotProps={{ legend: { direction: 'row', position: { vertical: 'top', horizontal: 'middle' } } }}
              />
            </Box>
            <Divider />
            <AgingBar aging={inadQ.data.aging} />
          </Stack>
        ) : <Skeleton variant="rounded" height={300} />}
      </PapperBlock>

      <PapperBlock title="Metas do ano" subtitle={`${ano} · orçado × realizado`} icon={<FlagIcon />} iconColor="linear-gradient(135deg,#8b5cf6,#a78bfa)">
        {metasQ.data ? (
          metasQ.data.definida && metasQ.data.meta ? (
            <Stack spacing={2}>
              {canManageMetas && (
                <Stack direction="row" justifyContent="flex-end">
                  <Button size="small" startIcon={<EditIcon />} onClick={() => setMetasOpen(true)}>Editar metas</Button>
                </Stack>
              )}
              <MetaProgress label="Receita" realizado={metasQ.data.realizado.honorarios} meta={metasQ.data.meta.honorarios} projecao={metasQ.data.projecao.honorarios} />
              <MetaProgress label="Despesa" realizado={metasQ.data.realizado.total_despesas} meta={metasQ.data.meta.despesas} projecao={metasQ.data.projecao.total_despesas} invertido />
              <MetaProgress label="Lucro" realizado={metasQ.data.realizado.lucro_operacional} meta={metasQ.data.meta.lucro} projecao={metasQ.data.projecao.lucro_operacional} />
              <Typography variant="caption" color="text.secondary">
                Barra = realizado acumulado do ano; marcador vertical = projeção anual. Meta de lucro = meta de receita − meta de despesa.
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={1.5} alignItems="flex-start">
              <Alert severity="info" sx={{ width: '100%' }}>Nenhuma meta definida para {ano}.{!canManageMetas ? ' Peça a um administrador para defini-la.' : ''}</Alert>
              {canManageMetas && <Button variant="contained" startIcon={<FlagIcon />} onClick={() => setMetasOpen(true)}>Definir metas</Button>}
            </Stack>
          )
        ) : <Skeleton variant="rounded" height={140} />}
      </PapperBlock>

      <PapperBlock title="Projeção anual" subtitle="Estimativa a partir dos meses fechados (previsto não entra)" icon={<QueryStatsIcon />} iconColor="linear-gradient(135deg,#8b5cf6,#a78bfa)">
        {projQ.isError ? <Alert severity="error">Não foi possível carregar a projeção.</Alert> : <ProjecaoBlock p={projQ.data} />}
      </PapperBlock>

      <PapperBlock title="Simulador de cenários" subtitle="Ajuste as variáveis e veja o impacto no lucro anual" icon={<TuneIcon />} iconColor="linear-gradient(135deg,#0ea5e9,#22d3ee)">
        <SimuladorBlock baseReceita={baseReceita} baseFixa={baseDesp * propFixa} baseVar={baseDesp * (1 - propFixa)} vencido={inadQ.data?.aging.total || 0} />
      </PapperBlock>

      <MetasDialog ano={ano} open={metasOpen} onClose={() => setMetasOpen(false)} initial={metaEditQ.data} onSaved={onMetasSaved} />
    </Stack>
  )
}
