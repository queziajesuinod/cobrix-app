import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, MenuItem, Skeleton, Snackbar, TextField } from '@mui/material'
import AssignmentIcon from '@mui/icons-material/Assignment'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { contractsService } from './contracts.service'
import { contractTypesService } from './contractTypes.service'
import { tasksService } from '@/features/tasks/tasks.service'
import { ContractDialog, normalizePayloadDates, parseNumberInput, toDateInput } from './ContractsPage'

const NEW_DEFAULTS = {
  client_id: '', contract_type_id: '', description: '', value: 0,
  start_date: '', end_date: '', billing_mode: 'monthly', billing_day: 1,
  billing_interval_months: 1, billing_interval_days: 7, cancellation_date: '',
}

export default function ContractFormPage() {
  const { id } = useParams()
  const editing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { selectedCompanyId } = useAuth()
  const enabled = Number.isInteger(selectedCompanyId)
  const [errorToast, setErrorToast] = useState(null)
  const [taskModelId, setTaskModelId] = useState('')
  const showError = (e) => setErrorToast(e?.response?.data?.error || e?.message || 'Falha na operação')

  // Modelos de tarefa disponíveis (para gerar a tarefa ao criar o contrato).
  const modelsQ = useQuery({
    queryKey: ['task-models-select', selectedCompanyId],
    queryFn: () => tasksService.modelsSelect(),
    enabled: enabled && !editing,
    retry: false,
  })
  const taskModels = modelsQ.data?.items || []

  const typesQ = useQuery({
    queryKey: ['contract_types', selectedCompanyId],
    queryFn: () => contractTypesService.list(selectedCompanyId),
    enabled,
    retry: false,
  })
  const contractQ = useQuery({
    queryKey: ['contract', id],
    queryFn: () => contractsService.get(id),
    enabled: editing && enabled,
  })

  const create = useMutation({ mutationFn: contractsService.create })
  const update = useMutation({ mutationFn: ({ id: cid, payload }) => contractsService.update(cid, payload) })

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
      if (!editing && taskModelId) payload.task_model_id = Number(taskModelId)
      let contractId = editing ? Number(id) : undefined
      if (editing) {
        await update.mutateAsync({ id, payload })
      } else {
        const created = await create.mutateAsync(payload)
        contractId = created?.id
      }
      if (customPayload && contractId) {
        await contractsService.setCustomBillings(contractId, customPayload)
      }
      qc.invalidateQueries({ queryKey: ['contracts-paginated'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
      navigate('/contracts')
    } catch (err) {
      showError(err)
    }
  }

  const loading = editing && contractQ.isLoading

  return (
    <>
      <PageHeader title={editing ? 'Editar contrato' : 'Novo contrato'} subtitle="Cadastro de contrato" />
      <CompanyRequiredAlert />

      <PapperBlock title="Dados do contrato" icon={<AssignmentIcon />} iconColor="primary.main">
        {loading ? (
          <Skeleton variant="rounded" height={360} />
        ) : editing && contractQ.isError ? (
          <Alert severity="error">Não foi possível carregar o contrato.</Alert>
        ) : (
          <>
            {!editing && taskModels.length > 0 && (
              <Box sx={{ mb: 2, maxWidth: 460 }}>
                <TextField
                  select fullWidth label="Modelo de tarefa (opcional)"
                  value={taskModelId} onChange={(e) => setTaskModelId(e.target.value)}
                  helperText="Ao salvar, gera uma tarefa no quadro da equipe do modelo. Deixe em branco para não gerar."
                >
                  <MenuItem value=""><em>Nenhum</em></MenuItem>
                  {taskModels.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}{m.team_name ? ` · ${m.team_name}` : ''}</MenuItem>)}
                </TextField>
              </Box>
            )}
            <ContractDialog
              inline
              open
              defaultValues={editing ? contractQ.data : NEW_DEFAULTS}
              contractTypes={typesQ.data || []}
              onSubmit={onSubmit}
              onClose={() => navigate('/contracts')}
            />
          </>
        )}
      </PapperBlock>

      <Snackbar open={!!errorToast} autoHideDuration={5000} onClose={() => setErrorToast(null)}>
        <Alert severity="error" variant="filled" onClose={() => setErrorToast(null)}>{errorToast}</Alert>
      </Snackbar>
    </>
  )
}
