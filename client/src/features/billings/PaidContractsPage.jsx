import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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

  const clientsQ = useQuery({ queryKey: ['clients'], queryFn: clientsService.list })
  const contractsQ = useQuery({ queryKey: ['contracts'], queryFn: contractsService.list })

  const filteredContracts = useMemo(() => {
    const list = contractsQ.data || []
    if (!clientId) return list
    return list.filter((c) => Number(c.client_id) === Number(clientId))
  }, [clientId, contractsQ.data])

  const paidQ = useQuery({
    queryKey: ['paid_contracts', ym, clientId || null, contractId || null],
    queryFn: () =>
      billingsService.paidMonths(ym, {
        clientId: clientId || undefined,
        contractId: contractId || undefined,
      }),
    enabled: !!ym,
  })

  const rows = paidQ.data || []

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
              {rows.length} contratos marcados como PAGO
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
                    <TableCell>{row.updated_at ? new Date(row.updated_at).toLocaleString('pt-BR') : '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Stack>
  )
}
