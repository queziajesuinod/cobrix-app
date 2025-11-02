import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clientsService } from './clients.service'
import PageHeader from '@/components/PageHeader'
import {
  Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TablePagination, TextField
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

const schema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  email: z.string().trim().email('Email inválido').optional().nullable(),
  phone: z.string().trim().min(8, 'Telefone inválido').optional().nullable(),
  responsavel: z.string().trim().min(2, 'Responsável obrigatório')
})

function ClientDialog({ open, onClose, onSubmit, defaultValues }) {
  const formDefaults = React.useMemo(() => ({
    name: defaultValues?.name ?? '',
    email: defaultValues?.email ?? '',
    phone: defaultValues?.phone ?? '',
    responsavel: defaultValues?.responsavel ?? ''
  }), [defaultValues])
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm({ resolver: zodResolver(schema), defaultValues: formDefaults })
  React.useEffect(() => { reset(formDefaults) }, [formDefaults, reset])
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{defaultValues?.id ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Nome" required {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
          <TextField label="Email" {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
          <TextField label="Telefone" {...register('phone')} error={!!errors.phone} helperText={errors.phone?.message} />
          <TextField label="Responsável" required {...register('responsavel')} error={!!errors.responsavel} helperText={errors.responsavel?.message || 'Pessoa responsável pelo contrato/pagamento'} />
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

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchInput.trim())
    }, 400)
    return () => clearTimeout(handle)
  }, [searchInput])

  useEffect(() => { setPage(0) }, [searchTerm])

  const clientsQueryKey = useMemo(() => ['clients-paginated', { page, rowsPerPage, searchTerm }], [page, rowsPerPage, searchTerm])

  const list = useQuery({
    queryKey: clientsQueryKey,
    queryFn: () => clientsService.paginate({
      page: page + 1,
      pageSize: rowsPerPage,
      q: searchTerm || undefined,
    }),
    keepPreviousData: true,
  })

  const create = useMutation({
    mutationFn: clientsService.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients-paginated'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
    }
  })
  const update = useMutation({
    mutationFn: ({ id, payload }) => clientsService.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients-paginated'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
    }
  })
  const remove = useMutation({
    mutationFn: clientsService.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients-paginated'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
    }
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const rows = useMemo(() => list.data?.data || [], [list.data])
  const total = list.data?.total || 0

  const handleCreate = () => { setEditing(null); setDialogOpen(true) }
  const handleEdit = (row) => { setEditing(row); setDialogOpen(true) }
  const handleDelete = (row) => { if (confirm('Remover este cliente?')) remove.mutate(row.id) }
  const onSubmit = async (form) => {
    if (editing?.id) await update.mutateAsync({ id: editing.id, payload: form })
    else await create.mutateAsync(form)
    setDialogOpen(false)
  }

  return (
    <Stack spacing={2}>
      <PageHeader title="Clientes" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>Novo</Button>} />
      <Card>
        <CardContent>
          <TextField
            fullWidth
            label="Buscar clientes"
            placeholder="Nome ou responsável"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </CardContent>
      </Card>
      <Card><CardContent>
        {list.isLoading ? 'Carregando…' : list.error ? <Alert severity="error">Erro ao carregar</Alert> : rows.length === 0 ? (
          <Alert severity="info">Nenhum cliente encontrado.</Alert>
        ) : (
          <Table size="small">
            <TableHead><TableRow><TableCell>ID</TableCell><TableCell>Nome</TableCell><TableCell>Responsável</TableCell><TableCell>Email</TableCell><TableCell>Telefone</TableCell><TableCell align="right">Ações</TableCell></TableRow></TableHead>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} hover>
                  <TableCell>{r.id}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.responsavel || '-'}</TableCell>
                  <TableCell>{r.email || '-'}</TableCell>
                  <TableCell>{r.phone || '-'}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleEdit(r)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(r)}><DeleteIcon fontSize="small" /></IconButton>
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
    </Stack>
  )
}
