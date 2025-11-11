import React, { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { clientsService } from '@/features/clients/clients.service'
import { contractsService } from '@/features/contracts/contracts.service'
import { billingsService } from '@/features/billings/billings.service'
import PageHeader from '@/components/PageHeader'
import { Button, Card, CardContent, Grid, MenuItem, Select, Snackbar, Stack, TextField, Typography } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'

function pad2(n){ return String(n).padStart(2,'0') }
function effectiveBillingDay(y, m, billingDay){
  const last = new Date(y, m, 0).getDate()
  return Math.min(Number(billingDay), last)
}

export default function ManualNotificationsPage(){
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [ym, setYm] = useState(() => new Date().toISOString().slice(0,7))
  const [clientId, setClientId] = useState('')
  const [contractId, setContractId] = useState('')
  const [dueDateFilter, setDueDateFilter] = useState('')
  const [snack, setSnack] = useState(null)

  const clientsQ = useQuery({ queryKey:['clients'], queryFn: clientsService.list })
  const contractsQ = useQuery({ queryKey:['contracts'], queryFn: contractsService.list })

  const y = Number(ym.split('-')[0]); const m = Number(ym.split('-')[1])

  const contracts = useMemo(() => {
    const all = contractsQ.data || []
    return all.filter(c => {
      const startOk = new Date(c.start_date) <= new Date(y, m, 1)
      const endOk = new Date(c.end_date) >= new Date(y, m, 1)
      const clientOk = clientId ? c.client_id === Number(clientId) : true
      const contractOk = contractId ? c.id === Number(contractId) : true
      if (!(startOk && endOk && clientOk && contractOk)) return false
      if (!dueDateFilter) return true
      const dueDay = effectiveBillingDay(y, m, c.billing_day)
      const dueIso = new Date(y, m - 1, dueDay).toISOString().slice(0,10)
      return dueIso === dueDateFilter
    })
  }, [contractsQ.data, ym, clientId, contractId, dueDateFilter])

  const notify = useMutation({ mutationFn: billingsService.notifyManual, onSuccess: () => setSnack('Notificação enviada') })

  const send = async (c, type) => {
    const dueDay = effectiveBillingDay(y, m, c.billing_day)
    const ref = new Date(y, m-1, dueDay)
    let date = ref.toISOString().slice(0,10)
    if (type === 'pre') {
      const d = new Date(ref); d.setDate(d.getDate()-3); date = d.toISOString().slice(0,10)
    } else if (type === 'late') {
      const d = new Date(ref); d.setDate(d.getDate()+4); date = d.toISOString().slice(0,10)
    }
    try {
      await notify.mutateAsync({ contract_id: c.id, type, date })
    } catch (e) {
      setSnack(e?.response?.data?.error || 'Falha ao enviar')
    }
  }

  return (
    <Stack spacing={2}>
      <PageHeader title="Notificações manuais" subtitle="Use esta tela apenas se o automático falhar. Você pode disparar PRE/D0/D+4 por contrato." />

      <Card><CardContent>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField label="Mês" type="month" value={ym} onChange={(e)=>setYm(e.target.value)} fullWidth InputLabelProps={{shrink:true}} />
          </Grid>
          <Grid item xs={12} md={3}>
            <Select fullWidth displayEmpty value={clientId} onChange={(e)=>setClientId(e.target.value)}>
              <MenuItem value=""><em>Todos os clientes</em></MenuItem>
              {(clientsQ.data||[]).map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </Grid>
          <Grid item xs={12} md={4}>
            <Select fullWidth displayEmpty value={contractId} onChange={(e)=>setContractId(e.target.value)}>
              <MenuItem value=""><em>Todos os contratos</em></MenuItem>
              {(contractsQ.data||[]).map(c => {
                const client = clientsQ.data?.find(cl => cl.id === c.client_id)
                const clientLabel = client?.responsavel ? `${client.responsavel} (${client.name})` : (client?.name || `#${c.client_id}`)
                return <MenuItem key={c.id} value={c.id}>#{c.id} · {c.description} — {clientLabel}</MenuItem>
              })}
            </Select>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              label="Data de vencimento"
              type="date"
              value={dueDateFilter}
              onChange={(e)=>setDueDateFilter(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
        </Grid>
      </CardContent></Card>

      {contracts.map(c => {
        const dueDay = effectiveBillingDay(y, m, c.billing_day)
        const dueStr = `${pad2(dueDay)}/${pad2(m)}/${y}`
        const dueDate = new Date(y, m - 1, dueDay);
        dueDate.setHours(0, 0, 0, 0);

        const preDueDate = new Date(y, m - 1, dueDay - 3);
        preDueDate.setHours(0, 0, 0, 0);

        const lateDueDate = new Date(y, m - 1, dueDay + 4);
        lateDueDate.setHours(0, 0, 0, 0);

        const client = clientsQ.data?.find(cl => cl.id === c.client_id)
        const displayName = client?.responsavel || client?.name || `cliente #${c.client_id}`
        const clientLegalName = client?.name && client?.responsavel ? ` • ${client.name}` : ''
        return (
          <Card key={c.id} variant="outlined">
            <CardContent>
              <Grid container spacing={1} alignItems="center">
                <Grid item xs={12} md={8}>
                  <Typography variant="subtitle1" sx={{fontWeight:700}}>
                    Contrato #{c.id} · {c.description} — {displayName}{clientLegalName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Vencimento: {dueStr} — Valor: R$ {Number(c.value).toFixed(2)}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={4} sx={{ textAlign: { xs:'left', md:'right' } }}>
                  <Stack direction="row" spacing={1} justifyContent={{ xs:'flex-start', md:'flex-end' }}>
                    {/* Botão D-3 (Pré-vencimento) */}
                    {today.getTime() < dueDate.getTime() && (
                      <Button size="small" variant="outlined" startIcon={<SendIcon />} onClick={() => send(c, 'pre')}>Enviar D−3</Button>
                    )}

                    {/* Botão D0 (Vencimento) */}
                    {today.getTime() === dueDate.getTime() && (
                      <Button size="small" variant="contained" startIcon={<SendIcon />} onClick={() => send(c, 'due')}>Enviar D0</Button>
                    )}

                    {/* Botão D+4 (Atrasado) */}
                    {today.getTime() > dueDate.getTime() && (
                      <Button size="small" variant="outlined" color="error" startIcon={<SendIcon />} onClick={() => send(c, 'late')} disabled={today.getTime() < lateDueDate.getTime()}>Enviar D+4</Button>
                    )}
                  </Stack>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )
      })}

      {!contracts.length && <Typography variant="body2">Nenhum contrato para o filtro atual.</Typography>}
      <Snackbar open={!!notify.error || !!snack} autoHideDuration={2500} onClose={()=>setSnack(null)} message={notify.error?.response?.data?.error || snack || ''} />
    </Stack>
  )
}
