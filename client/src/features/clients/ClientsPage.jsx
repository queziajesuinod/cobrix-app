import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clientsService } from './clients.service'
import PageHeader from '@/components/PageHeader'
import {
  Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, IconButton, MenuItem, Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TablePagination, TextField, Tooltip
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import ToggleOnIcon from '@mui/icons-material/ToggleOn'
import ToggleOffIcon from '@mui/icons-material/ToggleOff'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

const digitsOnly = (value = '') => String(value).replace(/\D+/g, '')

const formatCpf = (digits) => {
  const clean = digits.slice(0, 11)
  return clean
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

const formatCnpj = (digits) => {
  const clean = digits.slice(0, 14)
  return clean
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{4})/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

const formatDocumentValue = (value) => {
  const digits = digitsOnly(value).slice(0, 14)
  if (!digits) return ''
  if (digits.length <= 11) return formatCpf(digits)
  return formatCnpj(digits)
}
const formatPhoneValue = (value = '') => {
  const digits = digitsOnly(value).slice(0, 11)
  if (!digits) return ''
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, (_, a, b, c) => {
      const partC = c ? `-${c}` : ''
      return `(${a}) ${b}${partC}`
    })
  }
  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) => {
    const partC = c ? `-${c}` : ''
    return `(${a}) ${b}${partC}`
  })
}
const schema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  email: z.string().trim().email('Email inválido').optional().nullable(),
  phone: z.string().trim().min(8, 'Telefone inválido').optional().nullable(),
  responsavel: z.string().trim().min(2, 'Responsável obrigatório'),
  document: z.string().trim().optional().nullable().refine((value) => {
    if (!value) return true;
    const digits = digitsOnly(value);
    return digits.length === 11 || digits.length === 14;
  }, { message: 'Documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos' }),
});

const STATUS_OPTIONS = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

function ClientDialog({ open, onClose, onSubmit, defaultValues }) {
  const formDefaults = React.useMemo(() => ({
    name: defaultValues?.name ?? '',
    email: defaultValues?.email ?? '',
    phone: formatPhoneValue(defaultValues?.phone ?? ''),
    responsavel: defaultValues?.responsavel ?? '',
    document: formatDocumentValue(defaultValues?.document ?? defaultValues?.document_cpf ?? defaultValues?.document_cnpj ?? ''),
  }), [defaultValues])
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, control } = useForm({ resolver: zodResolver(schema), defaultValues: formDefaults })
  React.useEffect(() => { reset(formDefaults) }, [formDefaults, reset])
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{defaultValues?.id ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Nome" required {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
          <TextField label="Email" {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <TextField
                label="Telefone"
                value={field.value ?? ''}
                onChange={(event) => field.onChange(formatPhoneValue(event.target.value))}
                error={!!errors.phone}
                helperText={errors.phone?.message}
                inputProps={{ inputMode: 'tel' }}
              />
            )}
          />
          <Controller
            name="document"
            control={control}
            render={({ field }) => (
              <TextField
                label="CPF/CNPJ"
                value={field.value ?? ''}
                onChange={(event) => field.onChange(formatDocumentValue(event.target.value))}
                placeholder="Informe o CPF ou CNPJ"
                inputProps={{ inputMode: 'numeric' }}
                error={!!errors.document}
                helperText={errors.document?.message}
              />
            )}
          />
          <TextField label="Responsável" required {...register('responsavel')} error={!!errors.responsavel} helperText={errors.responsavel?.message || 'Pessoa Responsável pelo contrato/pagamento'} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={isSubmitting} onClick={handleSubmit(onSubmit)}>
          {defaultValues?.id ? 'Salvar' : 'Criar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
export default function ClientsPage() {
  const qc = useQueryClient()
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
    const message = error?.response?.data?.error || error?.message || 'Falha na operaÃ§Ã£o'
    setErrorToast(message)
  }

  const create = useMutation({
    mutationFn: clientsService.create,
    onSuccess: invalidateClients,
    onError: showError,
  })
  const update = useMutation({
    mutationFn: ({ id, payload }) => clientsService.update(id, payload),
    onSuccess: invalidateClients,
    onError: showError,
  })
  const setStatus = useMutation({
    mutationFn: ({ id, active }) => clientsService.setStatus(id, { active }),
    onSuccess: invalidateClients,
    onError: showError,
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const rows = useMemo(() => list.data?.data || [], [list.data])
  const total = list.data?.total || 0

  const handleCreate = () => { setEditing(null); setDialogOpen(true) }
  const handleEdit = (row) => { setEditing(row); setDialogOpen(true) }
  const handleToggleActive = (row) => {
    const next = !row.active
    const action = next ? 'Ativar' : 'Inativar'
    if (!confirm(`${action} este cliente?`)) return
    setStatus.mutate({ id: row.id, active: next })
  }
  const onSubmit = async (form) => {
    const payload = {
      ...form,
      document: (() => {
        const digits = digitsOnly(form.document || '').slice(0, 14)
        return digits || null
      })(),
      phone: (() => {
        const digits = digitsOnly(form.phone || '').slice(0, 11)
        return digits || null
      })(),
    }
    if (editing?.id) await update.mutateAsync({ id: editing.id, payload })
    else await create.mutateAsync(payload)
    setDialogOpen(false)
  }

  return (
    <Stack spacing={2}>
      <PageHeader title="Clientes" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>Novo</Button>} />
      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} md={8}>
              <TextField
                fullWidth
                label="Buscar clientes"
                placeholder="Nome ou ResponsÃ¡vel"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                select
                label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                fullWidth
              >
                {STATUS_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
      <Card><CardContent>
        {list.isLoading ? 'Carregando...' : list.error ? <Alert severity="error">Erro ao carregar</Alert> : rows.length === 0 ? (
          <Alert severity="info">Nenhum cliente encontrado.</Alert>
        ) : (
          <Table size="small">
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
              {rows.map(r => (
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
                    <IconButton size="small" onClick={() => handleEdit(r)}><EditIcon fontSize="small" /></IconButton>
                    <Tooltip title={r.active ? 'Inativar' : 'Ativar'}>
                      <IconButton size="small" color={r.active ? 'warning' : 'success'} onClick={() => handleToggleActive(r)}>
                        {r.active ? <ToggleOffIcon fontSize="small" /> : <ToggleOnIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => { setRowsPerPage(parseInt(event.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]}
        />
      </CardContent></Card>

      <ClientDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSubmit={onSubmit} defaultValues={editing} />
      <Snackbar open={!!errorToast} autoHideDuration={4000} onClose={() => setErrorToast(null)}>
        <Alert severity="error" variant="filled" onClose={() => setErrorToast(null)}>
          {errorToast}
        </Alert>
      </Snackbar>
    </Stack>
  )
}












