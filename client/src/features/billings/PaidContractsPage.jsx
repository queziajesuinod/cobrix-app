import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Card,
  CardContent,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Typography,
  Button,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PageHeader from '@/components/PageHeader'
import { billingsService } from '@/features/billings/billings.service'
import { clientsService } from '@/features/clients/clients.service'
import { contractsService } from '@/features/contracts/contracts.service'

function formatCurrency(v) {
  const num = Number(v || 0)
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const formatRef = (year, month) => `${String(month).padStart(2, '0')}/${year}`

export default function PaidContractsPage() {
  const [ym, setYm] = useState(() => new Date().toISOString().slice(0, 7))
  const [clientId, setClientId] = useState('')
  const [contractId, setContractId] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const clientsQ = useQuery({ queryKey: ['clients'], queryFn: clientsService.list })
  const contractsQ = useQuery({ queryKey: ['contracts'], queryFn: contractsService.list })

  useEffect(() => { setPage(1) }, [ym, clientId, contractId])

  const filteredContracts = useMemo(() => {
    const list = contractsQ.data || []
    if (!clientId) return list
    return list.filter((c) => Number(c.client_id) === Number(clientId))
  }, [clientId, contractsQ.data])

  const qc = useQueryClient()

  const paidQ = useQuery({
    queryKey: ['paid_contracts', ym, clientId || null, contractId || null, page, pageSize],
    queryFn: () =>
      billingsService.paidMonths(ym, {
        clientId: clientId || undefined,
        contractId: contractId || undefined,
        page,
        pageSize,
      }),
    keepPreviousData: true,
    enabled: !!ym,
  })

  const rows = paidQ.data?.data || []
  const total = paidQ.data?.total ?? 0
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)

  const [yearStr, monthStr] = ym.split('-')
  const revertMonth = useMutation({
    mutationFn: ({ contractId, status }) =>
      billingsService.setMonthStatus(contractId, Number(yearStr), Number(monthStr), status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paid_contracts'] })
      qc.invalidateQueries({ queryKey: ['billings_overview'] })
    },
  })

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Contratos pagos"
        subtitle="Lista de contratos marcados como PAGO no mês selecionado."
      />

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <TextField
                  label="Mês"
                  type="month"
                  value={ym}
                  onChange={(e) => setYm(e.target.value)}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  select
                  label="Cliente"
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value)
                    setContractId('')
                  }}
                  fullWidth
                  SelectProps={{ displayEmpty: true }}
                >
                  <MenuItem value="">
                    <em>Todos os clientes</em>
                  </MenuItem>
                  {(clientsQ.data || []).map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} md={5}>
                <TextField
                  select
                  label="Contrato"
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                  fullWidth
                  SelectProps={{ displayEmpty: true }}
                >
                  <MenuItem value="">
                    <em>{clientId ? 'Todos os contratos do cliente' : 'Todos os contratos'}</em>
                  </MenuItem>
                  {filteredContracts.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      #{c.id} · {c.description}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
            {(clientId || contractId) && (
              <Stack direction="row" justifyContent="flex-end">
                <Button size="small" onClick={() => { setClientId(''); setContractId('') }}>
                  Limpar filtros
                </Button>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <CheckCircleIcon color="success" />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {total} contratos marcados como PAGO
            </Typography>
          </Stack>

         {paidQ.isLoading ? (
            <Typography variant="body2">Carregando…</Typography>
          ) : rows.length === 0 ? (
            <Typography variant="body2">Nenhum contrato marcado como PAGO em {ym}.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Contrato</TableCell>
                  <TableCell>Cliente</TableCell>
                  <TableCell>Valor mensal</TableCell>
                  <TableCell>Dia cobrança</TableCell>
                  <TableCell>Mês referência</TableCell>
                  <TableCell>Marcado em</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.contract_id}-${row.year}-${row.month}`}>
                    <TableCell>#{row.contract_id} · {row.contract_description || '-'}</TableCell>
                    <TableCell>{row.client_name || '-'}</TableCell>
                    <TableCell>{formatCurrency(row.contract_value)}</TableCell>
                    <TableCell>D{row.billing_day || '-'}</TableCell>
                    <TableCell>{formatRef(row.year, row.month)}</TableCell>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Typography variant="body2">
                          {row.updated_at ? new Date(row.updated_at).toLocaleString('pt-BR') : '-'}
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={revertMonth.isPending}
                          onClick={() => revertMonth.mutate({ contractId: row.contract_id, status: 'pending' })}
                        >
                          Marcar como pendente
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {totalPages > 1 && (
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" sx={{ mt: 2 }}>
              <Button size="small" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</Button>
              <Typography variant="caption">
                Página {page} de {totalPages}
              </Typography>
              <Button size="small" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Próxima</Button>
              <TextField
                select
                size="small"
                label="Itens"
                value={pageSize}
                onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }}
                sx={{ width: 100 }}
              >
                {[5, 10, 20, 50].map((size) => (
                  <MenuItem key={size} value={size}>{size}</MenuItem>
                ))}
              </TextField>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  )
}
