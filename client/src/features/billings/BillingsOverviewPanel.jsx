import React, { useMemo, useState } from 'react'
import { Card, CardContent, Chip, Grid, Stack, Typography, Table, TableHead, TableRow, TableCell, TableBody, Button, Tooltip, Snackbar } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { billingsService } from './billings.service'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDateOnly } from '@/utils/date'

const label = (t) => t === 'pre' ? 'Avisado (D-4)' : t === 'due' ? 'Vence hoje (D0)' : 'Atrasado (D+3)'
const color = (t) => t === 'pre' ? 'info' : t === 'due' ? 'warning' : 'error'
const STATUS_LABELS = {
  pending: 'Pendente',
  paid: 'Pago',
  canceled: 'Cancelado',
}
const typeDescription = { pre: 'D-4', due: 'D0', late: 'D+3' }
const MS_PER_DAY = 1000 * 60 * 60 * 24
const FORCE_DIFF_CANDIDATES = [
  { diff: 0, type: 'due' },
  { diff: -4, type: 'pre' },
  { diff: 3, type: 'late' },
]

function parseIsoDateOnly(value) {
  if (!value) return null
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(year, month, day)
}

function findForceBillingCandidate(billings, today) {
  if (!billings?.length) return null
  const normalizedToday = new Date(today.getTime())
  normalizedToday.setHours(0, 0, 0, 0)
  for (const candidate of FORCE_DIFF_CANDIDATES) {
    const matched = billings.find((billing) => {
      const status = String(billing.status || '').toLowerCase()
      if (status === 'paid' || status === 'canceled') return false
      const due = parseIsoDateOnly(billing.billing_date)
      if (!due) return false
      const diff = Math.round((normalizedToday - due) / MS_PER_DAY)
      return diff === candidate.diff
    })
    if (matched) {
      return { type: candidate.type, dueDate: matched.billing_date }
    }
  }
  return null
}

function dueDateForMonth(year, month, billingDay) {
  const dayNumber = Number.isFinite(Number(billingDay)) ? Number(billingDay) : null
  if (!dayNumber) return null
  const lastDay = new Date(year, month + 1, 0).getDate()
  const normalized = Math.min(Math.max(dayNumber, 1), lastDay)
  const d = new Date(year, month, normalized)
  d.setHours(0, 0, 0, 0)
  return d
}

