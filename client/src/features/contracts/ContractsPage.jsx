import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { contractsService, clientsPicker } from './contracts.service'
import { contractTypesService } from './contractTypes.service'
import { useAuth } from '@/features/auth/AuthContext'
import PageHeader from '@/components/PageHeader'
import {
  Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, IconButton, MenuItem, Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TablePagination, TextField, Tooltip, Typography
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import ToggleOnIcon from '@mui/icons-material/ToggleOn'
import ToggleOffIcon from '@mui/icons-material/ToggleOff'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
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

const formatBillingMode = (mode, intervalMonths, intervalDays) => {
  const normalized = String(mode || 'monthly').toLowerCase();
  if (normalized === 'interval_days') return 'Semanal';
  if (normalized === 'custom_dates') return 'Personalizado';
  const num = Number(intervalMonths);
  if (num === 3) return 'Trimestral';
  if (num === 12) return 'Anual';
  return 'Mensal';
};


const BILLING_INTERVAL_OPTIONS = [
  { value: 1, label: 'Mensal' },
  { value: 3, label: 'Trimestral' },
  { value: 12, label: 'Anual' },
];

const BILLING_MODE_OPTIONS = [
  { value: 'monthly', label: 'Geral' },
  { value: 'interval_days', label: 'Semanal' },
  { value: 'custom_dates', label: 'Datas personalizadas' },
];

const schema = z.object({
  client_id: z.coerce.number().int().positive({ message: 'Selecione um cliente' }),
  contract_type_id: z.coerce.number().int().positive({ message: 'Selecione o tipo de contrato' }),
  description: z.string().min(3, 'Descrição obrigatória'),
  value: z.coerce.number().nonnegative('Valor inválido'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  billing_mode: z.enum(['monthly', 'interval_days', 'custom_dates']).default('monthly'),
  billing_day: z.coerce.number().int().min(1).max(31),
  billing_interval_months: z.coerce.number().int().positive().default(1),
  billing_interval_days: z.coerce.number().int().positive().optional(),
  cancellation_date: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.billing_mode !== 'custom_dates') {
    if (!data.start_date || data.start_date.length < 10) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['start_date'], message: 'Data inicial obrigatória' })
    }
    if (!data.end_date || data.end_date.length < 10) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end_date'], message: 'Data final obrigatória' })
    }
  }
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

const parseNumberInput = (value) => {
  if (value === '' || value == null) return null;
  const normalized = String(value).replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
};

