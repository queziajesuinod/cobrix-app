import React from 'react'
import { Stack, TextField, Button, Typography } from '@mui/material'

export default function CompanyDataForm({ defaultValues, onSubmit, submitting }){
  const formatLimit = (value) => (value === undefined || value === null ? '' : String(value))
  const [name, setName] = React.useState(defaultValues?.name || '')
  const [pix, setPix] = React.useState(defaultValues?.pix_key || '')
  const [gatewayClientId, setGatewayClientId] = React.useState(defaultValues?.gateway_client_id || '')
  const [gatewayClientSecret, setGatewayClientSecret] = React.useState('')
  const [gatewayCert, setGatewayCert] = React.useState({ value: null, name: '' })
  const [clientsLimit, setClientsLimit] = React.useState(formatLimit(defaultValues?.clients_limit))
  const [contractsLimit, setContractsLimit] = React.useState(formatLimit(defaultValues?.contracts_limit))
  const hasGatewaySecret = Boolean(defaultValues?.gateway_has_secret)
  const hasExistingCert = Boolean(defaultValues?.gateway_cert_uploaded)
  React.useEffect(()=>{ setName(defaultValues?.name || '') }, [defaultValues?.name])
  React.useEffect(()=>{ setPix(defaultValues?.pix_key || '') }, [defaultValues?.pix_key])
  React.useEffect(()=>{ setGatewayClientId(defaultValues?.gateway_client_id || '') }, [defaultValues?.gateway_client_id])
  React.useEffect(()=>{ setGatewayClientSecret('') }, [defaultValues?.gateway_has_secret, defaultValues?.gateway_client_id])
  React.useEffect(()=>{ setClientsLimit(formatLimit(defaultValues?.clients_limit)) }, [defaultValues?.clients_limit])
  React.useEffect(()=>{ setContractsLimit(formatLimit(defaultValues?.contracts_limit)) }, [defaultValues?.contracts_limit])
  React.useEffect(()=>{ setGatewayCert({ value: null, name: '' }) }, [defaultValues?.gateway_cert_uploaded])
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
      setGatewayCert((prev) => ({ ...prev, value: '', name: '' }))
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
  const handleSubmit = (e) => {
    e.preventDefault()
    if (!can) return
    const payload = {
      name: name.trim(),
      pix_key: pix.trim() || null,
      clients_limit: toNumberOrNull(clientsLimit),
      contracts_limit: toNumberOrNull(contractsLimit),
      gateway_client_id: gatewayClientId.trim() || null,
    }
    if (gatewayClientSecret.trim()) {
      payload.gateway_client_secret = gatewayClientSecret.trim()
    }
    if (gatewayCert.value !== null) {
      payload.gateway_cert_base64 = gatewayCert.value || null
    }
    onSubmit?.(payload)
  }
  const certLabel = gatewayCert.name || (hasExistingCert && gatewayCert.value === null ? 'Certificado já enviado' : 'Nenhum arquivo selecionado')
  return (
    <form onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <TextField label="Nome da empresa" value={name} onChange={(e)=>setName(e.target.value)} fullWidth />
        <TextField label="Chave PIX" value={pix} onChange={(e)=>setPix(e.target.value)} fullWidth placeholder="Informe a chave PIX usada nas cobranças" />
        <Stack spacing={1}>
          <Typography variant="subtitle2" color="text.secondary">Gateway de pagamento (Pix)</Typography>
          <TextField
            label="Client ID (EfiPay)"
            value={gatewayClientId}
            onChange={(e)=>setGatewayClientId(e.target.value)}
            fullWidth
            placeholder="Identificador fornecido pela EfiPay"
          />
          <TextField
            label="Client Secret (EfiPay)"
            type="password"
            value={gatewayClientSecret}
            onChange={(e)=>setGatewayClientSecret(e.target.value)}
            fullWidth
            placeholder={hasGatewaySecret ? 'Mantido' : 'Informe o secret gerado na EfiPay'}
            helperText={hasGatewaySecret ? 'Deixe em branco para manter o secret atual.' : 'Necessário ao ativar o gateway.'}
          />
          <Stack spacing={1}>
            <Typography variant="body2">Certificado Pix (.p12/.pem)</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <Button component="label" variant="outlined">
                Selecionar arquivo
                <input hidden type="file" accept=".p12,.pfx,.pem,.crt,.cer" onChange={handleCertChange} />
              </Button>
              <Typography variant="body2" color="text.secondary">{certLabel}</Typography>
              {(gatewayCert.value !== null ? gatewayCert.value !== '' : hasExistingCert) && (
                <Button color="warning" onClick={handleCertClear}>Remover certificado</Button>
              )}
            </Stack>
          </Stack>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Limite de clientes"
            type="number"
            inputProps={{ min: 0 }}
            helperText="Em branco = ilimitado"
            value={clientsLimit}
            onChange={(e)=>setClientsLimit(e.target.value)}
            fullWidth
          />
          <TextField
            label="Limite de contratos"
            type="number"
            inputProps={{ min: 0 }}
            helperText="Em branco = ilimitado"
            value={contractsLimit}
            onChange={(e)=>setContractsLimit(e.target.value)}
            fullWidth
          />
        </Stack>
        <Stack direction="row" justifyContent="flex-end">
          <Button type="submit" variant="contained" disabled={!can || submitting}>{submitting ? 'Salvando...' : 'Salvar'}</Button>
        </Stack>
      </Stack>
    </form>
  )
}
