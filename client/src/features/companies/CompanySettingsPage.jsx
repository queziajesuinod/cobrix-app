import React from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Box, Tabs, Tab, Card, CardContent, Snackbar, Alert, Stack, Typography, Button } from '@mui/material'
import { companyService } from './company.service'
import CompanyDataForm from './CompanyDataForm'
import CompanyUsersPanel from './CompanyUsersPanel'
import { companyIntegrationService } from './company.integration.service'
import RefreshIcon from '@mui/icons-material/Refresh'
import QrCodeIcon from '@mui/icons-material/QrCode'
import { useNavigate } from 'react-router-dom'

export default function CompanySettingsPage(){
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = React.useState(0)
  const [toast, setToast] = React.useState(null)

  const qCompany = useQuery({ queryKey: ['company', id], queryFn: ()=>companyService.get(id), enabled: !!id })
  const mUpdate = useMutation({ mutationFn: (payload)=>companyService.update(id, payload), onSuccess: ()=>{ qc.invalidateQueries({queryKey:['company', id]}); setToast({severity:'success', msg:'Empresa atualizada.'}) } })

  // EVO integration status
  const qEvo = useQuery({ queryKey: ['company_evo_status', id], queryFn: ()=>companyIntegrationService.getEvoStatus(id), enabled: !!id })

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
            <Stack spacing={2}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>Status da integração WhatsApp</Typography>
              {qEvo.isLoading ? (
                <Typography variant="body2">Consultando status…</Typography>
              ) : qEvo.error ? (
                <Alert severity="error">Falha ao obter status: {qEvo.error?.response?.data?.error || qEvo.error?.message}</Alert>
              ) : (
                <Stack spacing={1}>
                  <Typography variant="body2">
                    Instância: <strong>{qEvo.data?.instance || '—'}</strong>
                  </Typography>
                  <Typography variant="body2">
                    Conexão: <strong>{(qEvo.data?.connectionStatus || 'desconhecida').toUpperCase()}</strong>
                  </Typography>
                  <Alert severity={qEvo.data?.connectionStatus === 'open' ? 'success' : 'warning'}>
                    {qEvo.data?.connectionStatus === 'open'
                      ? 'Instância conectada. Nenhuma ação necessária.'
                      : 'Instância desconectada. Utilize a página de conexão para escanear o QR Code.'}
                  </Alert>
                </Stack>
              )}
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={()=>qEvo.refetch()}
                  disabled={qEvo.isLoading}
                >
                  Atualizar status
                </Button>
                <Button
                  variant="contained"
                  startIcon={<QrCodeIcon />}
                  onClick={()=>navigate('/integration/evo')}
                >
                  Gerenciar conexão
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                A conexão pode ser gerenciada por qualquer usuário em <strong>Integração &gt; WhatsApp</strong>.
              </Typography>
            </Stack>
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
