import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Button, Card, CardContent, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableHead, TableRow, TableCell, TableBody,
  Stack, Switch, FormControlLabel, IconButton
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import PageHeader from '@/components/PageHeader'
import { contractTypesService } from '@/features/contracts/contractTypes.service'
import { useForm } from 'react-hook-form'
import { useAuth } from '@/features/auth/AuthContext'

function TypeDialog({ open, onClose, onSubmit, defaultValues }) {
  const { register, handleSubmit, reset, watch } = useForm({
    defaultValues: defaultValues || { name: '', is_recurring: false, adjustment_percent: 0 },
  })
  React.useEffect(() => {
    reset(defaultValues || { name: '', is_recurring: false, adjustment_percent: 0 })
  }, [defaultValues, reset])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{defaultValues?.id ? 'Editar tipo de contrato' : 'Novo tipo de contrato'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField label="Nome" {...register('name', { required: true })} />
          <FormControlLabel
            control={<Switch {...register('is_recurring')} checked={watch('is_recurring')} />}
            label="Recorrente (renovar automaticamente)"
          />
          <TextField
            label="Reajuste anual (%)"
            type="number"
            inputProps={{ step: '0.01', min: 0 }}
            {...register('adjustment_percent', { valueAsNumber: true })}
            disabled={!watch('is_recurring')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={handleSubmit(onSubmit)}>
          {defaultValues?.id ? 'Salvar' : 'Criar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function ContractTypesPage() {
  const { selectedCompanyId } = useAuth()
  const enabled = Number.isInteger(selectedCompanyId)
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['contract_types', selectedCompanyId],
    queryFn: () => contractTypesService.list(selectedCompanyId),
    enabled,
    retry: false,
  })
  const create = useMutation({
    mutationFn: (payload) => contractTypesService.create(payload, selectedCompanyId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract_types'] }) }
  })
  const update = useMutation({
    mutationFn: ({ id, payload }) => contractTypesService.update(id, payload, selectedCompanyId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract_types'] }) }
  })
  const remove = useMutation({
    mutationFn: (id) => contractTypesService.remove(id, selectedCompanyId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract_types'] }) }
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const rows = useMemo(() => list.data || [], [list.data])

  const handleSubmit = async (form) => {
    if (!enabled) return
    const payload = {
      name: form.name?.trim(),
      is_recurring: !!form.is_recurring,
      adjustment_percent: Number(form.adjustment_percent || 0),
    }
    if (editing?.id) {
      await update.mutateAsync({ id: editing.id, payload })
    } else {
      await create.mutateAsync(payload)
    }
    setDialogOpen(false)
  }

  const handleDelete = async (row) => {
    if (!enabled) return
    if (window.confirm(`Excluir o tipo ${row.name}?`)) {
      await remove.mutateAsync(row.id)
    }
  }

  return (
    <Stack spacing={2}>
      <PageHeader title="Tipos de contrato" actions={<Button startIcon={<AddIcon />} variant="contained" onClick={() => { setEditing(null); setDialogOpen(true) }} disabled={!enabled}>Novo tipo</Button>} />
      {!enabled && (
        <Alert severity="info">Selecione uma empresa para gerenciar os tipos de contrato.</Alert>
      )}
      <Card>
        <CardContent>
          {list.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Erro ao carregar tipos de contrato: {list.error?.message || 'tente novamente.'}
            </Alert>
          )}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Nome</TableCell>
                <TableCell>Recorrente?</TableCell>
                <TableCell>Reajuste (%)</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(rows || []).map(row => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.is_recurring ? 'Sim' : 'Não'}</TableCell>
                  <TableCell>{Number(row.adjustment_percent || 0).toFixed(2)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => { setEditing(row); setDialogOpen(true) }}><EditIcon fontSize="inherit" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(row)}><DeleteIcon fontSize="inherit" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!rows?.length && (
                <TableRow><TableCell colSpan={4}>Nenhum tipo cadastrado.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <TypeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
        defaultValues={editing}
        contractTypes={rows}
      />
    </Stack>
  )
}
