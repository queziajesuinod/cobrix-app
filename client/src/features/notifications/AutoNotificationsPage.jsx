import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { billingsService } from '@/features/billings/billings.service'
import { clientsService } from '@/features/clients/clients.service'
import { contractsService } from '@/features/contracts/contracts.service'
import PageHeader from '@/components/PageHeader'
import KpiCards from '@/features/billings/KpiCards'
import BillingsOverviewPanel from '@/features/billings/BillingsOverviewPanel'
import BillingsRunDialog from '@/features/billings/BillingsRunDialog'
import { Card, CardContent, Grid, MenuItem, Stack, TextField, Typography, Snackbar, Button } from '@mui/material'
import AutorenewIcon from '@mui/icons-material/Autorenew'

export default function AutoNotificationsPage(){
  const qc = useQueryClient()
  const [ym, setYm] = useState(() => new Date().toISOString().slice(0,7))
  const [clientId, setClientId] = useState('')
  const [contractId, setContractId] = useState('')
  const [snack, setSnack] = useState(null)
  const [runOpen, setRunOpen] = useState(false)

  const clientsQ = useQuery({ queryKey:['clients'], queryFn: clientsService.list })
  const contractsQ = useQuery({ queryKey:['contracts'], queryFn: contractsService.list })

  const filteredContracts = useMemo(() => {
    const all = contractsQ.data || []
    if (!clientId) return all
    return all.filter(c => Number(c.client_id) === Number(clientId))
  }, [contractsQ.data, clientId])

  useEffect(() => {
    if (!contractId) return
    const exists = filteredContracts.some(c => Number(c.id) === Number(contractId))
    if (!exists) setContractId('')
  }, [filteredContracts, contractId])

  const kpisQ = useQuery({ queryKey:['kpis', ym, clientId, contractId], queryFn: () => billingsService.kpis(ym, { clientId: clientId || undefined, contractId: contractId || undefined }) })
  const run = useMutation({ mutationFn: billingsService.checkRun, onSuccess: () => { qc.invalidateQueries({ queryKey:['overview'] }); qc.invalidateQueries({ queryKey:['kpis'] }); } })

  const onRunConfirm = async (payload) => {
    try {
      await run.mutateAsync(payload)
      setSnack(`Rotina executada para ${payload?.date || new Date().toISOString().slice(0,10)}`)
    } catch (e) {
      setSnack(e?.response?.data?.error || 'Falha ao executar rotina')
    } finally {
      setRunOpen(false)
    }
  }

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Notificações automáticas"
        subtitle="Controle de D−3, D0 e D+4. Marque o mês PAGO para bloquear os próximos lembretes."
        actions={<Button variant="outlined" startIcon={<AutorenewIcon/>} onClick={()=>setRunOpen(true)}>Executar por data</Button>}
      />

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <TextField label="Mês" type="month" value={ym} onChange={(e)=>setYm(e.target.value)} fullWidth InputLabelProps={{shrink:true}} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  select
                  label="Cliente"
                  value={clientId}
                  onChange={(e)=>setClientId(e.target.value)}
                  fullWidth
                  SelectProps={{ displayEmpty: true }}
                >
                  <MenuItem value="">
                    <em>Todos os clientes</em>
                  </MenuItem>
                  {(clientsQ.data||[]).map(c => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} md={5}>
                <TextField
                  select
                  label="Contrato"
                  value={contractId}
                  onChange={(e)=>setContractId(e.target.value)}
                  fullWidth
                  SelectProps={{ displayEmpty: true }}
                >
                  <MenuItem value="">
                    <em>{clientId ? 'Todos os contratos do cliente' : 'Todos os contratos'}</em>
                  </MenuItem>
                  {filteredContracts.map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      #{c.id} · {c.description}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
            {(clientId || contractId) && (
              <Stack direction="row" justifyContent="flex-end">
                <Button size="small" onClick={() => { setClientId(''); setContractId(''); }}>
                  Limpar filtros
                </Button>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card><CardContent>
        {kpisQ.isLoading ? 'Carregando KPIs…' : <KpiCards k={kpisQ.data || {}} />}
      </CardContent></Card>

      <Card><CardContent>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>Resumo por contrato</Typography>
        <BillingsOverviewPanel ym={ym} clientId={clientId} contractId={contractId} />
      </CardContent></Card>

      <BillingsRunDialog open={runOpen} onClose={()=>setRunOpen(false)} onConfirm={onRunConfirm} />
      <Snackbar open={!!snack} autoHideDuration={2500} onClose={()=>setSnack(null)} message={snack||''} />
    </Stack>
  )
}
