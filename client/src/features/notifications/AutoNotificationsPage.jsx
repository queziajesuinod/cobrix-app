import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { billingsService } from '@/features/billings/billings.service'
import { clientsService } from '@/features/clients/clients.service'
import { contractsService } from '@/features/contracts/contracts.service'
import PageHeader from '@/components/PageHeader'
import KpiCards from '@/features/billings/KpiCards'
import BillingsOverviewPanel from '@/features/billings/BillingsOverviewPanel'
import BillingsRunDialog from '@/features/billings/BillingsRunDialog'
import { Card, CardContent, Grid, MenuItem, Select, Stack, TextField, Typography, Snackbar, Button } from '@mui/material'
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

      <Card><CardContent>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField label="Mês" type="month" value={ym} onChange={(e)=>setYm(e.target.value)} fullWidth InputLabelProps={{shrink:true}} />
          </Grid>
          <Grid item xs={12} md={4}>
            <Select fullWidth displayEmpty value={clientId} onChange={(e)=>setClientId(e.target.value)}>
              <MenuItem value=""><em>Todos os clientes</em></MenuItem>
              {(clientsQ.data||[]).map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </Grid>
          <Grid item xs={12} md={5}>
            <Select fullWidth displayEmpty value={contractId} onChange={(e)=>setContractId(e.target.value)}>
              <MenuItem value=""><em>Todos os contratos</em></MenuItem>
              {(contractsQ.data||[]).map(c => <MenuItem key={c.id} value={c.id}>#{c.id} · {c.description}</MenuItem>)}
            </Select>
          </Grid>
        </Grid>
      </CardContent></Card>

      <Card><CardContent>
        {kpisQ.isLoading ? 'Carregando KPIs…' : <KpiCards k={kpisQ.data || {}} />}
      </CardContent></Card>

      <Card><CardContent>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>Resumo por contrato</Typography>
        <BillingsOverviewPanel ym={ym} />
      </CardContent></Card>

      <BillingsRunDialog open={runOpen} onClose={()=>setRunOpen(false)} onConfirm={onRunConfirm} />
      <Snackbar open={!!snack} autoHideDuration={2500} onClose={()=>setSnack(null)} message={snack||''} />
    </Stack>
  )
}
