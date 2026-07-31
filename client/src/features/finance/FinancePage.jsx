import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Grid, IconButton, MenuItem, Snackbar, Stack, Switch, Tab, Table, TableBody,
  TableCell, TableHead, TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DownloadIcon from '@mui/icons-material/Download'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EventRepeatIcon from '@mui/icons-material/EventRepeat'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import PaymentsIcon from '@mui/icons-material/Payments'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import AuditInfo from '@/components/AuditInfo'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { useConfirm } from '@/components/ConfirmDialog'
import { financeService } from './finance.service'
import { downloadModelo, parseFile } from './spreadsheet'
import { clientsService } from '@/features/clients/clients.service'
import { contractsService } from '@/features/contracts/contracts.service'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'

const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10).split('-').reverse().join('/') : (v ? new Date(v).toLocaleDateString('pt-BR') : '-'))

const pad = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const currentYm = () => isoOf(new Date()).slice(0, 7)
// Intervalo [from, to) conforme o tipo de período selecionado.
function computeRange(type, ym, year) {
  const today = new Date()
  if (type === 'year') return { from: `${year}-01-01`, to: `${Number(year) + 1}-01-01` }
  if (type === '90d') {
    const from = new Date(today); from.setDate(from.getDate() - 90)
    const to = new Date(today); to.setDate(to.getDate() + 1)
    return { from: isoOf(from), to: isoOf(to) }
  }
  const [y, m] = (ym || currentYm()).split('-').map(Number)
  return { from: `${y}-${pad(m)}-01`, to: isoOf(new Date(y, m, 1)) }
}

function StatTile({ label, value, color, icon }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 2, flex: '0 0 auto', display: 'grid', placeItems: 'center', color: `${color}.main`, bgcolor: (t) => alpha(t.palette[color].main, t.palette.mode === 'dark' ? 0.22 : 0.12) }}>
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2, display: 'block' }}>{label}</Typography>
          <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }} noWrap>{value}</Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

