import React from 'react'
import { Stack, TextField, Button, Alert } from '@mui/material'

export default function CompanyEvoIntegrationForm({ defaultValues, onSubmit, onTest, submitting }){
  const [url, setUrl] = React.useState(defaultValues?.evo_api_url || '')
  const [key, setKey] = React.useState(defaultValues?.evo_api_key || '')

  React.useEffect(()=>{
    setUrl(defaultValues?.evo_api_url || '')
    setKey(defaultValues?.evo_api_key || '')
  }, [defaultValues?.evo_api_url, defaultValues?.evo_api_key])

  const canSave = url.trim() && key.trim()

  return (
    <form onSubmit={(e)=>{e.preventDefault(); if (canSave) onSubmit?.({ evo_api_url: url.trim(), evo_api_key: key.trim() })}}>
      <Stack spacing={2}>
        <TextField label="EVO API URL" value={url} onChange={e=>setUrl(e.target.value)} fullWidth placeholder="https://evo.aleftec.com.br/message/sendText/MEU_CELULAR" />
        <TextField label="EVO API KEY" value={key} onChange={e=>setKey(e.target.value)} fullWidth />
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="outlined" onClick={()=>onTest?.({ number: '5567992625560', text: 'Teste de integração Cobrix ✅' })}>Enviar teste</Button>
          <Button type="submit" variant="contained" disabled={!canSave || submitting}>{submitting ? 'Salvando...' : 'Salvar'}</Button>
        </Stack>
        <Alert severity="info">Cada empresa tem sua própria URL/KEY — salvo aqui e usado pelo backend automaticamente.</Alert>
      </Stack>
    </form>
  )
}
