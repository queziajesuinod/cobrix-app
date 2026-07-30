import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import BusinessIcon from '@mui/icons-material/Business'
import PapperBlock from '@/components/PapperBlock'
import { companyService } from './company.service'
import CompanyDataForm from './CompanyDataForm'

export default function CompanyFormPage(){
  const nav = useNavigate()
  const createM = useMutation({
    mutationFn: (payload)=>companyService.create(payload),
    onSuccess: (data)=> nav(`/companies/${data.id}/settings`)
  })

  return (
    <PapperBlock title="Dados da empresa" icon={<BusinessIcon/>} iconColor="primary.main">
      <CompanyDataForm
        defaultValues={{ name: '' }}
        submitting={createM.isPending}
        onSubmit={(p)=>createM.mutate(p)}
      />
    </PapperBlock>
  )
}
