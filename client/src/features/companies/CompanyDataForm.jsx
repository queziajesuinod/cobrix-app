import React from 'react'
import { Stack, TextField, Button } from '@mui/material'

export default function CompanyDataForm({ defaultValues, onSubmit, submitting }){
  const [name, setName] = React.useState(defaultValues?.name || '')
  React.useEffect(()=>{ setName(defaultValues?.name || '') }, [defaultValues?.name])
  const can = name.trim().length >= 2
  return (
    <form onSubmit={(e)=>{e.preventDefault(); if(can) onSubmit?.({ name: name.trim() })}}>
      <Stack spacing={2}>
        <TextField label="Nome da empresa" value={name} onChange={(e)=>setName(e.target.value)} fullWidth />
        <Stack direction="row" justifyContent="flex-end">
          <Button type="submit" variant="contained" disabled={!can || submitting}>{submitting ? 'Salvando...' : 'Salvar'}</Button>
        </Stack>
      </Stack>
    </form>
  )
}
