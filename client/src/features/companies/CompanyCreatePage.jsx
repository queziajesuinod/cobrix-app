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
  const [addUser, setAddUser] = React.useState(false)
  const [uEmail, setUEmail] = React.useState('')
  const [uPass, setUPass] = React.useState('')
  const [uRole, setURole] = React.useState('admin')

  const can = name.trim().length >= 2

  const mut = useMutation({
    mutationFn: () => companyService.create({
      name: name.trim(),
      pix_key: pixKey || undefined,
      initial_users: addUser && uEmail && uPass ? [{ email: uEmail, password: uPass, role: uRole }] : []
    }),
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
          <Grid item xs={12} md={6}>
            <TextField label="Chave PIX" value={pixKey} onChange={e=>setPixKey(e.target.value)} fullWidth placeholder="Chave PIX usada nas notificações" />
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
