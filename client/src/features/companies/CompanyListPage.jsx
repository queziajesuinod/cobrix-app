import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, Stack, Typography, Button, Table, TableHead, TableRow, TableCell, TableBody, IconButton } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SettingsIcon from '@mui/icons-material/Settings'
import DeleteIcon from '@mui/icons-material/Delete'
import { companyService } from './company.service'

export default function CompanyListPage(){
  const nav = useNavigate()
  const qc = useQueryClient()
  const listQ = useQuery({ queryKey: ['companies'], queryFn: companyService.list })
  const delM = useMutation({ mutationFn: (id)=>companyService.remove(id), onSuccess: ()=> qc.invalidateQueries({queryKey:['companies']}) })

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Empresas</Typography>
          <Button variant="contained" startIcon={<AddIcon/>} onClick={()=>nav('/companies/new')}>Nova empresa</Button>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Nome</TableCell>
              <TableCell>Criada em</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(listQ.data||[]).map(c => (
              <TableRow key={c.id}>
                <TableCell>{c.id}</TableCell>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '-'}</TableCell>
                <TableCell align="right">
                  <IconButton color="primary" onClick={()=>nav(`/companies/${c.id}/settings`)}><SettingsIcon/></IconButton>
                  <IconButton color="error" onClick={()=>delM.mutate(c.id)}><DeleteIcon/></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {!listQ.data?.length && <TableRow><TableCell colSpan={4}><i>Nenhuma empresa.</i></TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