function EntryDialog({ kind, entry, onClose, onSaved, notify }) {
  const isExpense = kind === 'expense'
  const isEdit = Boolean(entry?.id)
  const dateField = isExpense ? 'paid_at' : 'received_at'
  const [form, setForm] = React.useState({
    label: entry?.label || '',
    description: entry?.description || '',
    amount: entry?.amount != null ? String(entry.amount) : '',
    date: entry?.[dateField] ? String(entry[dateField]).slice(0, 10) : '',
    is_recurring: Boolean(entry?.is_recurring),
    expense_type: entry?.expense_type || 'variable',
    client_id: entry?.client_id || '',
    contract_id: entry?.contract_id || '',
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Vínculo opcional (só receitas): busca de cliente (server-side) + contrato do cliente.
  const [selectedClient, setSelectedClient] = React.useState(
    entry?.client_id ? { id: entry.client_id, name: entry.client_name || `Cliente #${entry.client_id}` } : null
  )
  const [clientInput, setClientInput] = React.useState('')
  const [clientQuery, setClientQuery] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setClientQuery(clientInput.trim()), 300)
    return () => clearTimeout(t)
  }, [clientInput])
  const clientsQ = useQuery({
    queryKey: ['finance-clients', clientQuery],
    queryFn: () => clientsService.list({ pageSize: 50, q: clientQuery || undefined }),
    enabled: !isExpense,
    placeholderData: (prev) => prev,
  })
  const clientsResult = clientsQ.data || []
  const clientOptions = selectedClient && !clientsResult.some((c) => c.id === selectedClient.id)
    ? [selectedClient, ...clientsResult]
    : clientsResult

  const contractsQ = useQuery({ queryKey: ['finance-contracts', form.client_id], queryFn: () => contractsService.list({ clientId: form.client_id, pageSize: 500 }), enabled: !isExpense && Boolean(form.client_id) })
  const contracts = (contractsQ.data || []).filter((c) => Number(c.client_id) === Number(form.client_id))

  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        label: form.label.trim(),
        description: form.description.trim() || null,
        amount: Number(form.amount),
        [dateField]: form.date,
      }
      if (isExpense && !isEdit) payload.is_recurring = form.is_recurring
      if (isExpense) { payload.expense_type = form.expense_type; return isEdit ? financeService.updateExpense(entry.id, payload) : financeService.createExpense(payload) }
      payload.client_id = form.client_id || null
      payload.contract_id = form.contract_id || null
      return isEdit ? financeService.updateRevenue(entry.id, payload) : financeService.createRevenue(payload)
    },
    onSuccess: () => { notify('Lançamento salvo.'); onSaved(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error'),
  })

  const valid = form.label.trim().length >= 2 && Number.isFinite(Number(form.amount)) && Number(form.amount) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(form.date)

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {isEdit ? 'Editar' : 'Nova'} {isExpense ? 'despesa' : 'receita'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Nomenclatura" value={form.label} onChange={set('label')} required fullWidth />
          <TextField label="Descrição" value={form.description} onChange={set('description')} fullWidth multiline minRows={2} />
          <TextField label="Valor (R$)" type="number" inputProps={{ step: '0.01', min: 0 }} value={form.amount} onChange={set('amount')} required fullWidth />
          <TextField label={isExpense ? 'Data de pagamento' : 'Data de recebimento'} type="date" InputLabelProps={{ shrink: true }} value={form.date} onChange={set('date')} required fullWidth />
          {isExpense && (
            <TextField select label="Tipo de despesa" value={form.expense_type} onChange={set('expense_type')} fullWidth>
              <MenuItem value="variable">Variável</MenuItem>
              <MenuItem value="fixed">Fixa</MenuItem>
            </TextField>
          )}
          {isExpense && !isEdit && (
            <FormControlLabel
              control={<Switch checked={form.is_recurring} onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked }))} />}
              label="Despesa recorrente (gera automaticamente todo mês)"
            />
          )}
          {!isExpense && (
            <>
              <Autocomplete
                options={clientOptions}
                loading={clientsQ.isFetching}
                loadingText="Buscando…"
                noOptionsText={clientQuery ? 'Nenhum cliente encontrado' : 'Digite para buscar…'}
                getOptionLabel={(o) => o?.name || ''}
                value={selectedClient}
                onChange={(_e, v) => { setSelectedClient(v); setForm((f) => ({ ...f, client_id: v?.id || '', contract_id: '' })) }}
                onInputChange={(_e, val, reason) => { if (reason === 'input' || reason === 'clear') setClientInput(val) }}
                filterOptions={(x) => x}
                isOptionEqualToValue={(o, v) => o?.id === v?.id}
                renderInput={(params) => <TextField {...params} label="Cliente (opcional)" placeholder="Buscar cliente…" />}
              />
              {form.client_id && (
                <TextField select label="Contrato (opcional)" value={form.contract_id} onChange={set('contract_id')} fullWidth>
                  <MenuItem value=""><em>Nenhum</em></MenuItem>
                  {contracts.map((c) => <MenuItem key={c.id} value={c.id}>#{c.id} · {c.description || 'Contrato'}</MenuItem>)}
                </TextField>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

function validateRow(kind, r) {
  const errs = []
  if (!r.label || String(r.label).trim().length < 2) errs.push('nomenclatura')
  if (!Number.isFinite(r.amount) || r.amount < 0) errs.push('valor')
  const df = kind === 'expense' ? 'paid_at' : 'received_at'
  if (!r[df]) errs.push('data')
  return errs
}

// Normaliza uma linha editável para o item enviado ao backend.
function toItem(kind, r) {
  const df = kind === 'expense' ? 'paid_at' : 'received_at'
  const amount = typeof r.amount === 'number'
    ? r.amount
    : Number(String(r.amount ?? '').replace(/\s/g, '').replace(',', '.'))
  const item = {
    label: String(r.label ?? '').trim(),
    description: String(r.description ?? '').trim() || null,
    amount,
    [df]: r[df] || null,
  }
  if (kind === 'expense') { item.is_recurring = !!r.is_recurring; item.expense_type = r.expense_type || 'variable' }
  return item
}

function ImportPreviewDialog({ kind, rows, onClose, onConfirm, submitting }) {
  const isExpense = kind === 'expense'
  const df = isExpense ? 'paid_at' : 'received_at'
  const [data, setData] = React.useState(() => rows.map((r) => ({
    label: r.label ?? '',
    description: r.description ?? '',
    amount: Number.isFinite(r.amount) ? r.amount : '',
    [df]: r[df] ?? '',
    ...(isExpense ? { is_recurring: !!r.is_recurring, expense_type: r.expense_type || 'variable' } : {}),
  })))
  const update = (i, field, value) => setData((d) => d.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))

  const items = data.map((r) => toItem(kind, r))
  const errsByRow = items.map((it) => validateRow(kind, it))
  const validItems = items.filter((_, i) => errsByRow[i].length === 0)
  const invalid = data.length - validItems.length

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Pré-visualização — {isExpense ? 'Despesas' : 'Receitas'}</DialogTitle>
      <DialogContent dividers sx={{ maxHeight: 560 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip color="success" variant="outlined" label={`${validItems.length} válida(s)`} />
          {invalid > 0 && <Chip color="error" variant="outlined" label={`${invalid} com problema`} />}
          <Chip variant="outlined" label={`${data.length} linha(s)`} />
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary">Edite as células para corrigir antes de importar.</Typography>
        </Stack>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 32 }}>#</TableCell>
                <TableCell>Nomenclatura</TableCell>
                <TableCell>Descrição</TableCell>
                <TableCell>Valor</TableCell>
                <TableCell>{isExpense ? 'Pagamento' : 'Recebimento'}</TableCell>
                {isExpense && <TableCell>Recorrente</TableCell>}
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((r, i) => {
                const errs = errsByRow[i]
                return (
                  <TableRow key={i}>
                    <TableCell sx={{ color: 'text.disabled' }}>{i + 1}</TableCell>
                    <TableCell><TextField size="small" variant="standard" value={r.label} onChange={(e) => update(i, 'label', e.target.value)} error={errs.includes('nomenclatura')} sx={{ minWidth: 140 }} /></TableCell>
                    <TableCell><TextField size="small" variant="standard" value={r.description} onChange={(e) => update(i, 'description', e.target.value)} sx={{ minWidth: 160 }} /></TableCell>
                    <TableCell><TextField size="small" variant="standard" type="number" inputProps={{ step: '0.01', min: 0 }} value={r.amount} onChange={(e) => update(i, 'amount', e.target.value)} error={errs.includes('valor')} sx={{ width: 110 }} /></TableCell>
                    <TableCell><TextField size="small" variant="standard" type="date" value={r[df]} onChange={(e) => update(i, df, e.target.value)} error={errs.includes('data')} sx={{ width: 150 }} InputLabelProps={{ shrink: true }} /></TableCell>
                    {isExpense && <TableCell><Switch size="small" checked={!!r.is_recurring} onChange={(e) => update(i, 'is_recurring', e.target.checked)} /></TableCell>}
                    <TableCell>
                      {errs.length === 0
                        ? <Chip size="small" color="success" variant="outlined" label="OK" />
                        : <Chip size="small" color="error" variant="outlined" label={errs.join(', ')} />}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!validItems.length || submitting} onClick={() => onConfirm(validItems)}>
          Importar {validItems.length} válida(s)
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function RevenuesTab({ notify, range, canManage }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [dialog, setDialog] = React.useState(null)
  const q = useQuery({ queryKey: ['finance-revenues', range.from, range.to], queryFn: () => financeService.revenues(range) })
  const items = q.data?.items || []
  const refresh = () => { qc.invalidateQueries({ queryKey: ['finance-revenues'] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }) }
  const del = useMutation({ mutationFn: (id) => financeService.deleteRevenue(id), onSuccess: () => { notify('Receita excluída.'); refresh() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error') })

  const handleDelete = async (row) => {
    const ok = await confirm({ title: 'Excluir receita', description: `Excluir "${row.label}"?`, confirmText: 'Excluir', tone: 'danger' })
    if (ok) del.mutate(row.id)
  }

  const fileRef = React.useRef()
  const [preview, setPreview] = React.useState(null)
  const importMut = useMutation({
    mutationFn: (items) => financeService.importRevenues(items),
    onSuccess: (r) => { notify(`Importadas ${r.imported} receita(s)${r.skipped ? `, ${r.skipped} ignorada(s)` : ''}.`, r.imported ? 'success' : 'warning'); refresh(); setPreview(null) },
    onError: (e) => notify(e?.response?.data?.error || e.message || 'Falha ao importar.', 'error'),
  })
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    try {
      const rows = await parseFile('revenue', f)
      if (!rows.length) { notify('Planilha vazia ou sem linhas válidas.', 'warning'); return }
      setPreview(rows)
    } catch { notify('Falha ao ler a planilha.', 'error') }
  }

  return (
    <>
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
        <input type="file" hidden ref={fileRef} accept=".xlsx,.xls,.csv" onChange={onFile} />
        <Button variant="text" startIcon={<DownloadIcon />} onClick={() => downloadModelo('revenue')}>Baixar modelo</Button>
        {canManage && <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()} disabled={importMut.isPending}>Importar</Button>}
        {canManage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>Nova receita</Button>}
      </Box>
      <Divider />
      <Box sx={{ overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Nomenclatura</TableCell>
              <TableCell>Descrição</TableCell>
              <TableCell align="right">Valor</TableCell>
              <TableCell>Recebido em</TableCell>
              <TableCell>Auditoria</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }}>{r.label}</Typography>
                  {(r.client_name || r.contract_description) && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {[r.client_name, r.contract_description].filter(Boolean).join(' · ')}
                    </Typography>
                  )}
                </TableCell>
                <TableCell><Typography variant="body2" color="text.secondary">{r.description || '-'}</Typography></TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>{BRL(r.amount)}</TableCell>
                <TableCell>{fmtDate(r.received_at)}</TableCell>
                <TableCell><AuditInfo createdByName={r.created_by_name} createdAt={r.created_at} updatedByName={r.updated_by_name} updatedAt={r.updated_at} /></TableCell>
                <TableCell align="right">
                  {canManage ? (
                    <>
                      <IconButton size="small" onClick={() => setDialog(r)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDelete(r)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                    </>
                  ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                </TableCell>
              </TableRow>
            ))}
            {!items.length && <TableRow><TableCell colSpan={6}><Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>Nenhuma receita.</Box></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>
      {dialog && <EntryDialog kind="revenue" entry={dialog.id ? dialog : null} onClose={() => setDialog(null)} onSaved={refresh} notify={notify} />}
      {preview && <ImportPreviewDialog kind="revenue" rows={preview} onClose={() => setPreview(null)} onConfirm={(items) => importMut.mutate(items)} submitting={importMut.isPending} />}
    </>
  )
}

function ExpensesTab({ notify, range, canManage }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [dialog, setDialog] = React.useState(null)
  const q = useQuery({ queryKey: ['finance-expenses', range.from, range.to], queryFn: () => financeService.expenses(range) })
  const items = q.data?.items || []
  const refresh = () => { qc.invalidateQueries({ queryKey: ['finance-expenses'] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }) }
  const del = useMutation({ mutationFn: (id) => financeService.deleteExpense(id), onSuccess: () => { notify('Despesa excluída.'); refresh() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error') })
  const stop = useMutation({ mutationFn: (id) => financeService.setExpenseRecurrence(id, false), onSuccess: () => { notify('Recorrência encerrada.'); refresh() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao encerrar.', 'error') })

  const handleDelete = async (row) => {
    const ok = await confirm({ title: 'Excluir despesa', description: `Excluir "${row.label}" (${fmtDate(row.paid_at)})?`, confirmText: 'Excluir', tone: 'danger' })
    if (ok) del.mutate(row.id)
  }
  const handleStop = async (row) => {
    const ok = await confirm({ title: 'Encerrar recorrência', description: `Parar de gerar "${row.label}" nos próximos meses? Os lançamentos já feitos permanecem.`, confirmText: 'Encerrar', tone: 'danger' })
    if (ok) stop.mutate(row.id)
  }

  const fileRef = React.useRef()
  const [preview, setPreview] = React.useState(null)
  const importMut = useMutation({
    mutationFn: (items) => financeService.importExpenses(items),
    onSuccess: (r) => { notify(`Importadas ${r.imported} despesa(s)${r.skipped ? `, ${r.skipped} ignorada(s)` : ''}.`, r.imported ? 'success' : 'warning'); refresh(); setPreview(null) },
    onError: (e) => notify(e?.response?.data?.error || e.message || 'Falha ao importar.', 'error'),
  })
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    try {
      const rows = await parseFile('expense', f)
      if (!rows.length) { notify('Planilha vazia ou sem linhas válidas.', 'warning'); return }
      setPreview(rows)
    } catch { notify('Falha ao ler a planilha.', 'error') }
  }

  const recurrenceChip = (r) => {
    if (r.recurrence_of) return <Chip label="Gerado" size="small" variant="outlined" />
    if (r.is_recurring && r.recurrence_active) return <Chip label="Recorrente" size="small" color="info" variant="outlined" icon={<EventRepeatIcon />} />
    if (r.is_recurring && !r.recurrence_active) return <Chip label="Recorrência encerrada" size="small" variant="outlined" />
    return <Typography variant="caption" color="text.secondary">Avulsa</Typography>
  }

  return (
    <>
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
        <input type="file" hidden ref={fileRef} accept=".xlsx,.xls,.csv" onChange={onFile} />
        <Button variant="text" startIcon={<DownloadIcon />} onClick={() => downloadModelo('expense')}>Baixar modelo</Button>
        {canManage && <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()} disabled={importMut.isPending}>Importar</Button>}
        {canManage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>Nova despesa</Button>}
      </Box>
      <Divider />
      <Box sx={{ overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Nomenclatura</TableCell>
              <TableCell>Descrição</TableCell>
              <TableCell align="right">Valor</TableCell>
              <TableCell>Pago em</TableCell>
              <TableCell>Tipo</TableCell>
              <TableCell>Recorrência</TableCell>
              <TableCell>Auditoria</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell><Typography sx={{ fontWeight: 600 }}>{r.label}</Typography></TableCell>
                <TableCell><Typography variant="body2" color="text.secondary">{r.description || '-'}</Typography></TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>{BRL(r.amount)}</TableCell>
                <TableCell>{fmtDate(r.paid_at)}</TableCell>
                <TableCell>
                  <Chip label={r.expense_type === 'fixed' ? 'Fixa' : 'Variável'} size="small" variant="outlined"
                    color={r.expense_type === 'fixed' ? 'default' : 'warning'} />
                </TableCell>
                <TableCell>{recurrenceChip(r)}</TableCell>
                <TableCell><AuditInfo createdByName={r.created_by_name} createdAt={r.created_at} updatedByName={r.updated_by_name} updatedAt={r.updated_at} /></TableCell>
                <TableCell align="right">
                  {canManage ? (
                    <>
                      {r.is_recurring && r.recurrence_active && (
                        <Tooltip title="Encerrar recorrência">
                          <IconButton size="small" color="warning" onClick={() => handleStop(r)}><EventRepeatIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      )}
                      <IconButton size="small" onClick={() => setDialog(r)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDelete(r)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                    </>
                  ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                </TableCell>
              </TableRow>
            ))}
            {!items.length && <TableRow><TableCell colSpan={8}><Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>Nenhuma despesa.</Box></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>
      {dialog && <EntryDialog kind="expense" entry={dialog.id ? dialog : null} onClose={() => setDialog(null)} onSaved={refresh} notify={notify} />}
      {preview && <ImportPreviewDialog kind="expense" rows={preview} onClose={() => setPreview(null)} onConfirm={(items) => importMut.mutate(items)} submitting={importMut.isPending} />}
    </>
  )
}

function ExpenseSplitBar({ fixed, variable }) {
  const f = Number(fixed) || 0
  const v = Number(variable) || 0
  const total = f + v
  const fp = total ? (f / total) * 100 : 0
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent sx={{ py: 1.5 }}>
        <Typography variant="overline" color="text.secondary">Despesas por tipo</Typography>
        <Box sx={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', bgcolor: 'action.hover', my: 1 }}>
          <Box sx={{ width: `${fp}%`, bgcolor: 'error.main' }} />
          <Box sx={{ width: `${100 - fp}%`, bgcolor: 'warning.main' }} />
        </Box>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main' }} />
            <Typography variant="body2">Fixas: <b>{BRL(f)}</b></Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'warning.main' }} />
            <Typography variant="body2">Variáveis: <b>{BRL(v)}</b></Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

function EditPaidDialog({ row, onClose, onSaved, notify }) {
  const [amount, setAmount] = React.useState(String(row.amount ?? ''))
  const mut = useMutation({
    mutationFn: () => financeService.updatePaidContract(row.billing_id, Number(amount)),
    onSuccess: () => { notify('Valor atualizado.'); onSaved(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error'),
  })
  const valid = Number.isFinite(Number(amount)) && Number(amount) >= 0
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Editar valor pago</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Cobrança #{row.billing_id} · {row.client_name}</Typography>
        <TextField label="Valor (R$)" type="number" inputProps={{ step: '0.01', min: 0 }} value={amount} onChange={(e) => setAmount(e.target.value)} fullWidth autoFocus />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

function PaidContractsTab({ notify, range, canManage }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editRow, setEditRow] = React.useState(null)
  const q = useQuery({ queryKey: ['finance-paid', range.from, range.to], queryFn: () => financeService.paidContracts(range) })
  const items = q.data?.items || []
  const refresh = () => { qc.invalidateQueries({ queryKey: ['finance-paid'] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }) }
  const reverse = useMutation({
    mutationFn: (id) => financeService.reversePaidContract(id),
    onSuccess: () => { notify('Cobrança estornada (voltou a pendente).'); refresh() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao estornar.', 'error'),
  })
  const handleReverse = async (row) => {
    const ok = await confirm({ title: 'Estornar cobrança', description: `Estornar a cobrança #${row.billing_id} de "${row.client_name}"? Ela volta a pendente e sai da receita.`, confirmText: 'Estornar', tone: 'danger' })
    if (ok) reverse.mutate(row.billing_id)
  }
  return (
    <>
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Contratos pagos no período — entram na receita. Edite o valor ou estorne.</Typography>
      </Box>
      <Divider />
      <Box sx={{ overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Cliente</TableCell>
              <TableCell>Contrato</TableCell>
              <TableCell align="right">Valor</TableCell>
              <TableCell>Pago em</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.billing_id} hover>
                <TableCell><Typography sx={{ fontWeight: 600 }}>{r.client_name}</Typography></TableCell>
                <TableCell><Typography variant="body2" color="text.secondary">#{r.contract_id} · {r.contract_description || 'Contrato'}</Typography></TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>{BRL(r.amount)}</TableCell>
                <TableCell>{fmtDate(r.gateway_paid_at || r.billing_date)}</TableCell>
                <TableCell align="right">
                  {canManage ? (
                    <>
                      <Tooltip title="Editar valor"><IconButton size="small" onClick={() => setEditRow(r)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Estornar"><IconButton size="small" color="warning" onClick={() => handleReverse(r)}><DeleteSweepIcon fontSize="small" /></IconButton></Tooltip>
                    </>
                  ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                </TableCell>
              </TableRow>
            ))}
            {!items.length && <TableRow><TableCell colSpan={5}><Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>Nenhum contrato pago no período.</Box></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>
      {editRow && <EditPaidDialog row={editRow} onClose={() => setEditRow(null)} onSaved={refresh} notify={notify} />}
    </>
  )
}

// ===================== RESUMO GERENCIAL (DRE mensal derivado) =====================
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const fmtPct = (x) => (x == null || Number.isNaN(x) ? '—' : `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const fmtCount = (x) => (x == null || Number.isNaN(x) ? '—' : Number(x).toLocaleString('pt-BR', { maximumFractionDigits: 1 }))
const monthLabel = (ym, showYear) => { const [y, m] = ym.split('-').map(Number); return MESES[m - 1] + (showYear ? `/${String(y).slice(2)}` : '') }
const addMonthsYm = (ym, delta) => { const [y, m] = ym.split('-').map(Number); const idx = y * 12 + (m - 1) + delta; return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}` }

// Deriva as 10 métricas a partir dos 4 valores-base de uma coluna (mês ou
// coluna transversal). As razões (honorário médio, margem, AV%) são SEMPRE
// recalculadas a partir dos valores-base desta coluna — nunca médias de %.
function deriveMetrics(b) {
  const num = (x) => (x == null || Number.isNaN(x) ? null : Number(x))
  const H = num(b.honorarios), F = num(b.despesasFixas), V = num(b.despesasVariaveis), N = num(b.contratosAtivos)
  const totalDespesas = (F == null && V == null) ? null : Number(F || 0) + Number(V || 0)
  const lucro = (H == null || totalDespesas == null) ? null : H - totalDespesas
  const ratio = (a, den) => (a == null || den == null || den === 0 ? null : a / den)
  return {
    honorarios: H, contratosAtivos: N, honorarioMedio: ratio(H, N),
    despesasFixas: F, despesasVariaveis: V, totalDespesas, lucro,
    margem: ratio(lucro, H), avFixas: ratio(F, H), avVariaveis: ratio(V, H),
  }
}

const METRIC_ROWS = [
  { group: 'Receita' },
  { key: 'honorarios', label: 'Honorários', kind: 'money' },
  { key: 'contratosAtivos', label: 'Contratos ativos', kind: 'count' },
  { key: 'honorarioMedio', label: 'Honorário médio', kind: 'money' },
  { group: 'Despesas' },
  { key: 'despesasFixas', label: 'Despesas fixas', kind: 'money' },
  { key: 'despesasVariaveis', label: 'Despesas variáveis', kind: 'money' },
  { key: 'totalDespesas', label: 'Total de despesas', kind: 'money', strong: true },
  { group: 'Resultado' },
  { key: 'lucro', label: 'Lucro operacional', kind: 'money', strong: true },
  { key: 'margem', label: 'Margem operacional', kind: 'pct' },
  { key: 'avFixas', label: 'AV% Despesas fixas', kind: 'pct' },
  { key: 'avVariaveis', label: 'AV% Despesas variáveis', kind: 'pct' },
]

function ResumoTab() {
  const nowYear = new Date().getFullYear()
  const [mode, setMode] = React.useState('year') // year | 90d | month
  const [year, setYear] = React.useState(nowYear)
  const [ym, setYm] = React.useState(currentYm())
  const years = Array.from({ length: 5 }, (_, i) => nowYear - i)

  const { fromYm, toYm } = React.useMemo(() => {
    if (mode === 'month') return { fromYm: ym, toYm: ym }
    if (mode === '90d') { const to = currentYm(); return { fromYm: addMonthsYm(to, -2), toYm: to } }
    return { fromYm: `${year}-01`, toYm: `${year}-12` }
  }, [mode, ym, year])

  const q = useQuery({
    queryKey: ['finance-summary-annual', fromYm, toYm],
    queryFn: () => financeService.summaryAnnual({ fromYm, toYm }),
    placeholderData: (prev) => prev,
  })
  const months = q.data?.months || []

  // Colunas transversais por modo. Mês avulso não consolida.
  const crossCols = mode === 'year'
    ? [{ key: 'total', label: 'Total anual' }, { key: 'media', label: 'Média' }, { key: 'proj', label: 'Projeção' }]
    : mode === '90d'
      ? [{ key: 'total', label: 'Total (90d)' }, { key: 'media', label: 'Média' }]
      : []

  const model = React.useMemo(() => {
    const closed = months.filter((m) => m.closed)
    const sum = (f) => months.reduce((a, m) => a + Number(m[f] || 0), 0)
    const avgClosed = (f) => (closed.length ? closed.reduce((a, m) => a + Number(m[f] || 0), 0) / closed.length : null)
    const lastClosedCount = closed.length ? closed[closed.length - 1].contratosAtivos : null
    const avgClosedCount = avgClosed('contratosAtivos')

    const bases = {
      total: { honorarios: sum('honorarios'), despesasFixas: sum('despesasFixas'), despesasVariaveis: sum('despesasVariaveis'), contratosAtivos: lastClosedCount },
      media: { honorarios: avgClosed('honorarios'), despesasFixas: avgClosed('despesasFixas'), despesasVariaveis: avgClosed('despesasVariaveis'), contratosAtivos: avgClosedCount },
      proj: { honorarios: avgClosed('honorarios') == null ? null : avgClosed('honorarios') * 12, despesasFixas: avgClosed('despesasFixas') == null ? null : avgClosed('despesasFixas') * 12, despesasVariaveis: avgClosed('despesasVariaveis') == null ? null : avgClosed('despesasVariaveis') * 12, contratosAtivos: lastClosedCount },
    }
    const showYearSuffix = new Set(months.map((m) => m.ym.slice(0, 4))).size > 1
    const monthCols = months.map((m) => ({ key: m.ym, label: monthLabel(m.ym, showYearSuffix), open: !m.closed, derived: deriveMetrics(m) }))
    const crossDerived = crossCols.map((c) => ({ ...c, isCross: true, derived: deriveMetrics(bases[c.key]) }))
    return { cols: [...monthCols, ...crossDerived], hasClosed: closed.length > 0 }
  }, [months, crossCols])

  const fmtCell = (metric, col) => {
    const v = col.derived[metric.key]
    if (metric.kind === 'count') return col.key === 'proj' ? '—' : fmtCount(v)
    if (metric.kind === 'pct') return fmtPct(v)
    return v == null ? '—' : BRL(v)
  }

  const periodControl = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
      <TextField select size="small" label="Período" value={mode} onChange={(e) => setMode(e.target.value)} sx={{ minWidth: 160 }}>
        <MenuItem value="month">Mensal</MenuItem>
        <MenuItem value="90d">Últimos 90 dias</MenuItem>
        <MenuItem value="year">Anual</MenuItem>
      </TextField>
      {mode === 'month' && <TextField type="month" size="small" label="Mês" value={ym} onChange={(e) => setYm(e.target.value)} InputLabelProps={{ shrink: true }} />}
      {mode === 'year' && (
        <TextField select size="small" label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))} sx={{ minWidth: 110 }}>
          {years.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
        </TextField>
      )}
    </Stack>
  )

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        <Typography variant="subtitle2" color="text.secondary">Indicadores derivados de receitas, despesas e contratos ativos.</Typography>
        {periodControl}
      </Stack>

      {q.isError && <Alert severity="error" sx={{ mb: 2 }}>Não foi possível carregar o resumo.</Alert>}
      {!q.isLoading && months.length === 0 && !q.isError && <Alert severity="info">Sem dados no período selecionado.</Alert>}

      {months.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 480, '& td, & th': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 2, fontWeight: 700 }}>Indicador</TableCell>
                {model.cols.map((c) => (
                  <TableCell key={c.key} align="right" sx={{ fontWeight: 700, color: c.isCross ? 'primary.main' : c.open ? 'text.disabled' : 'text.primary', fontStyle: c.open ? 'italic' : 'normal' }}>
                    {c.isCross ? c.label : (
                      <Tooltip title={c.open ? 'Mês em aberto — não entra na Média/Projeção' : ''} disableHoverListener={!c.open}>
                        <span>{c.label}{c.open ? ' *' : ''}</span>
                      </Tooltip>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {METRIC_ROWS.map((row, i) => row.group ? (
                <TableRow key={`g-${i}`}>
                  <TableCell colSpan={model.cols.length + 1} sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.06), fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.secondary', py: 0.5 }}>{row.group}</TableCell>
                </TableRow>
              ) : (
                <TableRow key={row.key} hover>
                  <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, fontWeight: row.strong ? 700 : 500 }}>{row.label}</TableCell>
                  {model.cols.map((c) => (
                    <TableCell key={c.key} align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: row.strong || c.isCross ? 700 : 400, color: c.isCross ? 'primary.main' : (c.open ? 'text.secondary' : 'text.primary') }}>
                      {fmtCell(row, c)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {months.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Honorários = receitas lançadas + contratos pagos no mês. Contratos ativos = snapshot no último dia do mês.
          {' '}Meses em aberto (*) não entram na Média nem na Projeção.
          {crossCols.some((c) => c.key === 'media') && ' Média = média dos meses fechados.'}
          {mode === 'year' && ' Projeção = média mensal × 12. Total de contratos ativos = último mês fechado (não é soma). Razões (honorário médio, margem, AV%) são recalculadas a partir dos totais.'}
        </Typography>
      )}
    </Box>
  )
}

export default function FinancePage() {
  const { selectedCompanyId } = useAuth()
  const { can } = usePermissions()
  const canRevView = can('finance.revenues.view')
  const canRevManage = can('finance.revenues.manage')
  const canExpView = can('finance.expenses.view')
  const canExpManage = can('finance.expenses.manage')
  const canResumoView = can('finance.resumo.view')
  const canView = canRevView || canExpView || canResumoView
  const enabled = Number.isInteger(selectedCompanyId)
  const [tab, setTab] = React.useState(0)
  const [toast, setToast] = React.useState(null)
  const notify = (msg, severity = 'success') => setToast({ msg, severity })

  const nowYear = new Date().getFullYear()
  const [periodType, setPeriodType] = React.useState('month')
  const [ym, setYm] = React.useState(currentYm())
  const [year, setYear] = React.useState(nowYear)
  const range = React.useMemo(() => computeRange(periodType, ym, year), [periodType, ym, year])

  const summaryQ = useQuery({
    queryKey: ['finance-summary', range.from, range.to],
    queryFn: () => financeService.summary(range),
    enabled: enabled && (canRevView || canExpView),
  })

  if (!canView) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Gerenciador Financeiro" />
        <Alert severity="warning">Seu perfil não tem permissão para acessar o Gerenciador Financeiro.</Alert>
      </Stack>
    )
  }
  if (!enabled) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Gerenciador Financeiro" subtitle="Receitas e despesas da empresa." />
        <CompanyRequiredAlert />
      </Stack>
    )
  }

  const s = summaryQ.data
  const tileCount = (canRevView ? 1 : 0) + (canExpView ? 1 : 0) + (canRevView && canExpView ? 1 : 0)
  const tileMd = tileCount <= 1 ? 12 : tileCount === 2 ? 6 : 4
  const tabDefs = []
  if (canRevView) tabDefs.push({ key: 'rev', label: 'Receitas', render: () => <RevenuesTab notify={notify} range={range} canManage={canRevManage} /> })
  if (canExpView) tabDefs.push({ key: 'exp', label: 'Despesas', render: () => <ExpensesTab notify={notify} range={range} canManage={canExpManage} /> })
  if (canRevView) tabDefs.push({ key: 'paid', label: 'Contratos pagos', render: () => <PaidContractsTab notify={notify} range={range} canManage={canRevManage} /> })
  if (canResumoView) tabDefs.push({ key: 'resumo', label: 'Resumo', render: () => <ResumoTab /> })
  const activeTab = Math.min(tab, Math.max(tabDefs.length - 1, 0))
  const years = Array.from({ length: 5 }, (_, i) => nowYear - i)
  const periodControl = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
      <TextField select size="small" label="Período" value={periodType} onChange={(e) => setPeriodType(e.target.value)} sx={{ minWidth: 150 }}>
        <MenuItem value="month">Mês</MenuItem>
        <MenuItem value="90d">Últimos 90 dias</MenuItem>
        <MenuItem value="year">Ano</MenuItem>
      </TextField>
      {periodType === 'month' && (
        <TextField type="month" size="small" label="Mês" value={ym} onChange={(e) => setYm(e.target.value)} InputLabelProps={{ shrink: true }} />
      )}
      {periodType === 'year' && (
        <TextField select size="small" label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))} sx={{ minWidth: 110 }}>
          {years.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
        </TextField>
      )}
    </Stack>
  )

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="Gerenciador Financeiro"
        subtitle="Lance receitas e despesas da empresa (com recorrência mensal de despesas)."
        actions={periodControl}
      />

      <Grid container spacing={2}>
        {canRevView && <Grid item xs={12} md={tileMd}><StatTile label="Total de receitas" value={BRL(s?.totalRevenues)} color="success" icon={<TrendingUpIcon />} /></Grid>}
        {canExpView && <Grid item xs={12} md={tileMd}><StatTile label="Total de despesas" value={BRL(s?.totalExpenses)} color="error" icon={<TrendingDownIcon />} /></Grid>}
        {canRevView && canExpView && <Grid item xs={12} md={tileMd}><StatTile label="Saldo" value={BRL(s?.balance)} color={(s?.balance ?? 0) >= 0 ? 'success' : 'error'} icon={<PaymentsIcon />} /></Grid>}
      </Grid>
      {s && canRevView && (
        <Typography variant="caption" color="text.secondary">
          Receitas = lançamentos ({BRL(s.revenuesManual)}) + contratos pagos ({BRL(s.revenuesContracts)}) no período selecionado.
        </Typography>
      )}
      {s && canExpView && (s.fixedExpenses || s.variableExpenses) ? (
        <ExpenseSplitBar fixed={s.fixedExpenses} variable={s.variableExpenses} />
      ) : null}

      <PapperBlock title="Lançamentos" subtitle="Receitas e despesas no período" icon={<AccountBalanceIcon />} iconColor="linear-gradient(135deg,#059669,#10b981)" noPadding>
        <Box sx={{ px: 2, pt: 1 }}>
          <Tabs value={activeTab} onChange={(_e, v) => setTab(v)}>
            {tabDefs.map((t) => <Tab key={t.key} label={t.label} />)}
          </Tabs>
        </Box>
        <Divider />
        {tabDefs[activeTab]?.render()}
      </PapperBlock>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
