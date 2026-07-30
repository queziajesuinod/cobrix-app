import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clientsService } from './clients.service'
import PageHeader from '@/components/PageHeader'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Chip,
  IconButton, MenuItem, Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TablePagination, TextField, Tooltip
} from '@mui/material'
import PapperBlock from '@/components/PapperBlock'
import TableToolbar from '@/components/TableToolbar'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import ToggleOnIcon from '@mui/icons-material/ToggleOn'
import ToggleOffIcon from '@mui/icons-material/ToggleOff'
import FilterListIcon from '@mui/icons-material/FilterList'
import PeopleIcon from '@mui/icons-material/People'
import { formatDocumentValue } from './ClientForm'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

export default function ClientsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [errorToast, setErrorToast] = useState(null)

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchInput.trim())
    }, 400)
    return () => clearTimeout(handle)
  }, [searchInput])

  useEffect(() => { setPage(0) }, [searchTerm, statusFilter])

  const clientsQueryKey = useMemo(
    () => ['clients-paginated', { page, rowsPerPage, searchTerm, statusFilter }],
    [page, rowsPerPage, searchTerm, statusFilter]
  )

  const list = useQuery({
    queryKey: clientsQueryKey,
    queryFn: () => clientsService.paginate({
      page: page + 1,
      pageSize: rowsPerPage,
      q: searchTerm || undefined,
      status: statusFilter || undefined,
    }),
    keepPreviousData: true,
  })

  const invalidateClients = () => {
    qc.invalidateQueries({ queryKey: ['clients-paginated'] })
    qc.invalidateQueries({ queryKey: ['clients'] })
  }

  const showError = (error) => {
    const message = error?.response?.data?.error || error?.message || 'Falha na operação'
    setErrorToast(message)
  }

  const setStatus = useMutation({
    mutationFn: ({ id, active }) => clientsService.setStatus(id, { active }),
    onSuccess: invalidateClients,
    onError: showError,
  })

  const rows = useMemo(() => list.data?.data || [], [list.data])
  const total = list.data?.total || 0

  const handleCreate = () => navigate('/clients/new')
  const handleEdit = (row) => navigate(`/clients/${row.id}/edit`)
  const handleToggleActive = (row) => {
    const next = !row.active
    const action = next ? 'Ativar' : 'Inativar'
    if (!confirm(`${action} este cliente?`)) return
    setStatus.mutate({ id: row.id, active: next })
  }

  const activeChips = []
  if (searchTerm) {
    activeChips.push({ label: `Busca: "${searchTerm}"`, onDelete: () => setSearchInput('') })
  }
  if (statusFilter !== 'active') {
    const lbl = STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label || statusFilter
    activeChips.push({ label: `Status: ${lbl}`, onDelete: () => setStatusFilter('active') })
  }
  const handleClearFilters = () => { setSearchInput(''); setStatusFilter('active') }

  return (
    <Stack spacing={2}>
      <PageHeader title="Clientes" subtitle="Use o menu “Cadastros › Novo cliente” para cadastrar." />
      <PapperBlock title="Clientes" icon={<PeopleIcon />} iconColor="primary.main" noPadding>
        <TableToolbar
          search={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder="Buscar por nome ou responsável…"
          filters={
            <TextField
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              {STATUS_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </TextField>
          }
          activeChips={activeChips}
          onClear={activeChips.length ? handleClearFilters : undefined}
          count={total}
          countLabel="clientes"
        />
        <Box sx={{ overflow: 'auto', maxHeight: { xs: 460, md: 560 } }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Nome</TableCell>
                <TableCell>Responsável</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Telefone</TableCell>
                <TableCell>Documento</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.isLoading ? (
                <TableSkeleton rows={6} columns={8} />
              ) : list.error ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ border: 0 }}>
                    <Alert severity="error" sx={{ my: 1 }}>Erro ao carregar clientes.</Alert>
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ border: 0 }}>
                    <EmptyState
                      icon={<PeopleIcon />}
                      title="Nenhum cliente encontrado"
                      description={activeChips.length ? 'Tente ajustar a busca ou os filtros aplicados.' : 'Cadastre um cliente pelo menu “Cadastros › Novo cliente”.'}
                      action={activeChips.length
                        ? <Button variant="outlined" onClick={handleClearFilters}>Limpar filtros</Button>
                        : undefined}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(r => (
                  <TableRow key={r.id} hover sx={{ opacity: r.active ? 1 : 0.7 }}>
                    <TableCell>{r.id}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.responsavel || '-'}</TableCell>
                    <TableCell>{r.email || '-'}</TableCell>
                    <TableCell>{r.phone || '-'}</TableCell>
                    <TableCell>{formatDocumentValue(r.document || r.document_cpf || r.document_cnpj || '') || '-'}</TableCell>
                    <TableCell>
                      <Chip label={r.active ? 'Ativo' : 'Inativo'} color={r.active ? 'success' : 'default'} size="small" />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Editar">
                        <IconButton size="small" onClick={() => handleEdit(r)}><EditIcon fontSize="small" /></IconButton>
                      </Tooltip>
                      <Tooltip title={r.active ? 'Inativar' : 'Ativar'}>
                        <IconButton size="small" color={r.active ? 'warning' : 'success'} onClick={() => handleToggleActive(r)}>
                          {r.active ? <ToggleOffIcon fontSize="small" /> : <ToggleOnIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Box>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => { setRowsPerPage(parseInt(event.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]}
          sx={{ px: 2, borderTop: '1px solid', borderColor: 'divider' }}
        />
      </PapperBlock>

      <Snackbar open={!!errorToast} autoHideDuration={4000} onClose={() => setErrorToast(null)}>
        <Alert severity="error" variant="filled" onClose={() => setErrorToast(null)}>
          {errorToast}
        </Alert>
      </Snackbar>
    </Stack>
  )
}