const formatNumber = (value) => {
  if (!Number.isFinite(value)) return '';
  const fixed = value.toFixed(2);
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

const formatCurrency = (value) => {
  const num = Number(value ?? 0);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const normalizePayloadDates = (form) => {
  const billingMode = String(form.billing_mode || 'monthly').toLowerCase();
  return {
    ...form,
    start_date: toDateInput(form.start_date),
    end_date: toDateInput(form.end_date),
    cancellation_date: toDateInput(form.cancellation_date) || null,
    contract_type_id: form.contract_type_id ? Number(form.contract_type_id) : null,
    client_id: form.client_id ? Number(form.client_id) : null,
    value: Number(form.value ?? 0),
    billing_mode: billingMode,
    billing_interval_months: Number(form.billing_interval_months ?? 1),
    billing_interval_days: billingMode === 'interval_days' ? Number(form.billing_interval_days || 7) : null,
  };
};

function ContractDialog({ open, onClose, onSubmit, defaultValues, contractTypes = [] }) {
  const [clients, setClients] = useState([])
  const [customBillings, setCustomBillings] = useState([])
  const [customError, setCustomError] = useState(null)
  const [customWarning, setCustomWarning] = useState(null)
  const warnedValueRef = useRef(false)
  const formDefaults = useMemo(() => ({
    client_id: defaultValues?.client_id ?? '',
    contract_type_id: defaultValues?.contract_type_id ?? '',
    description: defaultValues?.description ?? '',
    value: defaultValues?.value ?? 0,
    start_date: toDateInput(defaultValues?.start_date),
    end_date: toDateInput(defaultValues?.end_date),
    billing_mode: defaultValues?.billing_mode ?? 'monthly',
    billing_day: defaultValues?.billing_day ?? 1,
    billing_interval_months: defaultValues?.billing_interval_months ?? 1,
    billing_interval_days: defaultValues?.billing_interval_days ?? 7,
    cancellation_date: toDateInput(defaultValues?.cancellation_date),
  }), [defaultValues])
  const { register, handleSubmit, formState:{ errors, isSubmitting, dirtyFields }, reset, watch, setValue } = useForm({ resolver: zodResolver(schema), defaultValues: formDefaults })
  useEffect(() => { reset(formDefaults) }, [formDefaults, reset])
  useEffect(() => { clientsPicker().then(setClients).catch(()=>setClients([])) }, [])
  const billingMode = watch('billing_mode')
  const selectedContractTypeId = watch('contract_type_id')
  const contractValue = parseNumberInput(watch('value'))
  const hasContractValue = Number.isFinite(contractValue) && contractValue > 0
  const restrictToNoAdjustment = billingMode === 'interval_days' || billingMode === 'custom_dates'
  const availableContractTypes = useMemo(() => {
    if (!restrictToNoAdjustment) return contractTypes || []
    return (contractTypes || []).filter((type) => !type.is_recurring)
  }, [contractTypes, restrictToNoAdjustment])
  const canEditCustomDates = billingMode === 'custom_dates' && hasContractValue
  const addCustomBilling = () => {
    if (!hasContractValue) return
    setCustomBillings((prev) => ([...prev, { billing_date: '', amount: '', percentage: '' }]))
  }
  const updateCustomBilling = (idx, updates) => {
    setCustomBillings((prev) => prev.map((item, i) => (i === idx ? { ...item, ...updates } : item)))
  }
  const handleCustomAmountChange = (idx, rawValue) => {
    const amountNum = parseNumberInput(rawValue)
    setCustomBillings((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      if (rawValue === '') return { ...item, amount: '', percentage: '' }
      if (amountNum == null || !hasContractValue) return { ...item, amount: rawValue }
      const percentage = (amountNum / contractValue) * 100
      return { ...item, amount: rawValue, percentage: formatNumber(percentage) }
    }))
  }
  const handleCustomPercentageChange = (idx, rawValue) => {
    const percentageNum = parseNumberInput(rawValue)
    setCustomBillings((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      if (rawValue === '') return { ...item, percentage: '', amount: '' }
      if (percentageNum == null || !hasContractValue) return { ...item, percentage: rawValue }
      const amount = (contractValue * percentageNum) / 100
      return { ...item, percentage: rawValue, amount: formatNumber(amount) }
    }))
  }
  const removeCustomBilling = (idx) => {
    setCustomBillings((prev) => prev.filter((_, i) => i !== idx))
  }

  useEffect(() => {
    setCustomError(null)
    setCustomWarning(null)
    warnedValueRef.current = false
    if (!open) return
    if (billingMode !== 'custom_dates') {
      setCustomBillings([])
      return
    }
    if (!defaultValues?.id) {
      setCustomBillings((prev) => (prev.length ? prev : [{ billing_date: '', amount: '', percentage: '' }]))
      return
    }
    let active = true
    contractsService.getCustomBillings(defaultValues.id)
      .then((items) => {
        if (!active) return
        const normalized = (items || []).map((item) => ({
          billing_date: toDateInput(item.billing_date),
          amount: item.amount != null ? String(item.amount) : '',
          percentage: item.percentage != null ? String(item.percentage) : '',
        }))
        setCustomBillings(normalized.length ? normalized : [{ billing_date: '', amount: '', percentage: '' }])
      })
      .catch(() => {
        if (active) setCustomBillings([{ billing_date: '', amount: '', percentage: '' }])
      })
    return () => { active = false }
  }, [billingMode, defaultValues?.id, open])

  useEffect(() => {
    if (!restrictToNoAdjustment || !selectedContractTypeId) return
    const current = (contractTypes || []).find((type) => String(type.id) === String(selectedContractTypeId))
    if (!current || !current.is_recurring) return
    const fallback = availableContractTypes[0]
    setValue('contract_type_id', fallback ? String(fallback.id) : '')
  }, [availableContractTypes, contractTypes, restrictToNoAdjustment, selectedContractTypeId, setValue])

  useEffect(() => {
    if (!open || billingMode !== 'custom_dates') return
    if (!dirtyFields?.value || warnedValueRef.current) return
    const hasCustomData = customBillings.some((item) => item.billing_date || item.amount || item.percentage)
    if (!hasCustomData) return
    setCustomWarning('Valor do contrato alterado. Revise as datas personalizadas para recalcular.')
    warnedValueRef.current = true
  }, [billingMode, customBillings, dirtyFields?.value, open])

  useEffect(() => {
    if (billingMode !== 'custom_dates') return
    const dates = customBillings
      .map((item) => toDateInput(item.billing_date))
      .filter((value) => value)
      .sort()
    if (!dates.length) {
      setValue('start_date', '')
      setValue('end_date', '')
      return
    }
    setValue('start_date', dates[0])
    setValue('end_date', dates[dates.length - 1])
    setValue('billing_day', 1)
    setValue('billing_interval_months', 1)
  }, [billingMode, customBillings, setValue])

  const customTotals = useMemo(() => {
    if (!hasContractValue) return null
    const total = (customBillings || []).reduce((sum, item) => {
      const amount = parseNumberInput(item.amount)
      if (Number.isFinite(amount) && amount > 0) return sum + amount
      const percentage = parseNumberInput(item.percentage)
      if (Number.isFinite(percentage) && percentage > 0) {
        return sum + (contractValue * percentage) / 100
      }
      return sum
    }, 0)
    const remaining = contractValue - total
    return { total, remaining }
  }, [customBillings, contractValue, hasContractValue])

  const submitForm = handleSubmit((form) => onSubmit(form, customBillings, setCustomError))

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{defaultValues?.id ? 'Editar contrato' : 'Novo contrato'}</DialogTitle>
      <DialogContent dividers>
        {customError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {customError}
          </Alert>
        )}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} md={6}>
            <TextField select fullWidth label="Cliente" defaultValue={defaultValues?.client_id ?? ''} {...register('client_id')} error={!!errors.client_id} helperText={errors.client_id?.message}>
              <MenuItem value="">Selecione…</MenuItem>
              {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              select
              fullWidth
              label="Tipo de cobrança"
              defaultValue={defaultValues?.billing_mode ?? 'monthly'}
              {...register('billing_mode')}
              error={!!errors.billing_mode}
              helperText={errors.billing_mode?.message || 'Geral, semanal ou datas personalizadas'}
            >
              {BILLING_MODE_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              select
              fullWidth
              label="Tipo de contrato"
              defaultValue={defaultValues?.contract_type_id ?? ''}
              {...register('contract_type_id')}
              error={!!errors.contract_type_id}
              helperText={errors.contract_type_id?.message || (restrictToNoAdjustment ? 'Somente tipos sem reajuste padrao.' : '')}
            >
              <MenuItem value="">Selecione…</MenuItem>
              {availableContractTypes.map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  {type.name}{type.is_recurring ? ` (+${Number(type.adjustment_percent).toFixed(2)}%/ano)` : ''}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          {billingMode === 'monthly' && (
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
          )}
          <Grid item xs={12}>
            <TextField fullWidth label="Descrição" {...register('description')} error={!!errors.description} helperText={errors.description?.message} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Valor (R$)" type="number" inputProps={{ step: '0.01' }} {...register('value')} error={!!errors.value} helperText={errors.value?.message} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Início"
              type="date"
              InputLabelProps={{ shrink: true }}
              {...register('start_date')}
              error={!!errors.start_date}
              helperText={billingMode === 'custom_dates' ? 'Gerado pelas datas personalizadas' : errors.start_date?.message}
              disabled={billingMode === 'custom_dates'}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Fim"
              type="date"
              InputLabelProps={{ shrink: true }}
              {...register('end_date')}
              error={!!errors.end_date}
              helperText={billingMode === 'custom_dates' ? 'Gerado pelas datas personalizadas' : errors.end_date?.message}
              disabled={billingMode === 'custom_dates'}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Dia de cobrança" type="number" inputProps={{ min:1, max:31 }} {...register('billing_day')} error={!!errors.billing_day} helperText={errors.billing_day?.message} disabled={billingMode !== 'monthly'} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Cancelado em" type="date" InputLabelProps={{ shrink: true }} {...register('cancellation_date')} error={!!errors.cancellation_date} helperText={errors.cancellation_date?.message || 'Preencha apenas se o contrato foi encerrado.'} />
          </Grid>
          {billingMode === 'custom_dates' && (
            <Grid item xs={12}>
              <Stack spacing={1}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="subtitle2">Datas personalizadas</Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={addCustomBilling} disabled={!canEditCustomDates}>Adicionar data</Button>
                </Stack>
                {!hasContractValue && (
                  <Alert severity="info">
                    Preencha o valor do contrato para liberar as datas personalizadas.
                  </Alert>
                )}
                {customWarning && (
                  <Alert severity="warning">
                    {customWarning}
                  </Alert>
                )}
                {hasContractValue && customTotals && (
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                    <Typography variant="body2">
                      Total das datas: {formatCurrency(customTotals.total)} de {formatCurrency(contractValue)}
                    </Typography>
                    <Typography variant="body2" color={customTotals.remaining >= 0 ? 'text.secondary' : 'error'}>
                      {customTotals.remaining >= 0 ? 'Falta' : 'Excedente'} {formatCurrency(Math.abs(customTotals.remaining))}
                    </Typography>
                  </Stack>
                )}
                {customBillings.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Adicione ao menos uma data personalizada.
                  </Typography>
                )}
                {customBillings.map((item, idx) => (
                  <Grid container spacing={2} alignItems="center" key={`${item.billing_date || 'new'}-${idx}`}>
                    <Grid item xs={12} md={3}>
                      <TextField
                        fullWidth
                        label="Data"
                        type="date"
                        value={item.billing_date || ''}
                        onChange={(e) => updateCustomBilling(idx, { billing_date: e.target.value })}
                        InputLabelProps={{ shrink: true }}
                        disabled={!canEditCustomDates}
                      />
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <TextField
                        fullWidth
                        label="Valor (R$)"
                        type="number"
                        inputProps={{ step: '0.01' }}
                        value={item.amount ?? ''}
                        onChange={(e) => handleCustomAmountChange(idx, e.target.value)}
                        disabled={!canEditCustomDates}
                      />
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <TextField
                        fullWidth
                        label="Percentual (%)"
                        type="number"
                        inputProps={{ step: '0.01' }}
                        value={item.percentage ?? ''}
                        onChange={(e) => handleCustomPercentageChange(idx, e.target.value)}
                        disabled={!canEditCustomDates}
                      />
                    </Grid>
                    <Grid item xs={12} md={3} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                      <IconButton aria-label="Remover" onClick={() => removeCustomBilling(idx)} disabled={!canEditCustomDates}>
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Grid>
                  </Grid>
                ))}
              </Stack>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={isSubmitting} onClick={submitForm}>
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
  const onSubmit = async (form, customBillings = [], setCustomError) => {
    try {
      if (setCustomError) setCustomError(null)
      const mode = String(form.billing_mode || 'monthly').toLowerCase()
      let customPayload = null
      if (mode === 'custom_dates') {
        const contractValueInput = parseNumberInput(form.value)
        if (!Number.isFinite(contractValueInput) || contractValueInput <= 0) {
          if (setCustomError) setCustomError('Informe o valor do contrato para usar datas personalizadas.')
          return
        }
        const normalized = (customBillings || [])
          .map((item) => ({
            billing_date: toDateInput(item.billing_date),
            amount: item.amount !== '' && item.amount != null ? Number(item.amount) : null,
            percentage: item.percentage !== '' && item.percentage != null ? Number(item.percentage) : null,
          }))
          .filter((item) => item.billing_date)

        if (!normalized.length) {
          if (setCustomError) setCustomError('Informe ao menos uma data personalizada.')
          return
        }
        const dateSet = new Set()
        for (const item of normalized) {
          if (!item.billing_date) {
            if (setCustomError) setCustomError('Todas as datas personalizadas devem ter data.')
            return
          }
          if (dateSet.has(item.billing_date)) {
            if (setCustomError) setCustomError('Existem datas personalizadas duplicadas.')
            return
          }
          dateSet.add(item.billing_date)
          const amountOk = item.amount != null && Number(item.amount) > 0
          const percOk = item.percentage != null && Number(item.percentage) > 0
          if (!amountOk && !percOk) {
            if (setCustomError) setCustomError('Informe valor ou percentual maior que zero.')
            return
          }
        }
        const datesSorted = normalized.map((item) => item.billing_date).sort()
        form.start_date = datesSorted[0]
        form.end_date = datesSorted[datesSorted.length - 1]
        form.billing_day = 1
        form.billing_interval_months = 1
        customPayload = normalized
      }

      const payload = normalizePayloadDates(form)
      let contractId = editing?.id
      if (editing?.id) {
        await update.mutateAsync({ id: editing.id, payload })
      } else {
        const created = await create.mutateAsync(payload)
        contractId = created?.id
      }
      if (customPayload && contractId) {
        await contractsService.setCustomBillings(contractId, customPayload)
      }
      setDialogOpen(false)
    } catch (err) {
      showError(err)
    }
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
                  <TableCell>{formatBillingMode(r.billing_mode, r.billing_interval_months, r.billing_interval_days)}</TableCell>
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
        defaultValues={editing || { client_id:'', contract_type_id:'', description:'', value:0, start_date:'', end_date:'', billing_mode:'monthly', billing_day:1, billing_interval_months:1, billing_interval_days:7, cancellation_date:'' }}
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
