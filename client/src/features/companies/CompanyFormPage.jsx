import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Card, CardContent, Typography } from '@mui/material'
import { companyService } from './company.service'
import CompanyDataForm from './CompanyDataForm'

export default function CompanyFormPage(){
  const nav = useNavigate()
  const createM = useMutation({
    mutationFn: (payload)=>companyService.create(payload),
    onSuccess: (data)=> nav(`/companies/${data.id}/settings`)
  })

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Nova empresa</Typography>
        <CompanyDataForm
          defaultValues={{ name: '' }}
          submitting={createM.isPending}
          onSubmit={(p)=>createM.mutate(p)}
        />
      </CardContent>
    </Card>
  )
}
