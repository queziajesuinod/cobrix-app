import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { contractsService, clientsPicker } from './contracts.service'
import { contractTypesService } from './contractTypes.service'
import { useAuth } from '@/features/auth/AuthContext'
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

const formatInterval = (v) => {
  const num = Number(v);
  if (num === 3) return 'Trimestral';
  if (num === 12) return 'Anual';
  return 'Mensal';
};


const BILLING_INTERVAL_OPTIONS = [
  { value: 1, label: 'Mensal' },
  { value: 3, label: 'Trimestral' },
  { value: 12, label: 'Anual' },
];

const schema = z.object({
  client_id: z.coerce.number().int().positive({ message: 'Selecione um cliente' }),
  contract_type_id: z.coerce.number().int().positive({ message: 'Selecione o tipo de contrato' }),
  description: z.string().min(3, 'Descrição obrigatória'),
  value: z.coerce.number().nonnegative('Valor inválido'),
  start_date: z.string().min(10, 'Data inicial obrigatória'),
  end_date: z.string().min(10, 'Data final obrigatória'),
  billing_day: z.coerce.number().int().min(1).max(31),
  billing_interval_months: z.coerce.number().int().positive().default(1),
  cancellation_date: z.string().optional(),
});

const STATUS_OPTIONS = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
];


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
  billing_interval_months: Number(form.billing_interval_months ?? 1),
});

