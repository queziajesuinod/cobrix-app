import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import { companyService } from './company.service'
import CompanyDataForm from './CompanyDataForm'

// Dados cadastrais/recebimento das empresas da rede DIRETA do parceiro (não é
// revenda): nome, CPF/CNPJ, PIX e gateway. Útil para o parceiro deixar prontas as
// empresas que entraram por ele. Lista a downline direta e edita numa dialog que
// reusa o CompanyDataForm (sem `plans` → sem os campos de master/revenda).
export default function PartnerNetworkData({ companyId }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['partner-downline', companyId],
    queryFn: () => companyService.downline(companyId),
    enabled: Boolean(companyId),
  })
  const companies = q.data?.companies || []

  const [editing, setEditing] = React.useState(null) // { id, name }
  const [msg, setMsg] = React.useState(null)

  const detailQ = useQuery({
    queryKey: ['downline-one', companyId, editing?.id],
    queryFn: () => companyService.downlineOne(companyId, editing.id),
    enabled: Boolean(companyId && editing?.id),
  })

  const saveM = useMutation({
    mutationFn: (payload) => companyService.saveDownlineData(companyId, editing.id, payload),
    onSuccess: () => {
      setMsg({ type: 'success', text: 'Dados atualizados.' })
      qc.invalidateQueries({ queryKey: ['partner-downline', companyId] })
      setEditing(null)
    },
    onError: (err) => setMsg({ type: 'error', text: err?.response?.data?.error || 'Falha ao salvar.' }),
  })

  if (!companyId) return null

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Ajuste os dados de identificação e de recebimento (nome, CPF/CNPJ, PIX e gateway) das empresas que entraram
        pela sua indicação. Isso <strong>não</strong> mexe em revenda — é só o cadastro básico de cada empresa.
      </Typography>

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
                <TableCell>Recebimento</TableCell>
                <TableCell align="right">Ação</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell><Typography sx={{ fontWeight: 600 }}>{c.name}</Typography></TableCell>
                  <TableCell>
                    {c.can_receive
                      ? <Chip size="small" color="success" variant="outlined" label="configurado" />
                      : <Chip size="small" color="warning" variant="outlined" label="sem PIX/gateway" />}
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" variant="outlined" onClick={() => { setMsg(null); setEditing({ id: c.id, name: c.name }) }}>
                      Editar dados
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Dados de {editing?.name}</DialogTitle>
        <DialogContent dividers>
          {detailQ.isLoading ? (
            <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress /></Stack>
          ) : detailQ.error ? (
            <Alert severity="error">{detailQ.error?.response?.data?.error || 'Falha ao carregar dados.'}</Alert>
          ) : (
            <CompanyDataForm
              defaultValues={detailQ.data}
              submitting={saveM.isPending}
              onSubmit={(payload) => saveM.mutate(payload)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  )
}
