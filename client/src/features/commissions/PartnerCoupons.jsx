import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, Grid, IconButton, MenuItem, Stack, Switch,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { couponsService } from '@/features/admin/coupons.service'

const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—')
const EMPTY = { code: '', discount_type: 'percent', discount_value: '', expires_at: '', max_redemptions: '' }

// Cupons do PARCEIRO (self-service). Valem só nos cadastros pelo link dele; o
// desconto sai do bolso do parceiro (a comissão-base da Padrão não muda). O
// backend escopa automaticamente por empresa (partner_id).
export default function PartnerCoupons() {
  const qc = useQueryClient()
  const [form, setForm] = React.useState(EMPTY)
  const [msg, setMsg] = React.useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const listQ = useQuery({ queryKey: ['partner-coupons'], queryFn: couponsService.list })
  const coupons = listQ.data?.coupons || []

  const createM = useMutation({
    mutationFn: () => couponsService.create({
      code: form.code.trim(),
      discount_type: form.discount_type,
      discount_value: form.discount_value === '' ? null : Number(String(form.discount_value).replace(',', '.')),
      applies_to_period: 'any',
      expires_at: form.expires_at || null,
      max_redemptions: form.max_redemptions === '' ? null : Number(form.max_redemptions),
      active: true,
    }),
    onSuccess: () => { setMsg({ type: 'success', text: 'Cupom criado.' }); setForm(EMPTY); qc.invalidateQueries({ queryKey: ['partner-coupons'] }) },
    onError: (e) => setMsg({ type: 'error', text: e?.response?.data?.error || 'Falha ao criar cupom.' }),
  })
  const toggleM = useMutation({
    mutationFn: ({ id, active }) => couponsService.setActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-coupons'] }),
    onError: (e) => setMsg({ type: 'error', text: e?.response?.data?.error || 'Falha ao alterar.' }),
  })
  const removeM = useMutation({
    mutationFn: (id) => couponsService.remove(id),
    onSuccess: () => { setMsg({ type: 'success', text: 'Cupom removido.' }); qc.invalidateQueries({ queryKey: ['partner-coupons'] }) },
    onError: (e) => setMsg({ type: 'error', text: e?.response?.data?.error || 'Falha ao remover.' }),
  })

  const valid = form.code.trim().length >= 2 && Number(form.discount_value) > 0
    && !(form.discount_type === 'percent' && Number(form.discount_value) > 100)

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Cupons de desconto</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Cupons de engajamento — valem só para quem se cadastrar pelo <strong>seu link</strong>. O desconto sai do seu bolso;
        a comissão da plataforma não muda. Um cupom de 100% dá o 1º mês grátis ao cliente (você ainda paga a comissão-base).
      </Typography>

      {msg && <Alert severity={msg.type} sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth size="small" label="Código" value={form.code} onChange={set('code')} placeholder="EX: BEMVINDO" />
        </Grid>
        <Grid item xs={6} sm={2}>
          <TextField select fullWidth size="small" label="Tipo" value={form.discount_type} onChange={set('discount_type')}>
            <MenuItem value="percent">%</MenuItem>
            <MenuItem value="fixed">R$</MenuItem>
          </TextField>
        </Grid>
        <Grid item xs={6} sm={2}>
          <TextField fullWidth size="small" type="number" label="Desconto" value={form.discount_value} onChange={set('discount_value')} inputProps={{ min: 0, step: '0.01' }} />
        </Grid>
        <Grid item xs={6} sm={2}>
          <TextField fullWidth size="small" type="date" label="Validade" InputLabelProps={{ shrink: true }} value={form.expires_at} onChange={set('expires_at')} />
        </Grid>
        <Grid item xs={6} sm={2}>
          <TextField fullWidth size="small" type="number" label="Limite de usos" value={form.max_redemptions} onChange={set('max_redemptions')} inputProps={{ min: 0, step: 1 }} placeholder="∞" />
        </Grid>
        <Grid item xs={6} sm={1}>
          <Button fullWidth variant="contained" disableElevation sx={{ height: 40 }} disabled={!valid || createM.isPending} onClick={() => createM.mutate()}>Criar</Button>
        </Grid>
      </Grid>

      {listQ.isLoading ? (
        <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={22} /></Stack>
      ) : coupons.length === 0 ? (
        <Alert severity="info">Você ainda não tem cupons.</Alert>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Código</TableCell>
                <TableCell>Desconto</TableCell>
                <TableCell>Validade</TableCell>
                <TableCell align="center">Usos</TableCell>
                <TableCell align="center">Ativo</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {coupons.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell><Typography sx={{ fontWeight: 700 }}>{c.code}</Typography></TableCell>
                  <TableCell>{c.discount_type === 'percent' ? `${Number(c.discount_value)}%` : BRL(c.discount_value)}</TableCell>
                  <TableCell>{fmtDate(c.expires_at)}</TableCell>
                  <TableCell align="center">
                    <Chip size="small" variant="outlined" label={c.max_redemptions == null ? `${c.redeemed_count}` : `${c.redeemed_count}/${c.max_redemptions}`} />
                  </TableCell>
                  <TableCell align="center">
                    <Switch size="small" checked={!!c.active} onChange={(e) => toggleM.mutate({ id: c.id, active: e.target.checked })} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Remover">
                      <IconButton size="small" color="error" onClick={() => removeM.mutate(c.id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                    </Tooltip>
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
