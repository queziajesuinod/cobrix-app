import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Skeleton, Snackbar } from '@mui/material'
import PeopleIcon from '@mui/icons-material/People'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { clientsService } from './clients.service'
import ClientForm, { digitsOnly } from './ClientForm'

export default function ClientFormPage() {
  const { id } = useParams()
  const editing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { selectedCompanyId } = useAuth()
  const enabled = Number.isInteger(selectedCompanyId)
  const [errorToast, setErrorToast] = useState(null)

  const clientQ = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsService.get(id),
    enabled: editing && enabled,
  })

  const save = useMutation({
    mutationFn: (payload) => (editing ? clientsService.update(id, payload) : clientsService.create(payload)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients-paginated'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      navigate('/clients')
    },
    onError: (e) => setErrorToast(e?.response?.data?.error || e?.message || 'Falha ao salvar o cliente'),
  })

  const onSubmit = (form) => {
    const payload = {
      ...form,
      document: (() => {
        const d = digitsOnly(form.document || '').slice(0, 14)
        return d || null
      })(),
      phone: (() => {
        const d = digitsOnly(form.phone || '').slice(0, 11)
        return d || null
      })(),
    }
    save.mutate(payload)
  }

  return (
    <>
      <PageHeader title={editing ? 'Editar cliente' : 'Novo cliente'} subtitle="Cadastro de cliente" />
      <CompanyRequiredAlert />

      <PapperBlock title="Dados do cliente" icon={<PeopleIcon />} iconColor="primary.main">
        {editing && clientQ.isLoading ? (
          <Skeleton variant="rounded" height={280} />
        ) : editing && clientQ.isError ? (
          <Alert severity="error">Não foi possível carregar o cliente.</Alert>
        ) : (
          <ClientForm
            defaultValues={editing ? clientQ.data : null}
            onSubmit={onSubmit}
            onCancel={() => navigate('/clients')}
            submitting={save.isPending}
          />
        )}
      </PapperBlock>

      <Snackbar open={!!errorToast} autoHideDuration={4000} onClose={() => setErrorToast(null)}>
        <Alert severity="error" variant="filled" onClose={() => setErrorToast(null)}>{errorToast}</Alert>
      </Snackbar>
    </>
  )
}
