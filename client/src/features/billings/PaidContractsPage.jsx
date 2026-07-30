import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Box,
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
import PapperBlock from '@/components/PapperBlock'
import TableToolbar from '@/components/TableToolbar'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import { billingsService } from '@/features/billings/billings.service'
import { clientsService } from '@/features/clients/clients.service'
import ClientAutocomplete from '@/components/ClientAutocomplete'
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

  const activeChips = []
  if (clientId) {
    const lbl = (clientsQ.data || []).find((c) => Number(c.id) === Number(clientId))?.name || clientId
    activeChips.push({ label: `Cliente: ${lbl}`, onDelete: () => { setClientId(''); setContractId('') } })
  }
  if (contractId) {
    activeChips.push({ label: `Contrato: #${contractId}`, onDelete: () => setContractId('') })
  }
  const handleClearFilters = () => { setClientId(''); setContractId('') }

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Contratos pagos"
        subtitle="Lista de contratos marcados como PAGO no mês selecionado."
      />

      <PapperBlock
        title={`${total} contratos marcados como PAGO`}
        icon={<CheckCircleIcon />}
        iconColor="success.main"
        noPadding
      >
        <TableToolbar
          filters={
            <>
              <TextField
                label="Mês"
                type="month"
                size="small"
                value={ym}
                onChange={(e) => setYm(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 150 }}
              />
              <ClientAutocomplete
                options={clientsQ.data || []}
                value={clientId}
                onChange={(id) => { setClientId(id); setContractId('') }}
                label="Cliente"
                placeholder="Buscar cliente…"
                fullWidth={false}
                sx={{ minWidth: 220 }}
              />
              <TextField
                select
                size="small"
                label="Contrato"
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                disabled={!clientId}
                SelectProps={{ displayEmpty: true }}
                sx={{ minWidth: 220 }}
              >
                <MenuItem value="">
                  <em>{clientId ? 'Todos os contratos do cliente' : 'Selecione um cliente primeiro'}</em>
                </MenuItem>
                {filteredContracts.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    #{c.id} · {c.description}
                  </MenuItem>
                ))}
              </TextField>
            </>
          }
          activeChips={activeChips}
          onClear={activeChips.length ? handleClearFilters : undefined}
          count={total}
          countLabel="contratos"
        />
        <Box sx={{ overflow: 'auto', maxHeight: { xs: 460, md: 560 } }}>
          <Table stickyHeader size="small">
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
              {paidQ.isLoading ? (
                <TableSkeleton rows={6} columns={6} />
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ border: 0 }}>
                    <EmptyState
                      icon={<CheckCircleIcon />}
                      title="Nenhum contrato pago"
                      description={`Nenhum contrato marcado como PAGO em ${ym}.`}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
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
                ))
              )}
            </TableBody>
          </Table>
        </Box>
          {totalPages > 1 && (
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" sx={{ px: 2, py: 2 }}>
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
      </PapperBlock>
    </Stack>
  )
}