function ContractDialog({ open, onClose, onSubmit, defaultValues, contractTypes = [] }) {
  const [clients, setClients] = useState([])
  const formDefaults = useMemo(() => ({
    client_id: defaultValues?.client_id ?? '',
    contract_type_id: defaultValues?.contract_type_id ?? '',
    description: defaultValues?.description ?? '',
    value: defaultValues?.value ?? 0,
    start_date: toDateInput(defaultValues?.start_date),
    end_date: toDateInput(defaultValues?.end_date),
    billing_day: defaultValues?.billing_day ?? 1,
    billing_interval_months: defaultValues?.billing_interval_months ?? 1,
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
          <Grid item xs={12} md={6}>
            <TextField
              select
              fullWidth
              label="Periodicidade de cobrança"
              defaultValue={defaultValues?.billing_interval_months ?? 1}
              {...register('billing_interval_months')}
              error={!!errors.billing_interval_months}
              helperText={errors.billing_interval_months?.message || 'Mensal, trimestral ou anual'}
            >
              {BILLING_INTERVAL_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
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
  const { selectedCompanyId } = useAuth()
  const enabled = Number.isInteger(selectedCompanyId)

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [contractTypeFilter, setContractTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [errorToast, setErrorToast] = useState(null)

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchInput.trim())
    }, 400)
    return () => clearTimeout(handle)
  }, [searchInput])

  useEffect(() => { setPage(0) }, [searchTerm, clientFilter, contractTypeFilter, statusFilter])

  const contractsQueryKey = useMemo(
    () => ['contracts-paginated', selectedCompanyId, { page, rowsPerPage, searchTerm, clientFilter, contractTypeFilter, statusFilter }],
    [selectedCompanyId, page, rowsPerPage, searchTerm, clientFilter, contractTypeFilter, statusFilter]
  )

  const list = useQuery({
    queryKey: contractsQueryKey,
    queryFn: () => contractsService.paginate({
      page: page + 1,
      pageSize: rowsPerPage,
      q: searchTerm || undefined,
      clientId: clientFilter || undefined,
      contractTypeId: contractTypeFilter || undefined,
      status: statusFilter || undefined,
    }),
    keepPreviousData: true,
    enabled,
  })

  const clientsOptions = useQuery({
    queryKey: ['contracts-filter-clients', selectedCompanyId],
    queryFn: () => clientsPicker({ pageSize: 500 }),
    enabled,
  })
  const contractTypesQuery = useQuery({
    queryKey: ['contract_types', selectedCompanyId],
    queryFn: () => contractTypesService.list(selectedCompanyId),
    enabled,
    retry: false,
  })
  const contractTypes = contractTypesQuery.data || []

  const showError = (error) => {
    const message = error?.response?.data?.error || error?.message || 'Falha na operação'
    setErrorToast(message)
  }

  const create = useMutation({
    mutationFn: contractsService.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts-paginated'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
    },
    onError: showError,
  })
  const update = useMutation({
    mutationFn: ({ id, payload }) => contractsService.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts-paginated'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
    },
    onError: showError,
  })
  const setStatus = useMutation({
    mutationFn: ({ id, active }) => contractsService.setStatus(id, { active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts-paginated'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
    },
    onError: showError,
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const rows = useMemo(() => list.data?.data || [], [list.data])
  const total = list.data?.total || 0

  const handleCreate = () => {
    if (!enabled) return
    setEditing(null)
    setDialogOpen(true)
  }
  const handleEdit = (row) => {
    if (!enabled) return
    setEditing(row)
    setDialogOpen(true)
  }
  const handleToggleActive = (row) => {
    if (!enabled) return
    const next = !row.active
    const action = next ? 'Ativar' : 'Inativar'
    if (!confirm(`${action} este contrato?`)) return
    setStatus.mutate({ id: row.id, active: next })
  }
  const onSubmit = async (form) => {
    const payload = normalizePayloadDates(form)
    if (editing?.id) await update.mutateAsync({ id: editing.id, payload })
    else await create.mutateAsync(payload)
    setDialogOpen(false)
  }

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Contratos"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate} disabled={!enabled}>
            Novo
          </Button>
        }
      />
      {!enabled && (
        <Alert severity="info">Selecione uma empresa para visualizar e gerenciar os contratos.</Alert>
      )}
      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <TextField
                label="Buscar serviço"
                placeholder="Descrição do contrato"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                fullWidth
                disabled={!enabled}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                select
                label="Cliente"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                fullWidth
               
                disabled={!enabled}
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
                
                disabled={!enabled}
              >
                <MenuItem value=""><em>Todos os tipos</em></MenuItem>
                {contractTypes.map((type) => (
                  <MenuItem key={type.id} value={type.id}>{type.name}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                select
                label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                fullWidth
                disabled={!enabled}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={1} sx={{ display: 'flex', alignItems: 'center' }}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => { setSearchInput(''); setClientFilter(''); setContractTypeFilter(''); setStatusFilter('active'); }}
                disabled={!enabled || (!searchTerm && !clientFilter && !contractTypeFilter && statusFilter === 'active')}
              >
                Limpar filtros
              </Button>
            </Grid>
          </Grid>
          {contractTypesQuery.isError && enabled && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Não foi possível carregar os tipos de contrato: {contractTypesQuery.error?.message || 'tente novamente.'}
            </Alert>
          )}
        </CardContent>
      </Card>
      <Card><CardContent>
        {!enabled ? (
          <Alert severity="info">Selecione uma empresa para acessar os dados desta página.</Alert>
        ) : list.isLoading ? 'Carregando…' : list.error ? <Alert severity="error">Erro ao carregar contratos: {list.error?.message || 'tente novamente.'}</Alert> : rows.length === 0 ? (
          <Alert severity="info">Nenhum contrato encontrado.</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Descrição</TableCell>
                <TableCell>Tipo</TableCell>
                <TableCell>Periodicidade</TableCell>
                <TableCell>Valor</TableCell>
                <TableCell>Período</TableCell>
                <TableCell>Dia</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>última cobrança</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} hover sx={{ opacity: r.active ? 1 : 0.7 }}>
                  <TableCell>{r.id}</TableCell>
                  <TableCell>{r.client_name}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell>{r.contract_type_name || '-'}</TableCell>
                  <TableCell>{formatInterval(r.billing_interval_months)}</TableCell>
                  <TableCell>{Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</TableCell>
                  <TableCell>{formatDateOnly(r.start_date)} ? {formatDateOnly(r.end_date)}</TableCell>
                  <TableCell>{r.billing_day}</TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Chip label={r.active ? 'Ativo' : 'Inativo'} color={r.active ? 'success' : 'default'} size="small" />
                      {r.cancellation_date ? <small style={{ color: 'rgba(0,0,0,0.6)' }}>Cancelado em {formatDateOnly(r.cancellation_date)}</small> : null}
                    </Stack>
                  </TableCell>
                  <TableCell>{formatDateOnly(r.last_billed_date)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleEdit(r)} disabled={!enabled}><EditIcon fontSize="small" /></IconButton>
                    <Tooltip title={r.active ? 'Inativar' : 'Ativar'}>
                      <span>
                        <IconButton size="small" color={r.active ? 'warning' : 'success'} onClick={() => handleToggleActive(r)} disabled={!enabled}>
                          {r.active ? <ToggleOffIcon fontSize="small" /> : <ToggleOnIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {enabled && (
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => { setRowsPerPage(parseInt(event.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 20, 50]}
          />
        )}
      </CardContent></Card>

      <ContractDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={onSubmit}
        defaultValues={editing || { client_id:'', contract_type_id:'', description:'', value:0, start_date:'', end_date:'', billing_day:1, billing_interval_months:1, cancellation_date:'' }}
        contractTypes={contractTypes}
      />
      <Snackbar open={!!errorToast} autoHideDuration={4000} onClose={() => setErrorToast(null)}>
        <Alert severity="error" variant="filled" onClose={() => setErrorToast(null)}>
          {errorToast}
        </Alert>
      </Snackbar>
    </Stack>
  )
}
