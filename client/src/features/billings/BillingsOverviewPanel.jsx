import React, { useMemo } from 'react'
import { Card, CardContent, Chip, Grid, Stack, Typography, Table, TableHead, TableRow, TableCell, TableBody, Button, Tooltip } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { billingsService } from './billings.service'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDateOnly } from '@/utils/date'

const label = (t) => t === 'pre' ? 'Avisado (D-3)' : t === 'due' ? 'Vence hoje (D0)' : 'Atrasado (D+4)'
const color = (t) => t === 'pre' ? 'info' : t === 'due' ? 'warning' : 'error'

export default function BillingsOverviewPanel({ ym, clientId, contractId }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['billings_overview', ym, clientId || null, contractId || null],
    queryFn: () => billingsService.overview(ym, {
      clientId: clientId || undefined,
      contractId: contractId || undefined
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
  const [y, m] = ym ? ym.split('-').map(Number) : []

  const items = useMemo(() => {
    let list = q.data || []
    if (contractId) {
      list = list.filter(item => Number(item.contract_id) === Number(contractId))
    }
    if (clientId) {
      list = list.filter(item => item.client_id != null && Number(item.client_id) === Number(clientId))
    }
    return list
  }, [q.data, contractId, clientId])

  if (!ym) return null
  if (q.isLoading) {
    return <Typography variant="body2">Carregando visão do mês…</Typography>
  }
  if (q.isError) {
    return <Typography variant="body2" color="error">Falha ao carregar visão do mês.</Typography>
  }
  return (
    <Stack spacing={1}>
      {items.length === 0 ? (
        <Typography variant="body2">Sem dados para {ym}.</Typography>
      ) : items.map(it => {
        const allPaid = it.month_status === 'paid'
        return (
          <Card key={it.contract_id} variant="outlined">
            <CardContent>
              <Grid container alignItems="center">
                <Grid item xs={12} md={7}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {allPaid ? <CheckCircleIcon color="success" /> : <CheckCircleIcon color="disabled" />}
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Contrato #{it.contract_id} · {it.contract_description || '-'}</Typography>
                    <Chip size="small" label={`Mês: ${ym}`} />
                    <Chip size="small" color={allPaid ? 'success' : it.month_status === 'canceled' ? 'default' : 'warning'} label={`Status do mês: ${String(it.month_status||'pending').toUpperCase()}`} />
                  </Stack>
                </Grid>
                <Grid item xs={12} md={5} sx={{ textAlign: { xs:'left', md:'right' } }}>
                  <Tooltip title="Marcar o mês inteiro como PAGO">
                    <span>
                      <Button size="small" variant="contained" onClick={() => bulk.mutateAsync({ contractId: it.contract_id, y, m, status: 'paid' })}>Marcar mês PAGO</Button>
                    </span>
                  </Tooltip>
                </Grid>
              </Grid>

           <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
  {['pre', 'due', 'late'].map(t => {
    const n = it.notifications?.[t]
    const active = !!(n && Number(n.count) > 0) // já houve notificação deste tipo?

    return (
      <Chip
        key={t}
        size="small"
        label={label(t)}
        color={active ? color(t) : 'default'}   // acende com a cor do tipo, senão cinza
        variant={active ? 'filled' : 'outlined'}
        sx={!active ? { opacity: 0.6 } : undefined} // opcional: deixa “apagadinho” quando inativo
      />
    )
  })}
</Stack>


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
  )
}
