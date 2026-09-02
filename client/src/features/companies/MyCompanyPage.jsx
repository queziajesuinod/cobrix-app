import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Snackbar, Alert, Stack, CircularProgress } from '@mui/material'
import BusinessIcon from '@mui/icons-material/Business'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { companyService } from './company.service'
import CompanyDataForm from './CompanyDataForm'

// Autoatendimento: qualquer admin ajusta os dados da PRÓPRIA empresa (a selecionada)
// — nome, CPF/CNPJ, PIX e gateway de recebimento. Antes só o master tinha essa tela.
// Sem `plans` → o CompanyDataForm esconde os campos exclusivos do master (plano,
// dona do SaaS, parceiro, override).
export default function MyCompanyPage() {
  const qc = useQueryClient()
  const { selectedCompanyId } = useAuth()
  const [toast, setToast] = React.useState(null)

  const companyQ = useQuery({
    queryKey: ['company', String(selectedCompanyId)],
    queryFn: () => companyService.get(selectedCompanyId),
    enabled: Boolean(selectedCompanyId),
  })

  const saveM = useMutation({
    mutationFn: (payload) => companyService.update(selectedCompanyId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', String(selectedCompanyId)] })
      setToast({ severity: 'success', msg: 'Dados da empresa atualizados.' })
    },
    onError: (err) => setToast({ severity: 'error', msg: err?.response?.data?.error || 'Falha ao salvar.' }),
  })

  if (!selectedCompanyId) return <CompanyRequiredAlert />

  return (
    <>
      <PageHeader title="Minha empresa" subtitle="Dados de identificação e de recebimento usados nas suas cobranças." />
      <PapperBlock title="Dados da empresa" icon={<BusinessIcon />} iconColor="primary.main">
        {companyQ.isLoading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress /></Stack>
        ) : (
          <CompanyDataForm
            defaultValues={companyQ.data}
            submitting={saveM.isPending}
            onSubmit={(payload) => saveM.mutate(payload)}
          />
        )}
      </PapperBlock>
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)}>
        {toast && <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert>}
      </Snackbar>
    </>
  )
}
