import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { companyService } from './company.service'

const BRL = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Seção/portal do PARCEIRO: define o preço de venda (mensal/anual) por plano. Os
// acessos/estrutura do plano são da empresa padrão (não editáveis aqui). Cada preço
// deve ser >= piso do plano (validado no backend). Salva plano a plano. Autossuficiente:
// busca planos + piso + meu preço do endpoint (não depende da rota de planos do master).
export default function PartnerPlanPrices({ companyId, resellerStatus = 'active' }) {
  const resellerLocked = resellerStatus === 'link_locked' || resellerStatus === 'network_seized'
  const qc = useQueryClient()
  const pricesQ = useQuery({
    queryKey: ['partner-prices', companyId],
    queryFn: () => companyService.partnerPrices(companyId),
    enabled: Boolean(companyId),
  })
  const plans = pricesQ.data?.plans || []

  // Edições locais por plano: { [planId]: { price_monthly, price_annual } }.
  const [edits, setEdits] = React.useState({})
  const [msg, setMsg] = React.useState(null)

  const valOf = (plan, field) => {
    const my = field === 'price_monthly' ? plan.my_price_monthly : plan.my_price_annual
    if (edits[plan.plan_id] && edits[plan.plan_id][field] !== undefined) return edits[plan.plan_id][field]
    return my == null ? '' : String(my)
  }
  const setVal = (planId, field, v) => setEdits((e) => ({ ...e, [planId]: { ...e[planId], [field]: v } }))

  const saveM = useMutation({
    mutationFn: ({ planId, price_monthly, price_annual }) =>
      companyService.savePartnerPrice(companyId, planId, { price_monthly, price_annual }),
    onSuccess: () => {
      setMsg({ type: 'success', text: 'Preço salvo.' })
      qc.invalidateQueries({ queryKey: ['partner-prices', companyId] })
    },
    onError: (err) => setMsg({ type: 'error', text: err?.response?.data?.error || 'Falha ao salvar preço.' }),
  })

  const handleSave = (plan) => {
    setMsg(null)
    const pm = valOf(plan, 'price_monthly')
    const pa = valOf(plan, 'price_annual')
    saveM.mutate({
      planId: plan.plan_id,
      price_monthly: pm === '' ? null : Number(String(pm).replace(',', '.')),
      price_annual: pa === '' ? null : Number(String(pa).replace(',', '.')),
    })
  }

  const referralLink = (typeof window !== 'undefined' && companyId)
    ? `${window.location.origin}/#/signup?parceiro=${companyId}`
    : ''

  if (!companyId) return null

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Link de indicação</Typography>
      {resellerLocked ? (
        <Alert severity="warning" sx={{ mb: 2.5, mt: 1 }}>
          Seu link de indicação está <strong>desativado</strong> enquanto a revenda estiver bloqueada por inadimplência.
          Regularize a comissão em aberto para reativá-lo.
        </Alert>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Quem se cadastrar por este link vira seu cliente: a assinatura é cobrada por você (no seu PIX/gateway) pelos preços abaixo.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2.5 }}>
            <TextField value={referralLink} fullWidth size="small" InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
            <Button variant="outlined" onClick={() => { navigator?.clipboard?.writeText(referralLink).catch(() => {}); setMsg({ type: 'success', text: 'Link copiado.' }) }}>
              Copiar
            </Button>
          </Stack>
        </>
      )}

      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Preços de revenda</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Defina o preço de venda por plano. Não pode ficar abaixo do <strong>piso</strong> — que é o preço do parceiro
        que te trouxe (ou da plataforma, se você vende direto). Os acessos são fixos (só a plataforma altera). Vazio = usa o piso.
      </Typography>

      {msg && <Alert severity={msg.type} sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      {pricesQ.isLoading ? (
        <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={24} /></Stack>
      ) : plans.length === 0 ? (
        <Alert severity="info">Nenhum plano ativo para precificar.</Alert>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Plano</TableCell>
                <TableCell align="right">Piso mensal</TableCell>
                <TableCell>Seu preço mensal</TableCell>
                <TableCell align="right">Piso anual</TableCell>
                <TableCell>Seu preço anual</TableCell>
                <TableCell align="right">Ação</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.plan_id} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600 }}>{p.name}</Typography>
                    <Chip size="small" variant="outlined" label={`${p.permission_count || 0} acessos (fixos)`} sx={{ mt: 0.5 }} />
                  </TableCell>
                  <TableCell align="right">{BRL(p.price_monthly)}</TableCell>
                  <TableCell>
                    <TextField
                      size="small" type="number" variant="standard"
                      inputProps={{ min: 0, step: '0.01' }}
                      disabled={p.price_monthly == null}
                      placeholder={p.price_monthly == null ? '—' : String(p.price_monthly)}
                      value={valOf(p, 'price_monthly')}
                      onChange={(e) => setVal(p.plan_id, 'price_monthly', e.target.value)}
                      sx={{ width: 110 }}
                    />
                  </TableCell>
                  <TableCell align="right">{BRL(p.price_annual)}</TableCell>
                  <TableCell>
                    <TextField
                      size="small" type="number" variant="standard"
                      inputProps={{ min: 0, step: '0.01' }}
                      disabled={p.price_annual == null}
                      placeholder={p.price_annual == null ? '—' : String(p.price_annual)}
                      value={valOf(p, 'price_annual')}
                      onChange={(e) => setVal(p.plan_id, 'price_annual', e.target.value)}
                      sx={{ width: 110 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" variant="outlined" onClick={() => handleSave(p)} disabled={saveM.isPending}>
                      Salvar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  )
}
