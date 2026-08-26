import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Box, Button, Table, TableHead, TableRow, TableCell, TableBody, IconButton } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SettingsIcon from '@mui/icons-material/Settings'
import DeleteIcon from '@mui/icons-material/Delete'
import BusinessIcon from '@mui/icons-material/Business'
import PapperBlock from '@/components/PapperBlock'
import TableToolbar from '@/components/TableToolbar'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import { companyService } from './company.service'

export default function CompanyListPage(){
  const nav = useNavigate()
  const qc = useQueryClient()
  const listQ = useQuery({ queryKey: ['companies'], queryFn: companyService.list })
  const delM = useMutation({ mutationFn: (id)=>companyService.remove(id), onSuccess: ()=> qc.invalidateQueries({queryKey:['companies']}) })

  const rows = listQ.data || []

  return (
    <PapperBlock
      title="Empresas"
      icon={<BusinessIcon/>}
      iconColor="primary.main"
      action={<Button variant="contained" startIcon={<AddIcon/>} onClick={()=>nav('/companies/new')}>Nova empresa</Button>}
      noPadding
    >
      <TableToolbar count={rows.length} countLabel="empresas" />
      <Box sx={{ overflow: 'auto', maxHeight: { xs: 460, md: 560 } }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Nome</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {listQ.isLoading ? (
              <TableSkeleton rows={6} columns={3} />
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={{ border: 0 }}>
                  <EmptyState
                    icon={<BusinessIcon/>}
                    title="Nenhuma empresa"
                    description="Cadastre sua primeira empresa para começar."
                    action={<Button variant="contained" startIcon={<AddIcon/>} onClick={()=>nav('/companies/new')}>Nova empresa</Button>}
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map(c => (
                <TableRow key={c.id}>
                  <TableCell>{c.id}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell align="right">
                    <IconButton color="primary" onClick={()=>nav(`/companies/${c.id}/settings`)}><SettingsIcon/></IconButton>
                    <IconButton color="error" onClick={()=>delM.mutate(c.id)}><DeleteIcon/></IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Box>
    </PapperBlock>
  )
}