function toIsoDate(date) {
  if (!date) return null
  const d = new Date(date.getTime())
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getForceType(today, dueDate) {
  if (!today || !dueDate) return null
  const diff = Math.round((today.getTime() - dueDate.getTime()) / MS_PER_DAY)
  if (diff === -4) return 'pre'
  if (diff === 0) return 'due'
  if (diff === 3) return 'late'
  return null
}

export default function BillingsOverviewPanel({ ym, clientId, contractId, dueDay }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['billings_overview', ym, clientId || null, contractId || null, dueDay || null],
    queryFn: () => billingsService.overview(ym, {
      clientId: clientId || undefined,
      contractId: contractId || undefined,
      dueDay: dueDay ? Number(dueDay) : undefined
    }),
    enabled: !!ym
  })
  const bulk = useMutation({
    mutationFn: ({ contractId, y, m, status }) => billingsService.setMonthStatus(contractId, y, m, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billings_overview'] })
      qc.invalidateQueries({ queryKey: ['billings'] })
    }
  })
  const [snack, setSnack] = useState(null)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const forceMutation = useMutation({
    mutationFn: ({ contractId, date, type }) => billingsService.notifyManual({ contract_id: contractId, date, type }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['billings_overview'] })
      qc.invalidateQueries({ queryKey: ['billings'] })
      setSnack(`Mensagem ${typeDescription[vars.type]} enviada para o contrato #${vars.contractId}`)
    },
    onError: (err) => {
      setSnack(err?.response?.data?.error || 'Falha ao enviar mensagem')
    },
  })
  const [y, m] = ym ? ym.split('-').map(Number) : []

  const items = useMemo(() => {
    let list = q.data || []
    if (contractId) {
      list = list.filter(item => Number(item.contract_id) === Number(contractId))
    }
    if (clientId) {
      list = list.filter(item => item.client_id != null && Number(item.client_id) === Number(clientId))
    }
    return [...list].sort((a, b) => {
      const dayA = Number.isFinite(a.billing_day) ? a.billing_day : 999
      const dayB = Number.isFinite(b.billing_day) ? b.billing_day : 999
      if (dayA !== dayB) return dayA - dayB
      return Number(a.contract_id || 0) - Number(b.contract_id || 0)
    })
  }, [q.data, contractId, clientId])

  if (!ym) return null
  if (q.isLoading) {
    return <Typography variant="body2">Carregando visão do mês…</Typography>
  }
  if (q.isError) {
    return <Typography variant="body2" color="error">Falha ao carregar visão do mês.</Typography>
  }
  return (
    <>
      <Stack spacing={1}>
      {items.length === 0 ? (
        <Typography variant="body2">Sem dados para {ym}.</Typography>
      ) : items.map(it => {
        const allPaid = it.month_status === 'paid'
        const isCanceled = it.month_status === 'canceled'
          const contractDueDate = dueDateForMonth(today.getFullYear(), today.getMonth(), it.billing_day)
          const fallbackForceType = getForceType(today, contractDueDate)
          const fallbackDueIso = toIsoDate(contractDueDate)
          const forceCandidate = findForceBillingCandidate(it.billings, today)
          const forceType = forceCandidate?.type ?? fallbackForceType
          const forceDate = forceCandidate?.dueDate ?? fallbackDueIso
          return (
            <Card key={it.contract_id} variant="outlined">
              <CardContent>
                <Grid container alignItems="center">
                <Grid item xs={12} md={7}>
                  <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {allPaid ? <CheckCircleIcon color="success" /> : isCanceled ? <CheckCircleIcon color="warning" /> : <CheckCircleIcon color="disabled" />}
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Contrato #{it.contract_id} · {it.contract_description || '-'}
                      </Typography>
                    </Stack>
                    {it.client_name && (
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Cliente: {it.client_name}
                      </Typography>
                    )}
                  </Stack>
                </Grid>
                <Grid item xs={12} md={5} sx={{ textAlign: { xs:'left', md:'right' } }}>
                    <Stack direction="row" spacing={1} justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                      <Tooltip title="Marcar o mês inteiro como PAGO">
                        <span>
                          <Button size="small" variant="contained" disabled={allPaid || isCanceled} onClick={() => bulk.mutateAsync({ contractId: it.contract_id, y, m, status: 'paid' })}>Marcar mês PAGO</Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Cancelar cobrança do mês">
                        <span>
                          <Button size="small" variant="outlined" color="error" disabled={allPaid || isCanceled} onClick={() => bulk.mutateAsync({ contractId: it.contract_id, y, m, status: 'canceled' })}>Cancelar cobrança</Button>
                        </span>
                      </Tooltip>
                      {forceType && forceDate && (
                        <Tooltip title={`Forçar ${typeDescription[forceType]} mesmo sem disparo automático`}>
                          <span>
                            <Button
                              size="small"
                              variant="outlined"
                              color="info"
                              disabled={forceMutation.isLoading}
                              onClick={() =>
                                forceMutation.mutate({
                                  contractId: it.contract_id,
                                  date: forceDate,
                                  type: forceType,
                                })
                              }
                            >
                              Forçar message do dia -{typeDescription[forceType]}
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                    </Stack>
                  </Grid>
                </Grid>

              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                <Chip size="small" label={`Mês: ${ym}`} />
                <Chip
                  size="small"
                  color={allPaid ? 'success' : isCanceled ? 'default' : 'warning'}
                  label={`Status: ${STATUS_LABELS[String(it.month_status || 'pending').toLowerCase()]}`}
                />
                {Number.isInteger(it.billing_day) && (
                  <Chip
                    size="small"
                    color="info"
                    label={`Vencimento dia ${String(it.billing_day).padStart(2, '0')}`}
                  />
                )}
                {isCanceled && it.cancellation_date && (
                  <Chip size="small" label={`Cancelado em ${formatDateOnly(it.cancellation_date)}`} />
                )}
              </Stack>

              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                {['pre', 'due', 'late'].map(t => {
                  const n = it.notifications?.[t]
                  const active = !!(n && Number(n.count) > 0)

                  return (
                    <Chip
                      key={t}
                      size="small"
                      label={label(t)}
                      color={active ? color(t) : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      sx={!active ? { opacity: 0.6 } : undefined}
                    />
                  )
                })}
              </Stack>
              {(() => null)()}
              <Table size="small" sx={{ mt: 1 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Data</TableCell>
                    <TableCell>Valor</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Criada em</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(it.billings || []).map(b => (
                    <TableRow key={b.id}>
                      <TableCell>{b.id}</TableCell>
                      <TableCell>{formatDateOnly(b.billing_date)}</TableCell>
                      <TableCell>R$ {Number(b.amount).toFixed(2)}</TableCell>
                      <TableCell>{String(b.status || '').toUpperCase()}</TableCell>
                      <TableCell>{b.created_at ? new Date(b.created_at).toLocaleString() : '-'}</TableCell>
                    </TableRow>
                  ))}
                  {!it.billings?.length && (
                    <TableRow><TableCell colSpan={5}><i>Sem cobranças registradas para o mês.</i></TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}
      </Stack>
      <Snackbar
        open={!!snack}
        autoHideDuration={2500}
        onClose={() => setSnack(null)}
        message={snack || ''}
      />
    </>
  )
}
