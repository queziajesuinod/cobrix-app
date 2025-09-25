import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, Typography, Stack, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Switch, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import { companyUsersService } from './company.users.service'

function AddUserDialog({ open, onClose, onSubmit, loading }) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [role, setRole] = React.useState('user')
  const can = email && password.length >= 6
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Novo usuário</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField label="Email" value={email} onChange={e=>setEmail(e.target.value)} fullWidth />
          <TextField label="Senha" type="password" value={password} onChange={e=>setPassword(e.target.value)} fullWidth helperText="Mínimo 6 caracteres" />
          <TextField select label="Papel" value={role} onChange={e=>setRole(e.target.value)} fullWidth>
            <MenuItem value="user">Usuário</MenuItem>
            <MenuItem value="admin">Admin</MenuItem>
            <MenuItem value="master">Master</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={!can || loading} onClick={()=>onSubmit({ email, password, role })}>{loading ? 'Salvando...' : 'Criar'}</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function CompanyUsersPanel({ companyId }){
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const listQ = useQuery({ queryKey: ['company_users', companyId], queryFn: () => companyUsersService.list(companyId), enabled: !!companyId })
  const createM = useMutation({ mutationFn: (p)=>companyUsersService.create(companyId, p), onSuccess: ()=>{ qc.invalidateQueries({queryKey:['company_users', companyId]}); setOpen(false) } })
  const updateM = useMutation({ mutationFn: ({ userId, payload })=>companyUsersService.update(companyId, userId, payload), onSuccess: ()=> qc.invalidateQueries({queryKey:['company_users', companyId]}) })
  const removeM = useMutation({ mutationFn: (userId)=>companyUsersService.remove(companyId, userId), onSuccess: ()=> qc.invalidateQueries({queryKey:['company_users', companyId]}) })

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Usuários da empresa</Typography>
          <Button size="small" startIcon={<AddIcon/>} variant="contained" onClick={()=>setOpen(true)}>Adicionar</Button>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Ativo</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(listQ.data||[]).map(u => (
              <TableRow key={u.id}>
                <TableCell>{u.id}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <TextField select size="small" value={u.role} onChange={(e)=>updateM.mutate({ userId: u.id, payload: { role: e.target.value } })} sx={{ minWidth: 140 }}>
                    <MenuItem value="user">Usuário</MenuItem>
                    <MenuItem value="admin">Admin</MenuItem>
                    <MenuItem value="master">Master</MenuItem>
                  </TextField>
                </TableCell>
                <TableCell><Switch checked={!!u.active} onChange={(_,v)=>updateM.mutate({ userId: u.id, payload: { active: v } })} /></TableCell>
                <TableCell align="right"><IconButton color="error" onClick={()=>removeM.mutate(u.id)}><DeleteIcon/></IconButton></TableCell>
              </TableRow>
            ))}
            {!listQ.data?.length && <TableRow><TableCell colSpan={5}><i>Nenhum usuário.</i></TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
      <AddUserDialog open={open} onClose={()=>setOpen(false)} onSubmit={(p)=>createM.mutate(p)} loading={createM.isPending} />
    </Card>
  )
}
