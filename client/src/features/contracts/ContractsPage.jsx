import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { contractsService, clientsPicker } from './contracts.service'
import { contractTypesService } from './contractTypes.service'
import PageHeader from '@/components/PageHeader'
import {
  Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TablePagination, TextField
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
  contract_type_id: z.coerce.number().int().positive({ message: 'Selecione o tipo de contrato' }),
  description: z.string().min(3, 'Descrição obrigatória'),
  value: z.coerce.number().nonnegative('Valor inválido'),
  start_date: z.string().min(10, 'Data inicial obrigatória'),
  end_date: z.string().min(10, 'Data final obrigatória'),
  billing_day: z.coerce.number().int().min(1).max(31),
  cancellation_date: z.string().optional()
})

const toDateInput = (value) => {
  if (!value) return '';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const normalizePayloadDates = (form) => ({
  ...form,
  start_date: toDateInput(form.start_date),
  end_date: toDateInput(form.end_date),
  cancellation_date: toDateInput(form.cancellation_date) || null,
  contract_type_id: form.contract_type_id ? Number(form.contract_type_id) : null,
  client_id: form.client_id ? Number(form.client_id) : null,
  value: Number(form.value ?? 0),
});

function ContractDialog({ open, onClose, onSubmit, defaultValues, contractTypes }) {
  const [clients, setClients] = useState([])
  const formDefaults = useMemo(() => ({
    client_id: defaultValues?.client_id ?? '',
    contract_type_id: defaultValues?.contract_type_id ?? '',
    description: defaultValues?.description ?? '',
    value: defaultValues?.value ?? 0,
    start_date: toDateInput(defaultValues?.start_date),
    end_date: toDateInput(defaultValues?.end_date),
    billing_day: defaultValues?.billing_day ?? 1,
    cancellation_date: toDateInput(defaultValues?.cancellation_date),
  }), [defaultValues])
  const { register, handleSubmit, formState:{ errors, isSubmitting }, reset } = useForm({ resolver: zodResolver(schema), defaultValues: formDefaults })
  useEffect(() => { reset(formDefaults) }, [formDefaults, reset])
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
            <TextField select fullWidth label="Tipo de contrato" defaultValue={defaultValues?.contract_type_id ?? ''} {...register('contract_type_id')} error={!!errors.contract_type_id} helperText={errors.contract_type_id?.message}>
              <MenuItem value="">Selecione…</MenuItem>
              {(contractTypes || []).map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  {type.name}{type.is_recurring ? ` (+${Number(type.adjustment_percent).toFixed(2)}%/ano)` : ''}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
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
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Cancelado em" type="date" InputLabelProps={{ shrink: true }} {...register('cancellation_date')} error={!!errors.cancellation_date} helperText={errors.cancellation_date?.message || 'Preencha apenas se o contrato foi encerrado.'} />
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

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [contractTypeFilter, setContractTypeFilter] = useState('')

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchInput.trim())
    }, 400)
    return () => clearTimeout(handle)
  }, [searchInput])

  useEffect(() => { setPage(0) }, [searchTerm, clientFilter, contractTypeFilter])

  const contractsQueryKey = useMemo(() => ['contracts-paginated', { page, rowsPerPage, searchTerm, clientFilter, contractTypeFilter }], [page, rowsPerPage, searchTerm, clientFilter, contractTypeFilter])

  const list = useQuery({
    queryKey: contractsQueryKey,
    queryFn: () => contractsService.paginate({
      page: page + 1,
      pageSize: rowsPerPage,
      q: searchTerm || undefined,
      clientId: clientFilter || undefined,
      contractTypeId: contractTypeFilter || undefined,
    }),
    keepPreviousData: true,
  })

  const clientsOptions = useQuery({
    queryKey: ['contracts-filter-clients'],
    queryFn: () => clientsPicker({ pageSize: 500 })
  })
  const contractTypesQuery = useQuery({ queryKey: ['contract_types'], queryFn: contractTypesService.list })
  const contractTypes = contractTypesQuery.data || []

  const create = useMutation({
    mutationFn: contractsService.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts-paginated'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
    }
  })
  const update = useMutation({
    mutationFn: ({ id, payload }) => contractsService.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts-paginated'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
    }
  })
  const remove = useMutation({
    mutationFn: contractsService.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts-paginated'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
    }
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const rows = useMemo(() => list.data?.data || [], [list.data])
  const total = list.data?.total || 0

  const handleCreate = () => { setEditing(null); setDialogOpen(true) }
  const handleEdit = (row) => { setEditing(row); setDialogOpen(true) }
  const handleDelete = (row) => { if (confirm('Remover este contrato?')) remove.mutate(row.id) }
  const onSubmit = async (form) => {
    const payload = normalizePayloadDates(form)
    if (editing?.id) await update.mutateAsync({ id: editing.id, payload })
    else await create.mutateAsync(payload)
    setDialogOpen(false)
  }

  return (
    <Stack spacing={2}>
      <PageHeader title="Contratos" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>Novo</Button>} />
      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <TextField
                label="Buscar serviço"
                placeholder="Descrição do contrato"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                select
                label="Cliente"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                fullWidth
                SelectProps={{ displayEmpty: true }}
              >
                <MenuItem value=""><em>Todos os clientes</em></MenuItem>
                {(clientsOptions.data || []).map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                select
                label="Tipo"
                value={contractTypeFilter}
                onChange={(e) => setContractTypeFilter(e.target.value)}
                fullWidth
                SelectProps={{ displayEmpty: true }}
              >
                <MenuItem value=""><em>Todos os tipos</em></MenuItem>
                {contractTypes.map((type) => (
                  <MenuItem key={type.id} value={type.id}>{type.name}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={1} sx={{ display: 'flex', alignItems: 'center' }}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => { setSearchInput(''); setClientFilter(''); setContractTypeFilter(''); }}
                disabled={!searchTerm && !clientFilter && !contractTypeFilter}
              >
                Limpar filtros
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
      <Card><CardContent>
        {list.isLoading ? 'Carregando…' : list.error ? <Alert severity="error">Erro ao carregar</Alert> : rows.length === 0 ? (
          <Alert severity="info">Nenhum contrato encontrado.</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Descrição</TableCell>
                <TableCell>Tipo</TableCell>
                <TableCell>Valor</TableCell>
                <TableCell>Período</TableCell>
                <TableCell>Dia</TableCell>
                <TableCell>Status</TableCell>
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
                  <TableCell>{r.contract_type_name || '-'}</TableCell>
                  <TableCell>{Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</TableCell>
                  <TableCell>{formatDateOnly(r.start_date)} → {formatDateOnly(r.end_date)}</TableCell>
                  <TableCell>{r.billing_day}</TableCell>
                  <TableCell>{r.cancellation_date ? `Cancelado em ${formatDateOnly(r.cancellation_date)}` : 'Ativo'}</TableCell>
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

      <ContractDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={onSubmit}
        defaultValues={editing || { client_id:'', contract_type_id:'', description:'', value:0, start_date:'', end_date:'', billing_day:1, cancellation_date:'' }}
        contractTypes={contractTypes}
      />
    </Stack>
  )
}
