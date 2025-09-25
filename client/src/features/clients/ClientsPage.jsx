import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clientsService } from './clients.service'
import PageHeader from '@/components/PageHeader'
import {
  Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  email: z.string().email('Email inválido').optional().nullable(),
  phone: z.string().min(8, 'Telefone inválido').optional().nullable()
})

function ClientDialog({ open, onClose, onSubmit, defaultValues }) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm({ resolver: zodResolver(schema), defaultValues })
  React.useEffect(() => { reset(defaultValues) }, [defaultValues])
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{defaultValues?.id ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Nome" {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
          <TextField label="Email" {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
          <TextField label="Telefone" {...register('phone')} error={!!errors.phone} helperText={errors.phone?.message} />
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
  const list = useQuery({ queryKey: ['clients'], queryFn: clientsService.list })
  const create = useMutation({ mutationFn: clientsService.create, onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }) })
  const update = useMutation({ mutationFn: ({id, payload}) => clientsService.update(id, payload), onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }) })
  const remove = useMutation({ mutationFn: clientsService.remove, onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }) })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const rows = useMemo(() => list.data || [], [list.data])

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
      <Card><CardContent>
        {list.isLoading ? 'Carregando…' : list.error ? <Alert severity="error">Erro ao carregar</Alert> : (
          <Table size="small">
            <TableHead><TableRow><TableCell>ID</TableCell><TableCell>Nome</TableCell><TableCell>Email</TableCell><TableCell>Telefone</TableCell><TableCell align="right">Ações</TableCell></TableRow></TableHead>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} hover>
                  <TableCell>{r.id}</TableCell>
                  <TableCell>{r.name}</TableCell>
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
      </CardContent></Card>

      <ClientDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSubmit={onSubmit} defaultValues={editing || { name:'', email:'', phone:'' }} />
    </Stack>
  )
}
