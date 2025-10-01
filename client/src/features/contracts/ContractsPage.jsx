import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { contractsService, clientsPicker } from './contracts.service'
import PageHeader from '@/components/PageHeader'
import {
  Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

// em algum utils ou no topo do componente:
const dtf = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Campo_Grande' });

function formatDateOnly(val) {
  if (!val) return '-';
  // se vier como 'YYYY-MM-DD' (Postgres DATE), não crie new Date() pra não deslocar o dia
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-').map(Number);
    return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
  }
  const d = new Date(val);
  if (isNaN(d)) return '-';
  return dtf.format(d); // dd/mm/aaaa sem horário
}


const schema = z.object({
  client_id: z.coerce.number().int().positive({ message: 'Selecione um cliente' }),
  description: z.string().min(3, 'Descrição obrigatória'),
  value: z.coerce.number().nonnegative('Valor inválido'),
  start_date: z.string().min(10, 'Data inicial obrigatória'),
  end_date: z.string().min(10, 'Data final obrigatória'),
  billing_day: z.coerce.number().int().min(1).max(31)
})

function ContractDialog({ open, onClose, onSubmit, defaultValues }) {
  const [clients, setClients] = useState([])
  const { register, handleSubmit, formState:{ errors, isSubmitting }, reset } = useForm({ resolver: zodResolver(schema), defaultValues })
  useEffect(() => { reset(defaultValues) }, [defaultValues])
  useEffect(() => { clientsPicker().then(setClients).catch(()=>setClients([])) }, [])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{defaultValues?.id ? 'Editar contrato' : 'Novo contrato'}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} md={6}>
            <TextField select fullWidth label="Cliente" defaultValue={defaultValues?.client_id ?? ''} {...register('client_id')} error={!!errors.client_id} helperText={errors.client_id?.message}>
              <MenuItem value="">Selecione…</MenuItem>
              {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth label="Descrição" {...register('description')} error={!!errors.description} helperText={errors.description?.message} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Valor (R$)" type="number" inputProps={{ step: '0.01' }} {...register('value')} error={!!errors.value} helperText={errors.value?.message} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Início" type="date" InputLabelProps={{ shrink: true }} {...register('start_date')} error={!!errors.start_date} helperText={errors.start_date?.message} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Fim" type="date" InputLabelProps={{ shrink: true }} {...register('end_date')} error={!!errors.end_date} helperText={errors.end_date?.message} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Dia de cobrança" type="number" inputProps={{ min:1, max:31 }} {...register('billing_day')} error={!!errors.billing_day} helperText={errors.billing_day?.message} />
          </Grid>
        </Grid>
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

export default function ContractsPage() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['contracts'], queryFn: contractsService.list })
  const create = useMutation({ mutationFn: contractsService.create, onSuccess: () => qc.invalidateQueries({ queryKey: ['contracts'] }) })
  const update = useMutation({ mutationFn: ({id, payload}) => contractsService.update(id, payload), onSuccess: () => qc.invalidateQueries({ queryKey: ['contracts'] }) })
  const remove = useMutation({ mutationFn: contractsService.remove, onSuccess: () => qc.invalidateQueries({ queryKey: ['contracts'] }) })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const rows = useMemo(() => list.data || [], [list.data])

  const handleCreate = () => { setEditing(null); setDialogOpen(true) }
  const handleEdit = (row) => { setEditing(row); setDialogOpen(true) }
  const handleDelete = (row) => { if (confirm('Remover este contrato?')) remove.mutate(row.id) }
  const onSubmit = async (form) => {
    if (editing?.id) await update.mutateAsync({ id: editing.id, payload: form })
    else await create.mutateAsync(form)
    setDialogOpen(false)
  }

  return (
    <Stack spacing={2}>
      <PageHeader title="Contratos" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>Novo</Button>} />
      <Card><CardContent>
        {list.isLoading ? 'Carregando…' : list.error ? <Alert severity="error">Erro ao carregar</Alert> : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Descrição</TableCell>
                <TableCell>Valor</TableCell>
                <TableCell>Período</TableCell>
                <TableCell>Dia</TableCell>
                <TableCell>Última cobrança</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} hover>
                  <TableCell>{r.id}</TableCell>
                  <TableCell>{r.client_name}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell>R$ {Number(r.value).toFixed(2)}</TableCell>                                        
                  <TableCell>
  {formatDateOnly(r.start_date)} → {formatDateOnly(r.end_date)}
</TableCell>
                  <TableCell>{r.billing_day}</TableCell>
                  <TableCell>{formatDateOnly(r.last_billed_date)}</TableCell>
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

      <ContractDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={onSubmit}
        defaultValues={editing || { client_id:'', description:'', value:0, start_date:'', end_date:'', billing_day:1 }}
      />
    </Stack>
  )
}