import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { Box, Card, Stack, TextField, Typography, Button, Alert } from '@mui/material'

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('master@cobrix.app')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState(null)
  const navigate = useNavigate()

 // LoginPage.jsx (apenas o onSubmit)
const onSubmit = async (e) => {
  e.preventDefault()
  setError(null)
  try {
    const res = await login(email, password)   // << aqui: dois args, não objeto
    const user = res?.user ?? res
    if (user?.role === 'master') navigate('/companies/select')
    else navigate('/dashboard')
  } catch (err) {
    setError(err?.response?.data?.error || 'Falha no login')
  }
}


  return (
    <Box sx={{ display:'grid', placeItems:'center', minHeight:'100vh', bgcolor:'background.default', p:2 }}>
      <Card sx={{ p: 3, width: 380 }}>
        <Stack spacing={2} component="form" onSubmit={onSubmit}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Entrar</Typography>
          <TextField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required fullWidth />
          <TextField label="Senha" type="password" value={password} onChange={e => setPassword(e.target.value)} required fullWidth />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained">Entrar</Button>
        </Stack>
      </Card>
    </Box>
  )
}