import React from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Box, Tabs, Tab, Card, CardContent, Snackbar, Alert } from '@mui/material'
import { companyService } from './company.service'
import CompanyDataForm from './CompanyDataForm'
import CompanyEvoIntegrationForm from './CompanyEvoIntegrationForm'
import CompanyUsersPanel from './CompanyUsersPanel'
import { companyIntegrationService } from './company.integration.service'

export default function CompanySettingsPage(){
  const { id } = useParams()
  const qc = useQueryClient()
  const [tab, setTab] = React.useState(0)
  const [toast, setToast] = React.useState(null)

  const qCompany = useQuery({ queryKey: ['company', id], queryFn: ()=>companyService.get(id), enabled: !!id })
  const mUpdate = useMutation({ mutationFn: (payload)=>companyService.update(id, payload), onSuccess: ()=>{ qc.invalidateQueries({queryKey:['company', id]}); setToast({severity:'success', msg:'Empresa atualizada.'}) } })

  // EVO integration
  const qEvo = useQuery({ queryKey: ['company_evo', id], queryFn: ()=>companyIntegrationService.getEvo(id), enabled: !!id })
  const mEvo = useMutation({
    mutationFn: (payload)=>companyIntegrationService.updateEvo(id, payload),
    onSuccess: ()=>{ qc.invalidateQueries({queryKey:['company_evo', id]}); setToast({severity:'success', msg:'Integração salva.'}) }
  })
  const mEvoTest = useMutation({
    mutationFn: (payload)=>companyIntegrationService.testEvo(id, payload),
    onSuccess: (data)=> setToast({severity:'success', msg:`Teste enviado. Status ${data?.provider?.status||'-'}` }),
    onError: (e)=> setToast({severity:'error', msg: e?.response?.data?.error || e.message})
  })

  return (
    <Box>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Tabs value={tab} onChange={(_,v)=>setTab(v)}>
            <Tab label="Dados" />
            <Tab label="Integração" />
            <Tab label="Usuários" />
          </Tabs>
        </CardContent>
      </Card>

      {tab===0 && (
        <Card variant="outlined">
          <CardContent>
            <CompanyDataForm
              defaultValues={qCompany.data}
              submitting={mUpdate.isPending}
              onSubmit={(payload)=>mUpdate.mutate(payload)}
            />
          </CardContent>
        </Card>
      )}

      {tab===1 && (
        <Card variant="outlined">
          <CardContent>
            <CompanyEvoIntegrationForm
              defaultValues={qEvo.data}
              submitting={mEvo.isPending}
              onSubmit={(payload)=>mEvo.mutate(payload)}
              onTest={(payload)=>mEvoTest.mutate(payload)}
            />
          </CardContent>
        </Card>
      )}

      {tab===2 && (
        <CompanyUsersPanel companyId={Number(id)} />
      )}

      <Snackbar open={!!toast} autoHideDuration={3000} onClose={()=>setToast(null)}>
        {toast && <Alert severity={toast.severity}>{toast.msg}</Alert>}
      </Snackbar>
    </Box>
  )
}
