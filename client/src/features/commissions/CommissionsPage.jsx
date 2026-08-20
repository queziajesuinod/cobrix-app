import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Snackbar, Stack, Table,
  TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import HandshakeIcon from '@mui/icons-material/Handshake'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { commissionsService } from './commissions.service'

const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function TotalCard({ label, value, color }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, flex: 1 }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: `${color}.main` }}>{BRL(value)}</Typography>
      </CardContent>
    </Card>
  )
}

export default function CommissionsPage() {
  const { selectedCompanyId } = useAuth()
  const qc = useQueryClient()
  const [snack, setSnack] = React.useState(null)

  const summaryQ = useQuery({
    queryKey: ['commissions-summary', selectedCompanyId],
    queryFn: () => commissionsService.summary(),
    enabled: Boolean(selectedCompanyId),
  })

  const settleM = useMutation({
    mutationFn: (payload) => commissionsService.settle(payload),
    onSuccess: (d) => {
      setSnack({ type: 'success', text: `Acerto registrado (${d?.settled || 0} comissão(ões)).` })
      qc.invalidateQueries({ queryKey: ['commissions-summary'] })
    },
    onError: (e) => setSnack({ type: 'error', text: e?.response?.data?.error || 'Falha ao registrar acerto.' }),
  })

  const chargeM = useMutation({
    mutationFn: (payload) => commissionsService.charge(payload),
    onSuccess: (d) => {
      const wpp = d?.whatsapp ? ' WhatsApp enviado.' : (d?.phone ? '' : ' (parceiro sem telefone).')
      setSnack({ type: 'success', text: `Cobrança gerada: ${BRL(d?.total)}.${wpp}` })
      qc.invalidateQueries({ queryKey: ['commissions-summary'] })
    },
    onError: (e) => setSnack({ type: 'error', text: e?.response?.data?.error || 'Falha ao gerar cobrança.' }),
  })

  if (!selectedCompanyId) return <CompanyRequiredAlert />

  const receivable = summaryQ.data?.receivable || { items: [], total: 0 }
  const payable = summaryQ.data?.payable || { items: [], total: 0 }

  return (
    <>
      <PageHeader title="Comissões de revenda" subtitle="O que você tem a receber dos parceiros e a pagar à sua linha de cima." />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TotalCard label="A receber (em aberto)" value={receivable.total} color="success" />
        <TotalCard label="A pagar (em aberto)" value={payable.total} color="error" />
      </Stack>

      {summaryQ.isLoading ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack>
      ) : summaryQ.isError ? (
        <Alert severity="error">Falha ao carregar as comissões.</Alert>
      ) : (
        <Stack spacing={2}>
          <PapperBlock title="A receber dos parceiros" icon={<HandshakeIcon />} iconColor="success.main">
            {receivable.items.length === 0 ? (
              <Alert severity="info">Nada a receber em aberto.</Alert>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Parceiro</TableCell>
                    <TableCell align="center">Lançamentos</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Ação</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {receivable.items.map((r) => (
                    <TableRow key={r.company_id} hover>
                      <TableCell>{r.company_name}</TableCell>
                      <TableCell align="center"><Chip size="small" variant="outlined" label={r.count} /></TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>{BRL(r.total)}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button
                            size="small" variant="contained" disableElevation disabled={chargeM.isPending}
                            onClick={() => chargeM.mutate({ counterparty_id: r.company_id })}
                          >
                            Cobrar (PIX/WhatsApp)
                          </Button>
                          <Button
                            size="small" variant="outlined" disabled={settleM.isPending}
                            onClick={() => settleM.mutate({ counterparty_id: r.company_id })}
                          >
                            Marcar pago
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PapperBlock>

          <PapperBlock title="A pagar (comissões que você deve)" icon={<HandshakeIcon />} iconColor="error.main">
            {payable.items.length === 0 ? (
              <Alert severity="info">Nada a pagar em aberto.</Alert>
            ) : (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Credor</TableCell>
                      <TableCell align="center">Lançamentos</TableCell>
                      <TableCell align="right">Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {payable.items.map((r) => (
                      <TableRow key={r.company_id} hover>
                        <TableCell>{r.company_name}</TableCell>
                        <TableCell align="center"><Chip size="small" variant="outlined" label={r.count} /></TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>{BRL(r.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Você acerta apenas com a sua <strong>linha de cima direta</strong> (o "Credor" acima) — ela repassa o restante
                  para cima. O acerto é dado baixa por quem recebe. Se você tem o Gerenciador Financeiro, cada comissão também
                  aparece como despesa "a pagar".
                </Typography>
              </>
            )}
          </PapperBlock>
        </Stack>
      )}

      <Snackbar
        open={Boolean(snack)} autoHideDuration={4000} onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? <Alert severity={snack.type} onClose={() => setSnack(null)}>{snack.text}</Alert> : undefined}
      </Snackbar>
    </>
  )
}
