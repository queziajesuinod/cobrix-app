import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, MenuItem, Stack, Switch, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { companyService } from './company.service'

// Rede do PARCEIRO (self-service): as empresas que assinaram pela indicação dele.
// Aqui ele habilita cada uma como SUB-PARCEIRA e define o override delas (a comissão
// extra que a sub ganha das vendas da PRÓPRIA rede). Escopo é a downline DIRETA;
// salva empresa a empresa. Bloqueado quando a revenda do parceiro está inadimplente.
export default function PartnerNetwork({ companyId, resellerStatus = 'active' }) {
  const resellerLocked = resellerStatus === 'link_locked' || resellerStatus === 'network_seized'
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['partner-downline', companyId],
    queryFn: () => companyService.downline(companyId),
    enabled: Boolean(companyId),
  })
  const companies = q.data?.companies || []

  // Edições locais por empresa: { [id]: { is_partner, partner_override_type, partner_override_value } }.
  const [edits, setEdits] = React.useState({})
  const [msg, setMsg] = React.useState(null)

  const rowState = (c) => {
    const e = edits[c.id] || {}
    return {
      is_partner: e.is_partner !== undefined ? e.is_partner : Boolean(c.is_partner),
      partner_override_type: e.partner_override_type !== undefined ? e.partner_override_type : (c.partner_override_type || 'percent'),
      partner_override_value: e.partner_override_value !== undefined ? e.partner_override_value
        : (c.partner_override_value == null ? '' : String(c.partner_override_value)),
    }
  }
  const setRow = (id, patch) => setEdits((s) => ({ ...s, [id]: { ...s[id], ...patch } }))

  const saveM = useMutation({
    mutationFn: ({ childId, payload }) => companyService.saveDownlinePartner(companyId, childId, payload),
    onSuccess: () => {
      setMsg({ type: 'success', text: 'Sub-parceiro atualizado.' })
      qc.invalidateQueries({ queryKey: ['partner-downline', companyId] })
    },
    onError: (err) => setMsg({ type: 'error', text: err?.response?.data?.error || 'Falha ao salvar.' }),
  })

  const handleSave = (c) => {
    setMsg(null)
    const st = rowState(c)
    saveM.mutate({
      childId: c.id,
      payload: {
        is_partner: st.is_partner,
        partner_override_type: st.partner_override_type,
        partner_override_value: st.partner_override_value === '' ? 0 : Number(String(st.partner_override_value).replace(',', '.')),
      },
    })
  }

  if (!companyId) return null

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Empresas que assinaram pela sua indicação. Habilite-as como <strong>parceiras</strong> para que também possam
        revender, e defina o <strong>override</strong> de cada uma (a comissão extra que ela ganha das vendas da própria rede).
      </Typography>

      {resellerLocked && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          Sua revenda está bloqueada por inadimplência — regularize para gerenciar sua rede.
        </Alert>
      )}
      {msg && <Alert severity={msg.type} sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      {q.isLoading ? (
        <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={24} /></Stack>
      ) : companies.length === 0 ? (
        <Alert severity="info">Nenhuma empresa se cadastrou pela sua indicação ainda.</Alert>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Empresa</TableCell>
                <TableCell align="center">É parceira?</TableCell>
                <TableCell>Tipo do override</TableCell>
                <TableCell>Override</TableCell>
                <TableCell align="right">Ação</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {companies.map((c) => {
                const st = rowState(c)
                return (
                  <TableRow key={c.id} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{c.name}</Typography>
                      {!c.can_receive && (
                        <Chip size="small" color="warning" variant="outlined" label="sem PIX/gateway" sx={{ mt: 0.5 }} />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        checked={st.is_partner}
                        disabled={resellerLocked}
                        onChange={(e) => setRow(c.id, { is_partner: e.target.checked })}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        select size="small" variant="standard" sx={{ width: 140 }}
                        disabled={resellerLocked || !st.is_partner}
                        value={st.partner_override_type}
                        onChange={(e) => setRow(c.id, { partner_override_type: e.target.value })}
                      >
                        <MenuItem value="percent">Percentual (%)</MenuItem>
                        <MenuItem value="fixed">Valor fixo (R$)</MenuItem>
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small" type="number" variant="standard"
                        inputProps={{ min: 0, step: '0.01', max: st.partner_override_type === 'percent' ? 100 : undefined }}
                        disabled={resellerLocked || !st.is_partner}
                        value={st.partner_override_value}
                        onChange={(e) => setRow(c.id, { partner_override_value: e.target.value })}
                        sx={{ width: 100 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" disabled={resellerLocked || saveM.isPending} onClick={() => handleSave(c)}>
                        Salvar
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  )
}
