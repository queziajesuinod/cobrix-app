import React from 'react'
import { Stack, TextField, Button } from '@mui/material'

export default function CompanyDataForm({ defaultValues, onSubmit, submitting }){
  const [name, setName] = React.useState(defaultValues?.name || '')
  const [pix, setPix] = React.useState(defaultValues?.pix_key || '')
  React.useEffect(()=>{ setName(defaultValues?.name || '') }, [defaultValues?.name])
  React.useEffect(()=>{ setPix(defaultValues?.pix_key || '') }, [defaultValues?.pix_key])
  const can = name.trim().length >= 2
  return (
    <form onSubmit={(e)=>{e.preventDefault(); if(can) onSubmit?.({ name: name.trim(), pix_key: pix.trim() || null })}}>
      <Stack spacing={2}>
        <TextField label="Nome da empresa" value={name} onChange={(e)=>setName(e.target.value)} fullWidth />
        <TextField label="Chave PIX" value={pix} onChange={(e)=>setPix(e.target.value)} fullWidth placeholder="Informe a chave PIX usada nas cobranças" />
        <Stack direction="row" justifyContent="flex-end">
          <Button type="submit" variant="contained" disabled={!can || submitting}>{submitting ? 'Salvando...' : 'Salvar'}</Button>
        </Stack>
      </Stack>
    </form>
  )
}
