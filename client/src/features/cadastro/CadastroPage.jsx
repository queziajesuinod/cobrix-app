import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, Snackbar, Stack, Tab, Tabs, Typography } from '@mui/material'
import PeopleIcon from '@mui/icons-material/People'
import AssignmentIcon from '@mui/icons-material/Assignment'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import ClientAutocomplete from '@/components/ClientAutocomplete'
import { useAuth } from '@/features/auth/AuthContext'
import { clientsService } from '@/features/clients/clients.service'
import ClientForm, { digitsOnly } from '@/features/clients/ClientForm'
import { contractsService } from '@/features/contracts/contracts.service'
import { contractTypesService } from '@/features/contracts/contractTypes.service'
import { ContractDialog, normalizePayloadDates, parseNumberInput, toDateInput } from '@/features/contracts/ContractsPage'

const NEW_CONTRACT = {
  client_id: '', contract_type_id: '', description: '', value: 0,
  start_date: '', end_date: '', billing_mode: 'monthly', billing_day: 1,
  billing_interval_months: 1, billing_interval_days: 7, cancellation_date: '',
}

export default function CadastroPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { selectedCompanyId } = useAuth()
  const enabled = Number.isInteger(selectedCompanyId)

  const [mode, setMode] = useState('new')        // 'new' | 'search'
  const [activeClient, setActiveClient] = useState(null) // { id, name }
  const [searchId, setSearchId] = useState('')
  const [showContract, setShowContract] = useState(false)
  const [contractSeq, setContractSeq] = useState(0)   // remonta o form a cada salvamento
  const [savedContracts, setSavedContracts] = useState(0)
  const [toast, setToast] = useState(null)
  const showError = (e) => setToast({ severity: 'error', msg: e?.response?.data?.error || e?.message || 'Falha na operação' })
  const showOk = (msg) => setToast({ severity: 'success', msg })

  const clientsQ = useQuery({ queryKey: ['clients'], queryFn: () => clientsService.list(), enabled: enabled && mode === 'search' })
  const typesQ = useQuery({ queryKey: ['contract_types', selectedCompanyId], queryFn: () => contractTypesService.list(selectedCompanyId), enabled, retry: false })

  // ---- Cliente ----
  const createClient = useMutation({
    mutationFn: (payload) => clientsService.create(payload),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['clients-paginated'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      setActiveClient({ id: created.id, name: created.name })
      showOk('Cliente cadastrado com sucesso.')
    },
    onError: showError,
  })

  const onSubmitClient = (form) => {
    const payload = {
      ...form,
      document: (() => { const d = digitsOnly(form.document || '').slice(0, 14); return d || null })(),
      phone: (() => { const d = digitsOnly(form.phone || '').slice(0, 11); return d || null })(),
    }
    createClient.mutate(payload)
  }

  const handlePickExisting = (id) => {
    setSearchId(id)
    if (!id) { setActiveClient(null); return }
    const c = (clientsQ.data || []).find((x) => Number(x.id) === Number(id))
    if (c) setActiveClient({ id: c.id, name: c.name })
  }

  const resetClient = () => { setActiveClient(null); setSearchId(''); setShowContract(false); setSavedContracts(0); setContractSeq(0) }

  // ---- Contrato ----
  const createContract = useMutation({ mutationFn: contractsService.create })

  const onSubmitContract = async (formRaw, customBillings = [], setCustomError) => {
    try {
      const form = { ...formRaw, client_id: activeClient.id } // cliente fixo
      if (setCustomError) setCustomError(null)
      const billMode = String(form.billing_mode || 'monthly').toLowerCase()
      let customPayload = null
      if (billMode === 'custom_dates') {
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
        if (!normalized.length) { if (setCustomError) setCustomError('Informe ao menos uma data personalizada.'); return }
        const dateSet = new Set()
        for (const item of normalized) {
          if (dateSet.has(item.billing_date)) { if (setCustomError) setCustomError('Existem datas personalizadas duplicadas.'); return }
          dateSet.add(item.billing_date)
          const amountOk = item.amount != null && Number(item.amount) > 0
          const percOk = item.percentage != null && Number(item.percentage) > 0
          if (!amountOk && !percOk) { if (setCustomError) setCustomError('Informe valor ou percentual maior que zero.'); return }
        }
        const datesSorted = normalized.map((item) => item.billing_date).sort()
        form.start_date = datesSorted[0]
        form.end_date = datesSorted[datesSorted.length - 1]
        form.billing_day = 1
        form.billing_interval_months = 1
        customPayload = normalized
      }

      const payload = normalizePayloadDates(form)
      const created = await createContract.mutateAsync(payload)
      if (customPayload && created?.id) {
        await contractsService.setCustomBillings(created.id, customPayload)
      }
      qc.invalidateQueries({ queryKey: ['contracts-paginated'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
      const n = savedContracts + 1
      setSavedContracts(n)
      showOk(`Contrato cadastrado (${n}) para ${activeClient.name}. Pode cadastrar outro.`)
      setContractSeq((s) => s + 1) // limpa o formulário para o próximo contrato
    } catch (err) {
      showError(err)
    }
  }

  return (
    <>
      <PageHeader title="Cadastro" subtitle="Cadastre ou selecione o cliente e, se desejar, um contrato." />
      <CompanyRequiredAlert />

      <Stack spacing={2}>
        <PapperBlock title="1 · Cliente" icon={<PeopleIcon />} iconColor="primary.main">
          {activeClient ? (
            <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Chip icon={<CheckCircleIcon />} color="success" label={`Cliente: ${activeClient.name}`} />
              <Button size="small" onClick={resetClient}>Trocar cliente</Button>
            </Stack>
          ) : (
            <>
              <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ mb: 2 }}>
                <Tab value="new" label="Cadastrar novo" />
                <Tab value="search" label="Buscar existente" />
              </Tabs>
              {mode === 'new' ? (
                <ClientForm
                  defaultValues={null}
                  onSubmit={onSubmitClient}
                  onCancel={() => navigate('/clients')}
                  submitting={createClient.isPending}
                />
              ) : (
                <Box sx={{ maxWidth: 480 }}>
                  <ClientAutocomplete
                    options={clientsQ.data || []}
                    value={searchId}
                    onChange={handlePickExisting}
                    label="Buscar cliente pelo nome"
                    placeholder="Digite o nome do cliente…"
                    fullWidth
                  />
                </Box>
              )}
            </>
          )}
        </PapperBlock>

        <PapperBlock title="2 · Contrato (opcional)" icon={<AssignmentIcon />} iconColor={activeClient ? 'primary.main' : '#9e9e9e'}>
          {!activeClient ? (
            <Alert severity="info">Cadastre ou selecione um cliente acima para habilitar o cadastro de contrato.</Alert>
          ) : !showContract ? (
            <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Deseja cadastrar um contrato para <b>{activeClient.name}</b>?
              </Typography>
              <Button variant="contained" onClick={() => setShowContract(true)}>Cadastrar contrato</Button>
            </Stack>
          ) : (
            <Stack spacing={2}>
              {savedContracts > 0 && (
                <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Chip icon={<CheckCircleIcon />} color="success" variant="outlined" label={`${savedContracts} contrato(s) cadastrado(s)`} />
                  <Box sx={{ flexGrow: 1 }} />
                  <Button size="small" variant="outlined" onClick={() => navigate('/contracts')}>Ver contratos</Button>
                  <Button size="small" onClick={resetClient}>Concluir / novo cliente</Button>
                </Stack>
              )}
              <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
                Cadastre quantos contratos quiser para <b>{activeClient.name}</b>: cada um é salvo na hora e o formulário é limpo para o próximo.
              </Alert>
              <ContractDialog
                key={contractSeq}
                inline
                open
                hideClient
                defaultValues={{ ...NEW_CONTRACT, client_id: activeClient.id }}
                contractTypes={typesQ.data || []}
                onSubmit={onSubmitContract}
                onClose={() => setShowContract(false)}
              />
            </Stack>
          )}
        </PapperBlock>
      </Stack>

      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)}>
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.msg}</Alert>
        ) : undefined}
      </Snackbar>
    </>
  )
}
