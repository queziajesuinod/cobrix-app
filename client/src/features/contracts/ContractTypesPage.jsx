import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableHead, TableRow, TableCell, TableBody,
  Stack, Switch, FormControlLabel, IconButton, Typography
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import DescriptionIcon from '@mui/icons-material/Description'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import TableToolbar from '@/components/TableToolbar'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import { contractTypesService } from '@/features/contracts/contractTypes.service'
import { useForm } from 'react-hook-form'
import { useAuth } from '@/features/auth/AuthContext'
import { useConfirm } from '@/components/ConfirmDialog'
import { usePermissions } from '@/features/permissions/PermissionsContext'

function TypeDialog({ open, onClose, onSubmit, defaultValues }) {
  const base = { name: '', is_recurring: false, adjustment_percent: 0, adjustment_type: 'percent' }
  const { register, handleSubmit, reset, watch, setValue } = useForm({ defaultValues: defaultValues || base })
  React.useEffect(() => {
    reset(defaultValues ? { ...base, ...defaultValues } : base)
  }, [defaultValues, reset])
  const recurring = watch('is_recurring')
  const adjType = watch('adjustment_type') || 'percent'

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
          {/* Reajuste anual na renovação: por PORCENTAGEM (%) ou por VALOR FIXO (R$). */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select label="Tipo de reajuste" value={adjType}
              onChange={(e) => setValue('adjustment_type', e.target.value)}
              disabled={!recurring} sx={{ minWidth: 180 }}
              SelectProps={{ native: true }} InputLabelProps={{ shrink: true }}
            >
              <option value="percent">Porcentagem (%)</option>
              <option value="fixed">Valor fixo (R$)</option>
            </TextField>
            <TextField
              label={adjType === 'fixed' ? 'Reajuste anual (R$)' : 'Reajuste anual (%)'}
              type="number"
              inputProps={{ step: '0.01', min: 0 }}
              {...register('adjustment_percent', { valueAsNumber: true })}
              disabled={!recurring}
              fullWidth
            />
          </Stack>
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
  const confirm = useConfirm()
  const { can } = usePermissions()
  const canManage = can('contractTypes.manage')
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
      adjustment_type: form.adjustment_type === 'fixed' ? 'fixed' : 'percent',
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
    const ok = await confirm({
      title: 'Excluir tipo de contrato',
      description: `Excluir o tipo "${row.name}"? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      tone: 'danger',
    })
    if (ok) {
      await remove.mutateAsync(row.id)
    }
  }

  return (
    <Stack spacing={2}>
      <PageHeader title="Tipos de contrato" actions={canManage ? <Button startIcon={<AddIcon />} variant="contained" onClick={() => { setEditing(null); setDialogOpen(true) }} disabled={!enabled}>Novo tipo</Button> : null} />
      {!enabled && (
        <Alert severity="info">Selecione uma empresa para gerenciar os tipos de contrato.</Alert>
      )}
      <PapperBlock title="Tipos cadastrados" icon={<DescriptionIcon />} iconColor="primary.main" noPadding>
        <TableToolbar count={rows.length} countLabel="tipos" />
        {list.isError && (
          <Alert severity="error" sx={{ m: 2 }}>
            Erro ao carregar tipos de contrato: {list.error?.message || 'tente novamente.'}
          </Alert>
        )}
        <Box sx={{ overflow: 'auto', maxHeight: { xs: 460, md: 560 } }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell>Nome</TableCell>
                <TableCell>Recorrente?</TableCell>
                <TableCell>Reajuste</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {enabled && list.isLoading ? (
                <TableSkeleton rows={6} columns={4} />
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} sx={{ border: 0 }}>
                    <EmptyState
                      icon={<DescriptionIcon />}
                      title="Nenhum tipo cadastrado"
                      description={enabled ? 'Cadastre o primeiro tipo de contrato para começar.' : 'Selecione uma empresa para visualizar os tipos de contrato.'}
                      action={enabled ? <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditing(null); setDialogOpen(true) }}>Novo tipo</Button> : undefined}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.is_recurring ? 'Sim' : 'Não'}</TableCell>
                    <TableCell>
                      {row.is_recurring
                        ? (row.adjustment_type === 'fixed'
                          ? `R$ ${Number(row.adjustment_percent || 0).toFixed(2)}`
                          : `${Number(row.adjustment_percent || 0).toFixed(2)}%`)
                        : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {canManage ? (
                        <>
                          <IconButton size="small" onClick={() => { setEditing(row); setDialogOpen(true) }}><EditIcon fontSize="inherit" /></IconButton>
                          <IconButton size="small" color="error" onClick={() => handleDelete(row)}><DeleteIcon fontSize="inherit" /></IconButton>
                        </>
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Box>
      </PapperBlock>

      <TypeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
        defaultValues={editing}
      />
    </Stack>
  )
}
