import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Card, CardContent, Typography, Grid, TextField, Button, Checkbox, FormControlLabel, MenuItem, Stack, Alert } from '@mui/material'
import { companyService } from './company.service'
import { useAuth } from '@/features/auth/AuthContext'

export default function CompanyCreatePage(){
  const nav = useNavigate()
  const { setSelectedCompanyId } = useAuth()
  const [name, setName] = React.useState('')
  const [pixKey, setPixKey] = React.useState('')
  const [gatewayClientId, setGatewayClientId] = React.useState('')
  const [gatewayClientSecret, setGatewayClientSecret] = React.useState('')
  const [gatewayCert, setGatewayCert] = React.useState({ value: null, name: '' })
  const [clientsLimit, setClientsLimit] = React.useState('')
  const [contractsLimit, setContractsLimit] = React.useState('')
  const [addUser, setAddUser] = React.useState(false)
  const [uEmail, setUEmail] = React.useState('')
  const [uPass, setUPass] = React.useState('')
  const [uRole, setURole] = React.useState('admin')

  const can = name.trim().length >= 2

  const toNumberOrNull = (value) => {
    const trimmed = String(value ?? '').trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  const handleCertChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      setGatewayCert({ value: '', name: '' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      const base64 = typeof result === 'string' ? result.split(',').pop() : ''
      setGatewayCert({ value: base64, name: file.name })
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const handleCertClear = () => {
    setGatewayCert({ value: '', name: '' })
  }

  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        pix_key: pixKey || undefined,
        clients_limit: toNumberOrNull(clientsLimit),
        contracts_limit: toNumberOrNull(contractsLimit),
        gateway_client_id: gatewayClientId.trim() || undefined,
        gateway_client_secret: gatewayClientSecret.trim() || undefined,
        initial_users: addUser && uEmail && uPass ? [{ email: uEmail, password: uPass, role: uRole }] : []
      }
      if (gatewayCert.value !== null) {
        payload.gateway_cert_base64 = gatewayCert.value || null
      }
      return companyService.create(payload)
    },
    onSuccess: (data) => {
      if (data?.id) {
        setSelectedCompanyId?.(data.id)
      }
      nav(`/integration/evo`)
    }
  })

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Nova empresa</Typography>

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField label="Nome da empresa" value={name} onChange={e=>setName(e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={12} md={6}>
            <Alert severity="info">A integração com o WhatsApp será criada automaticamente ao salvar. Você poderá conectar o WhatsApp na próxima tela.</Alert>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField label="Chave PIX" value={pixKey} onChange={e=>setPixKey(e.target.value)} fullWidth placeholder="Chave PIX usada nas notificações" />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Client ID (EfiPay)"
              value={gatewayClientId}
              onChange={e=>setGatewayClientId(e.target.value)}
              fullWidth
              placeholder="Credencial Pix da empresa"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Client Secret (EfiPay)"
              type="password"
              value={gatewayClientSecret}
              onChange={e=>setGatewayClientSecret(e.target.value)}
              fullWidth
              placeholder="Secret fornecido pela EfiPay"
            />
          </Grid>
          <Grid item xs={12}>
            <Stack spacing={1}>
              <Typography variant="body2">Certificado Pix (.p12/.pem)</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Button component="label" variant="outlined">
                  Selecionar arquivo
                  <input hidden type="file" accept=".p12,.pfx,.pem,.crt,.cer" onChange={handleCertChange} />
                </Button>
                <Typography variant="body2" color="text.secondary">{gatewayCert.name || 'Nenhum arquivo selecionado'}</Typography>
                {gatewayCert.value && (
                  <Button color="warning" onClick={handleCertClear}>Limpar</Button>
                )}
              </Stack>
            </Stack>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Limite de clientes"
              type="number"
              inputProps={{ min: 0 }}
              helperText="Em branco = ilimitado"
              value={clientsLimit}
              onChange={e=>setClientsLimit(e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Limite de contratos"
              type="number"
              inputProps={{ min: 0 }}
              helperText="Em branco = ilimitado"
              value={contractsLimit}
              onChange={e=>setContractsLimit(e.target.value)}
              fullWidth
            />
          </Grid>

          <Grid item xs={12}>
            <FormControlLabel
              control={<Checkbox checked={addUser} onChange={(_,v)=>setAddUser(v)} />}
              label="Criar usuário inicial"
            />
          </Grid>

          {addUser && (
            <>
              <Grid item xs={12} md={5}>
                <TextField label="Email" type="email" value={uEmail} onChange={e=>setUEmail(e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} md={5}>
                <TextField label="Senha" type="password" value={uPass} onChange={e=>setUPass(e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField label="Papel" select value={uRole} onChange={e=>setURole(e.target.value)} fullWidth>
                  <MenuItem value="user">Usuário</MenuItem>
                  <MenuItem value="admin">Admin</MenuItem>
                  <MenuItem value="master">Master</MenuItem>
                </TextField>
              </Grid>
            </>
          )}
        </Grid>

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button onClick={()=>nav(-1)}>Cancelar</Button>
          <Button variant="contained" disabled={!can || mut.isPending} onClick={()=>mut.mutate()}>
            {mut.isPending ? 'Criando...' : 'Criar empresa'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
