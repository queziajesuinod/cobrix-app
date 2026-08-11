import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, ClickAwayListener, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Menu, MenuItem, MenuList, Paper, Popper, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography, IconButton,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ViewKanbanIcon from '@mui/icons-material/ViewKanban'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight'
import HistoryIcon from '@mui/icons-material/History'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import ReplayIcon from '@mui/icons-material/Replay'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import SearchIcon from '@mui/icons-material/Search'
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff'
import SortIcon from '@mui/icons-material/Sort'
import SendIcon from '@mui/icons-material/Send'
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined'
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import ChecklistIcon from '@mui/icons-material/Checklist'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, closestCorners,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { useConfirm } from '@/components/ConfirmDialog'
import { tasksService } from './tasks.service'
import { clientsService } from '@/features/clients/clients.service'
import { contractsService } from '@/features/contracts/contracts.service'

// Prioridade: rótulo, cor do chip (MUI), peso p/ ordenação e cor da etiqueta/borda.
const PRIORITY = {
  baixa: { label: 'Baixa', color: 'default', weight: 0, bar: 'grey.400' },
  media: { label: 'Média', color: 'info', weight: 1, bar: 'info.main' },
  alta: { label: 'Alta', color: 'warning', weight: 2, bar: 'warning.main' },
  urgente: { label: 'Urgente', color: 'error', weight: 3, bar: 'error.main' },
}
const prioWeight = (p) => (PRIORITY[p]?.weight ?? 1)
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const WEEKDAYS_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const pad2 = (n) => String(n).padStart(2, '0')
const fmtDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10).split('-').reverse().join('/') : '')
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
// Estado do prazo (só p/ tarefa aberta): atrasada (vermelho) / vence hoje (âmbar).
const dueInfo = (node) => {
  if (!node.due_date) return null
  const key = String(node.due_date).slice(0, 10)
  const label = fmtDate(node.due_date)
  if (node.status === 'done') return { label, color: 'default', variant: 'outlined' }
  const t = todayISO()
  if (key < t) return { label: `Atrasada · ${label}`, color: 'error', variant: 'filled', alert: true }
  if (key === t) return { label: `Hoje · ${label}`, color: 'warning', variant: 'filled', alert: true }
  return { label, color: 'default', variant: 'outlined' }
}
const fmtDateTime = (v) => {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} às ${p(d.getHours())}:${p(d.getMinutes())}`
}
// Traduz o histórico (ação de sistema → frase amigável com ícone/cor).
function describeActivity(a) {
  const detail = a.detail || ''
  switch (a.action) {
    case 'created': return { Icon: AddCircleOutlineIcon, color: 'primary.main', text: detail.includes('subtarefa') ? 'Criou um subitem' : 'Criou a tarefa' }
    case 'moved': return detail === 'concluída'
      ? { Icon: CheckCircleIcon, color: 'success.main', text: 'Concluiu a tarefa' }
      : { Icon: SwapHorizIcon, color: 'info.main', text: 'Moveu de coluna' }
    case 'done': return { Icon: CheckCircleIcon, color: 'success.main', text: 'Concluiu a tarefa' }
    case 'reopened': return { Icon: ReplayIcon, color: 'warning.main', text: 'Reabriu a tarefa' }
    case 'edited': return { Icon: EditOutlinedIcon, color: 'text.secondary', text: 'Atualizou os dados' }
    case 'assigned': return { Icon: PersonOutlineIcon, color: 'info.main', text: 'Definiu o responsável' }
    case 'generated': return { Icon: AutorenewIcon, color: 'secondary.main', text: 'Gerou esta ocorrência', sub: detail }
    default: return { Icon: HistoryIcon, color: 'text.secondary', text: detail || a.action }
  }
}
const recurrenceLabel = (r, day, month) => (
  r === 'weekly' ? `Semanal · ${WEEKDAYS_FULL[day] || '—'}`
    : r === 'biweekly' ? `Quinzenal · ${WEEKDAYS_FULL[day] || '—'}`
      : r === 'monthly' ? `Mensal · dia ${day}`
        : r === 'yearly' ? `Anual · ${day}/${String(month).padStart(2, '0')}` : ''
)
const RECURRENCE_OPTS = [['none', 'Não repete'], ['weekly', 'Semanal'], ['biweekly', 'Quinzenal'], ['monthly', 'Mensal'], ['yearly', 'Anual']]
const isWeekly = (r) => r === 'weekly' || r === 'biweekly'

// Seletor opcional de cliente + contrato (contrato aparece após escolher o cliente).
function ClientContractPicker({ clientId, contractId, clientName, onChange }) {
  const [selectedClient, setSelectedClient] = React.useState(clientId ? { id: clientId, name: clientName || `Cliente #${clientId}` } : null)
  const [clientInput, setClientInput] = React.useState('')
  const [clientQuery, setClientQuery] = React.useState('')
  React.useEffect(() => { const t = setTimeout(() => setClientQuery(clientInput.trim()), 300); return () => clearTimeout(t) }, [clientInput])
  const clientsQ = useQuery({ queryKey: ['tasks-clients', clientQuery], queryFn: () => clientsService.list({ pageSize: 50, q: clientQuery || undefined }), placeholderData: (p) => p })
  const clientsResult = clientsQ.data || []
  const clientOptions = selectedClient && !clientsResult.some((c) => c.id === selectedClient.id) ? [selectedClient, ...clientsResult] : clientsResult
  const contractsQ = useQuery({ queryKey: ['tasks-contracts', clientId], queryFn: () => contractsService.list({ clientId, pageSize: 500 }), enabled: Boolean(clientId) })
  const contracts = (contractsQ.data || []).filter((c) => Number(c.client_id) === Number(clientId))
  return (
    <>
      <Autocomplete
        options={clientOptions}
        loading={clientsQ.isFetching}
        loadingText="Buscando…"
        noOptionsText={clientQuery ? 'Nenhum cliente' : 'Digite para buscar…'}
        getOptionLabel={(o) => o?.name || ''}
        value={selectedClient}
        onChange={(_e, v) => { setSelectedClient(v); onChange({ client_id: v?.id || null, contract_id: null }) }}
        onInputChange={(_e, val, reason) => { if (reason === 'input' || reason === 'clear') setClientInput(val) }}
        filterOptions={(x) => x}
        isOptionEqualToValue={(o, v) => o?.id === v?.id}
        renderInput={(params) => <TextField {...params} label="Cliente (opcional)" placeholder="Buscar cliente…" />}
      />
      {clientId && (
        <TextField select label="Contrato (opcional)" value={contractId ? String(contractId) : ''}
          onChange={(e) => onChange({ client_id: clientId, contract_id: e.target.value ? Number(e.target.value) : null })} fullWidth>
          <MenuItem value=""><em>Nenhum</em></MenuItem>
          {contracts.map((c) => <MenuItem key={c.id} value={String(c.id)}>#{c.id} · {c.description || 'Contrato'}</MenuItem>)}
        </TextField>
      )}
    </>
  )
}

// Campos de recorrência reutilizáveis (criar/editar). `day` = dia da semana (0-6)
// p/ semanal/quinzenal; dia do mês (1-31) p/ mensal/anual.
function RecurrenceFields({ recurrence, day, month, onChange }) {
  const handleFreq = (e) => {
    const r = e.target.value
    const patch = { recurrence: r }
    if (isWeekly(r) && Number(day) > 6) patch.recurrence_day = '1'
    else if ((r === 'monthly' || r === 'yearly') && Number(day) < 1) patch.recurrence_day = '10'
    onChange(patch)
  }
  return (
    <>
      <TextField select label="Repetição" value={recurrence} onChange={handleFreq} fullWidth>
        {RECURRENCE_OPTS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
      </TextField>
      {isWeekly(recurrence) && (
        <TextField select label="Dia da semana" value={String(day)} onChange={(e) => onChange({ recurrence_day: e.target.value })} fullWidth
          helperText={recurrence === 'biweekly' ? 'A cada 2 semanas neste dia' : 'Toda semana neste dia'}>
          {WEEKDAYS_FULL.map((w, i) => <MenuItem key={i} value={String(i)}>{w}</MenuItem>)}
        </TextField>
      )}
      {recurrence === 'monthly' && (
        <TextField label="Dia do mês" type="number" inputProps={{ min: 1, max: 31 }} value={day} onChange={(e) => onChange({ recurrence_day: e.target.value })} fullWidth helperText="Todo mês neste dia" />
      )}
      {recurrence === 'yearly' && (
        <Stack direction="row" spacing={2}>
          <TextField label="Dia" type="number" inputProps={{ min: 1, max: 31 }} value={day} onChange={(e) => onChange({ recurrence_day: e.target.value })} fullWidth />
          <TextField select label="Mês" value={String(month)} onChange={(e) => onChange({ recurrence_month: e.target.value })} fullWidth>
            {MONTHS.map((m, i) => <MenuItem key={i} value={String(i + 1)}>{m}</MenuItem>)}
          </TextField>
        </Stack>
      )}
    </>
  )
}

// Chips de exibição das etiquetas de uma tarefa.
function LabelChips({ labels, sx }) {
  if (!labels?.length) return null
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, ...sx }}>
      {labels.map((l) => (
        <Chip key={l.id} size="small" label={l.name} sx={{ height: 18, fontSize: 11, bgcolor: l.color, color: '#fff', '& .MuiChip-label': { px: 0.75 } }} />
      ))}
    </Stack>
  )
}

// Seletor de etiquetas (chips alternáveis).
function LabelPicker({ labels, selectedIds, onToggle }) {
  if (!labels.length) return <Typography variant="caption" color="text.secondary">Nenhuma etiqueta criada. Use “Etiquetas” no topo para criar.</Typography>
  const sel = new Set(selectedIds)
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      {labels.map((l) => {
        const on = sel.has(l.id)
        return (
          <Chip key={l.id} size="small" label={l.name} onClick={() => onToggle(l.id)} variant={on ? 'filled' : 'outlined'}
            sx={{ height: 24, borderColor: l.color, bgcolor: on ? l.color : 'transparent', color: on ? '#fff' : 'text.primary', '&:hover': { bgcolor: on ? l.color : 'action.hover' } }} />
        )
      })}
    </Stack>
  )
}

// Gerenciar etiquetas da empresa (criar/editar/excluir).
function LabelsDialog({ onClose, notify, onChanged }) {
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['tasks-labels'], queryFn: () => tasksService.labels() })
  const items = q.data?.items || []
  const [form, setForm] = React.useState({ id: null, name: '', color: '#3b82f6' })
  const reset = () => setForm({ id: null, name: '', color: '#3b82f6' })
  const save = useMutation({
    mutationFn: () => (form.id ? tasksService.updateLabel(form.id, { name: form.name.trim(), color: form.color }) : tasksService.createLabel({ name: form.name.trim(), color: form.color })),
    onSuccess: () => { reset(); q.refetch(); onChanged() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar etiqueta.', 'error'),
  })
  const del = useMutation({
    mutationFn: (id) => tasksService.deleteLabel(id),
    onSuccess: () => { reset(); q.refetch(); onChanged() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error'),
  })
  const handleDel = async (l) => {
    const ok = await confirm({ title: 'Excluir etiqueta', description: `Excluir "${l.name}"? Ela será removida de todas as tarefas.`, confirmText: 'Excluir', tone: 'danger' })
    if (ok) del.mutate(l.id)
  }
  const PALETTE = ['#ef4444', '#f59e0b', '#eab308', '#10b981', '#0ea5e9', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#78716c']
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Etiquetas</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1} sx={{ mb: 2 }}>
          {items.length === 0 ? <Typography variant="caption" color="text.secondary">Nenhuma etiqueta ainda.</Typography>
            : items.map((l) => (
              <Stack key={l.id} direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: l.color, flexShrink: 0 }} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }} noWrap onClick={() => setForm({ id: l.id, name: l.name, color: l.color })}>{l.name}</Typography>
                <IconButton size="small" onClick={() => setForm({ id: l.id, name: l.name, color: l.color })}><EditOutlinedIcon fontSize="small" /></IconButton>
                <IconButton size="small" color="error" onClick={() => handleDel(l)}><DeleteOutlineIcon fontSize="small" /></IconButton>
              </Stack>
            ))}
        </Stack>
        <Divider sx={{ mb: 2 }}><Typography variant="caption" color="text.secondary">{form.id ? 'Editar' : 'Nova'} etiqueta</Typography></Divider>
        <Stack spacing={1.5}>
          <TextField size="small" label="Nome" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth autoFocus />
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {PALETTE.map((c) => (
              <Box key={c} onClick={() => setForm((f) => ({ ...f, color: c }))}
                sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: c, cursor: 'pointer', border: '2px solid', borderColor: form.color === c ? 'text.primary' : 'transparent' }} />
            ))}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {form.id && <Button onClick={reset} color="inherit">Cancelar edição</Button>}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} color="inherit">Fechar</Button>
        <Button variant="contained" disableElevation disabled={form.name.trim().length < 1 || save.isPending} onClick={() => save.mutate()}>{form.id ? 'Salvar' : 'Adicionar'}</Button>
      </DialogActions>
    </Dialog>
  )
}

// Criar/renomear uma COLUNA do quadro (task_stage). Sem `initial` = nova coluna.
function ColumnDialog({ initial, onClose, onSaved, notify }) {
  const [name, setName] = React.useState(initial?.name || '')
  const editing = Boolean(initial)
  const mut = useMutation({
    mutationFn: () => (editing ? tasksService.updateStage(initial.id, { name: name.trim() }) : tasksService.createStage({ name: name.trim() })),
    onSuccess: () => { notify(editing ? 'Coluna renomeada.' : 'Coluna criada.'); onSaved(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar a coluna.', 'error'),
  })
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{editing ? 'Renomear coluna' : 'Nova coluna'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Nome da coluna" value={name} onChange={(e) => setName(e.target.value)} fullWidth autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim().length >= 1 && !mut.isPending) mut.mutate() }} />
          <Typography variant="caption" color="text.secondary">Colunas são etapas ou rotinas do quadro. Arraste-as para reordenar.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={name.trim().length < 1 || mut.isPending} onClick={() => mut.mutate()}>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

function TaskDialog({ stages, users, labels = [], onClose, onSaved, notify }) {
  const [form, setForm] = React.useState({
    title: '', description: '', assignee_id: '', priority: 'media', due_date: '', stage_id: stages[0]?.id ? String(stages[0].id) : '',
    recurrence: 'none', recurrence_day: '10', recurrence_month: '1', client_id: null, contract_id: null, label_ids: [],
  })
  const toggleLabel = (id) => setForm((f) => ({ ...f, label_ids: f.label_ids.includes(id) ? f.label_ids.filter((x) => x !== id) : [...f.label_ids, id] }))
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const recurring = form.recurrence !== 'none'
  const mut = useMutation({
    mutationFn: () => tasksService.createNode({
      title: form.title.trim(),
      description: form.description.trim() || null,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
      priority: form.priority,
      due_date: recurring ? null : (form.due_date || null),
      stage_id: form.stage_id ? Number(form.stage_id) : null,
      recurrence: form.recurrence,
      recurrence_day: recurring ? Number(form.recurrence_day) : null,
      recurrence_month: form.recurrence === 'yearly' ? Number(form.recurrence_month) : null,
      ...(form.client_id ? { client_id: form.client_id, contract_id: form.contract_id || null } : {}),
      ...(form.label_ids.length ? { label_ids: form.label_ids } : {}),
    }),
    onSuccess: () => { notify('Tarefa criada.'); onSaved(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao criar tarefa.', 'error'),
  })
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Nova tarefa</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Descrição da tarefa" value={form.title} onChange={set('title')} fullWidth autoFocus />
          <TextField label="Detalhes" value={form.description} onChange={set('description')} fullWidth multiline minRows={2} />
          <TextField select label="Responsável" value={form.assignee_id} onChange={set('assignee_id')} fullWidth>
            <MenuItem value=""><em>Sem responsável</em></MenuItem>
            {users.map((u) => <MenuItem key={u.id} value={String(u.id)}>{u.name}</MenuItem>)}
          </TextField>
          <TextField select label="Prioridade" value={form.priority} onChange={set('priority')} fullWidth>
            {Object.entries(PRIORITY).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
          </TextField>
          <RecurrenceFields recurrence={form.recurrence} day={form.recurrence_day} month={form.recurrence_month} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
          {!recurring && (
            <TextField label="Prazo" type="date" value={form.due_date} onChange={set('due_date')} InputLabelProps={{ shrink: true }} fullWidth />
          )}
          <TextField select label="Coluna" value={form.stage_id} onChange={set('stage_id')} fullWidth>
            {stages.map((s) => <MenuItem key={s.id} value={String(s.id)}>{s.name}</MenuItem>)}
          </TextField>
          <ClientContractPicker clientId={form.client_id} contractId={form.contract_id} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
          {labels.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Etiquetas</Typography>
              <LabelPicker labels={labels} selectedIds={form.label_ids} onToggle={toggleLabel} />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={form.title.trim().length < 2 || mut.isPending} onClick={() => mut.mutate()}>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

// Cartão arrastável (@dnd-kit useDraggable). Borda esquerda + chip pela prioridade.
function TaskCard({ node, canManage, onOpen, onChanged, notify }) {
  const confirm = useConfirm()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card-${node.id}`, data: { type: 'card', nodeId: node.id, fromStageId: node.stage_id },
  })
  const toggle = useMutation({
    mutationFn: () => tasksService.toggleNode(node.id, node.status !== 'done'),
    onSuccess: () => onChanged(),
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao atualizar.', 'error'),
  })
  const del = useMutation({
    mutationFn: () => tasksService.deleteNode(node.id),
    onSuccess: () => onChanged(),
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error'),
  })
  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Excluir tarefa',
      description: `Excluir "${node.title}"${node.sub_total > 0 ? ' e seus subitens' : ''}? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir', tone: 'danger',
    })
    if (ok) del.mutate()
  }
  const p = PRIORITY[node.priority] || PRIORITY.media
  const done = node.status === 'done'
  const di = dueInfo(node)
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <Card
      ref={setNodeRef}
      style={style}
      variant="outlined"
      {...listeners}
      {...attributes}
      sx={{
        borderRadius: 2, mb: 1, opacity: isDragging ? 0.4 : (done ? 0.7 : 1),
        cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' },
        borderLeft: 4, borderLeftColor: p.bar,
      }}
    >
      <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
        <Stack direction="row" alignItems="flex-start" spacing={0.5}>
          <Tooltip title={done ? 'Reabrir' : 'Concluir'}>
            <IconButton size="small" color={done ? 'success' : 'default'} onClick={() => toggle.mutate()} sx={{ p: 0.25 }}>
              {done ? <CheckCircleIcon fontSize="small" /> : <RadioButtonUncheckedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="body2"
              onClick={() => onOpen?.(node.id)}
              sx={{ fontWeight: 600, textDecoration: done ? 'line-through' : 'none', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >{node.title}</Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
              <Chip size="small" label={p.label} color={p.color} sx={{ height: 20, fontWeight: 600 }} />
              {di && <Chip size="small" label={di.label} color={di.color} variant={di.variant} sx={{ height: 20, fontWeight: di.alert ? 700 : 400 }} />}
              {node.sub_total > 0 && <Chip size="small" label={`${node.sub_done}/${node.sub_total}`} variant="outlined" sx={{ height: 20 }} />}
              {node.assignee_name && <Typography variant="caption" color="text.secondary" noWrap>{node.assignee_name}</Typography>}
            </Stack>
            {(node.client_name || node.contract_description) && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }}>
                🔗 {[node.client_name, node.contract_description].filter(Boolean).join(' · ')}
              </Typography>
            )}
            <LabelChips labels={node.labels} sx={{ mt: 0.5 }} />
          </Box>
          {canManage && (
            <IconButton size="small" color="error" onClick={handleDelete} sx={{ p: 0.25 }}><DeleteOutlineIcon fontSize="small" /></IconButton>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

// Casca visual da coluna (cabeçalho + cartões). O comportamento de arraste é injetado
// pelos wrappers: BoardColumn (sortable) p/ colunas abertas, DoneColumn (droppable) p/ Concluído.
function ColumnShell({ innerRef, style, isOver, stage, nodes, canManage, handleProps, onOpenNode, onRename, onDelete, onSortByPriority, onChanged, notify }) {
  const [menuEl, setMenuEl] = React.useState(null)
  return (
    <Box
      ref={innerRef}
      style={style}
      sx={{
        flex: '0 0 300px', width: 300, display: 'flex', flexDirection: 'column',
        bgcolor: 'action.hover', borderRadius: 2, maxHeight: '72vh',
        outline: isOver ? '2px dashed' : 'none', outlineColor: 'primary.main', outlineOffset: '-3px', transition: 'outline-color .12s',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
        {handleProps && (
          <Box {...handleProps} sx={{ display: 'flex', cursor: 'grab', touchAction: 'none', color: 'text.disabled', '&:active': { cursor: 'grabbing' } }}>
            <DragIndicatorIcon fontSize="small" />
          </Box>
        )}
        {stage.is_done && <CheckCircleIcon fontSize="small" sx={{ color: 'success.main' }} />}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 0, color: stage.is_done ? 'success.main' : 'text.primary' }} noWrap>{stage.name}</Typography>
        <Chip size="small" label={nodes.length} sx={{ height: 20 }} />
        {canManage && (
          <>
            <IconButton size="small" onClick={(e) => setMenuEl(e.currentTarget)} sx={{ p: 0.25 }}><MoreVertIcon fontSize="small" /></IconButton>
            <Menu anchorEl={menuEl} open={Boolean(menuEl)} onClose={() => setMenuEl(null)}>
              <MenuItem onClick={() => { setMenuEl(null); onSortByPriority(stage) }}>
                <SortIcon fontSize="small" sx={{ mr: 1 }} /> Ordenar por prioridade
              </MenuItem>
              <MenuItem onClick={() => { setMenuEl(null); onRename(stage) }}>
                <EditOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> Renomear
              </MenuItem>
              <MenuItem onClick={() => { setMenuEl(null); onDelete(stage) }} sx={{ color: 'error.main' }}>
                <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} /> Excluir
              </MenuItem>
            </Menu>
          </>
        )}
      </Stack>
      <Box sx={{ p: 1, overflowY: 'auto', flex: 1, minHeight: 80 }}>
        <SortableContext items={nodes.map((n) => `card-${n.id}`)} strategy={verticalListSortingStrategy}>
          {nodes.length === 0
            ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', py: 2 }}>Solte tarefas aqui</Typography>
            : nodes.map((n) => (
              <TaskCard key={n.id} node={n} canManage={canManage} onOpen={onOpenNode} onChanged={onChanged} notify={notify} />
            ))}
        </SortableContext>
      </Box>
    </Box>
  )
}

// Coluna aberta: reordenável pelo handle (só gestor) e droppable p/ cartões.
function BoardColumn(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.stage.id, data: { type: 'column' }, disabled: { draggable: !props.canManage, droppable: false },
  })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return <ColumnShell innerRef={setNodeRef} style={style} handleProps={props.canManage ? { ...attributes, ...listeners } : null} {...props} />
}

// Coluna "Concluído": fica sempre por último, não reordena — só recebe cartões (conclui).
function DoneColumn(props) {
  const { setNodeRef, isOver } = useDroppable({ id: props.stage.id, data: { type: 'column' } })
  return <ColumnShell innerRef={setNodeRef} isOver={isOver} handleProps={null} {...props} />
}

// Formulário reutilizável para criar/editar qualquer nó (tarefa ou subitem).
// isMain = tarefa de topo (mostra Responsável + Cliente/Contrato). Subitens herdam
// esses campos do pai — não são pedidos de novo.
function NodeForm({ heading, initial, users, submitting, isMain, onClose, onSubmit }) {
  const [form, setForm] = React.useState({
    title: initial?.title || '',
    description: initial?.description || '',
    assignee_id: initial?.assignee_id ? String(initial.assignee_id) : '',
    priority: initial?.priority || 'media',
    due_date: initial?.due_date ? String(initial.due_date).slice(0, 10) : '',
    client_id: initial?.client_id || null,
    contract_id: initial?.contract_id || null,
    recurrence: initial?.recurrence || 'none',
    recurrence_day: initial?.recurrence_day != null ? String(initial.recurrence_day) : '10',
    recurrence_month: initial?.recurrence_month != null ? String(initial.recurrence_month) : '1',
    recurrence_paused: Boolean(initial?.recurrence_paused),
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const recurring = form.recurrence !== 'none'
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{heading}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Descrição da tarefa" value={form.title} onChange={set('title')} fullWidth autoFocus />
          <TextField label="Detalhes" value={form.description} onChange={set('description')} fullWidth multiline minRows={2} />
          {isMain && (
            <TextField select label="Responsável" value={form.assignee_id} onChange={set('assignee_id')} fullWidth>
              <MenuItem value=""><em>Sem responsável</em></MenuItem>
              {users.map((u) => <MenuItem key={u.id} value={String(u.id)}>{u.name}</MenuItem>)}
            </TextField>
          )}
          <Stack direction="row" spacing={2}>
            <TextField select label="Prioridade" value={form.priority} onChange={set('priority')} fullWidth>
              {Object.entries(PRIORITY).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
            </TextField>
            <TextField label="Prazo" type="date" value={form.due_date} onChange={set('due_date')} InputLabelProps={{ shrink: true }} fullWidth />
          </Stack>
          {/* Cliente/contrato disponível também no subitem: permite tarefa geral com
              uma subtarefa por cliente. Em branco, o subitem herda o do pai. */}
          <ClientContractPicker clientId={form.client_id} contractId={form.contract_id} clientName={initial?.client_name} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
          {!isMain && <Typography variant="caption" color="text.secondary">Responsável é herdado da tarefa principal. Cliente/contrato em branco também herda.</Typography>}
          {isMain && (
            <>
              <Divider textAlign="left"><Typography variant="caption" color="text.secondary">Recorrência</Typography></Divider>
              <RecurrenceFields recurrence={form.recurrence} day={form.recurrence_day} month={form.recurrence_month} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
              {recurring && (
                <FormControlLabel
                  control={<Switch checked={form.recurrence_paused} onChange={(e) => setForm((f) => ({ ...f, recurrence_paused: e.target.checked }))} />}
                  label="Pausar recorrência (não gerar novas ocorrências)"
                />
              )}
              {recurring && <Typography variant="caption" color="text.secondary">Tarefa recorrente vira um modelo (some do quadro); as ocorrências aparecem por período.</Typography>}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button
          variant="contained" disableElevation disabled={form.title.trim().length < 2 || submitting}
          onClick={() => onSubmit({
            title: form.title.trim(),
            description: form.description.trim() || null,
            priority: form.priority,
            // Tarefa recorrente é modelo (sem prazo próprio); as ocorrências carregam o prazo.
            due_date: (isMain && recurring) ? null : (form.due_date || null),
            // Tarefa de topo envia responsável + cliente/contrato (pode limpar) + recorrência.
            // Subitem herda responsável do pai; envia cliente/contrato só se escolhido
            // (em branco = herda o do pai).
            ...(isMain
              ? {
                assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
                client_id: form.client_id, contract_id: form.contract_id,
                recurrence: form.recurrence,
                recurrence_day: recurring ? Number(form.recurrence_day) : null,
                recurrence_month: form.recurrence === 'yearly' ? Number(form.recurrence_month) : null,
                recurrence_paused: recurring ? form.recurrence_paused : false,
              }
              : (form.client_id ? { client_id: form.client_id, contract_id: form.contract_id || null } : {})),
          })}
        >Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

// Item da árvore de subtarefas (recursivo, profundidade livre).
function SubtreeItem({ node, childrenMap, users, depth, canManage, onChanged, notify }) {
  const confirm = useConfirm()
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const kids = childrenMap.get(node.id) || []
  const done = node.status === 'done'
  const p = PRIORITY[node.priority] || PRIORITY.media
  const toggle = useMutation({ mutationFn: () => tasksService.toggleNode(node.id, !done), onSuccess: onChanged, onError: (e) => notify(e?.response?.data?.error || 'Falha ao atualizar.', 'error') })
  const del = useMutation({ mutationFn: () => tasksService.deleteNode(node.id), onSuccess: onChanged, onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error') })
  const add = useMutation({ mutationFn: (payload) => tasksService.createNode({ ...payload, parent_id: node.id }), onSuccess: () => { setAdding(false); onChanged() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao adicionar.', 'error') })
  const edit = useMutation({ mutationFn: (payload) => tasksService.updateNode(node.id, payload), onSuccess: () => { setEditing(false); onChanged() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error') })
  const handleDelete = async () => {
    const ok = await confirm({ title: 'Excluir', description: `Excluir "${node.title}"${kids.length ? ' e seus subitens' : ''}?`, confirmText: 'Excluir', tone: 'danger' })
    if (ok) del.mutate()
  }
  return (
    <Box sx={{ ml: depth ? 2.5 : 0, borderLeft: depth ? 1 : 0, borderColor: 'divider', pl: depth ? 1 : 0 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ py: 0.5 }}>
        <IconButton size="small" onClick={() => toggle.mutate()} sx={{ p: 0.25 }} color={done ? 'success' : 'default'}>
          {done ? <CheckCircleIcon fontSize="small" /> : <RadioButtonUncheckedIcon fontSize="small" />}
        </IconButton>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0, textDecoration: done ? 'line-through' : 'none' }} noWrap>{node.title}</Typography>
        <Chip size="small" label={p.label} color={p.color} variant="outlined" sx={{ height: 20 }} />
        {node.due_date && <Chip size="small" label={fmtDate(node.due_date)} variant="outlined" sx={{ height: 20 }} />}
        {node.assignee_name && <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 120 }} noWrap>{node.assignee_name}</Typography>}
        {canManage && (
          <>
            <Tooltip title="Adicionar subitem"><IconButton size="small" onClick={() => setAdding(true)} sx={{ p: 0.25 }}><SubdirectoryArrowRightIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Editar"><IconButton size="small" onClick={() => setEditing(true)} sx={{ p: 0.25 }}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Excluir"><IconButton size="small" color="error" onClick={handleDelete} sx={{ p: 0.25 }}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
          </>
        )}
      </Stack>
      {(node.client_name || node.contract_description) && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', ml: 3.5, mt: -0.25, mb: 0.25 }}>
          🔗 {[node.client_name, node.contract_description].filter(Boolean).join(' · ')}
        </Typography>
      )}
      {kids.map((k) => <SubtreeItem key={k.id} node={k} childrenMap={childrenMap} users={users} depth={depth + 1} canManage={canManage} onChanged={onChanged} notify={notify} />)}
      {adding && <NodeForm heading="Novo subitem" initial={null} users={users} submitting={add.isPending} onClose={() => setAdding(false)} onSubmit={(payload) => add.mutate(payload)} />}
      {editing && <NodeForm heading="Editar tarefa" initial={node} users={users} submitting={edit.isPending} onClose={() => setEditing(false)} onSubmit={(payload) => edit.mutate(payload)} />}
    </Box>
  )
}

// Caixa de comentário com menção @ (autocomplete dos usuários com acesso ao quadro).
function CommentComposer({ onSubmit, submitting }) {
  const [body, setBody] = React.useState('')
  const [mentions, setMentions] = React.useState([]) // [{id,name}]
  const [anchorEl, setAnchorEl] = React.useState(null)
  const [mquery, setMquery] = React.useState('')
  const caretRef = React.useRef(0)
  const boxRef = React.useRef(null)
  const usersQ = useQuery({ queryKey: ['tasks-mentionable'], queryFn: () => tasksService.mentionableUsers() })
  const users = usersQ.data?.items || []
  const suggestions = anchorEl ? users.filter((u) => u.name.toLowerCase().includes(mquery.toLowerCase())).slice(0, 6) : []

  const detect = (value, sel) => {
    const before = value.slice(0, sel)
    const at = before.lastIndexOf('@')
    if (at < 0) return null
    if (at > 0 && !/\s/.test(before[at - 1])) return null
    const qy = before.slice(at + 1)
    if (/\s/.test(qy)) return null
    return { at, qy }
  }
  const onChange = (e) => {
    const value = e.target.value
    setBody(value)
    const sel = e.target.selectionStart
    caretRef.current = sel
    const m = detect(value, sel)
    if (m) { setMquery(m.qy); setAnchorEl(e.currentTarget) } else { setAnchorEl(null); setMquery('') }
  }
  const pick = (u) => {
    const value = body
    const caret = caretRef.current
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    const insert = `@${u.name} `
    const next = value.slice(0, at) + insert + value.slice(caret)
    setBody(next)
    setMentions((prev) => (prev.some((x) => x.id === u.id) ? prev : [...prev, u]))
    setAnchorEl(null); setMquery('')
    setTimeout(() => { const el = boxRef.current?.querySelector('textarea'); if (el) { el.focus(); const pos = at + insert.length; el.setSelectionRange(pos, pos) } }, 0)
  }
  const submit = () => {
    const b = body.trim()
    if (!b) return
    const active = mentions.filter((m) => b.includes(`@${m.name}`))
    onSubmit(b, active.map((m) => m.id))
    setBody(''); setMentions([]); setAnchorEl(null)
  }
  return (
    <Stack direction="row" spacing={1} alignItems="flex-end">
      <Box ref={boxRef} sx={{ flex: 1, minWidth: 0 }}>
        <TextField
          size="small" fullWidth multiline maxRows={4}
          placeholder="Comentar… use @ para mencionar (Ctrl+Enter envia)"
          value={body} onChange={onChange}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() } else if (e.key === 'Escape') setAnchorEl(null) }}
        />
        <Popper open={Boolean(anchorEl) && suggestions.length > 0} anchorEl={anchorEl} placement="top-start" style={{ zIndex: 1500 }}>
          <ClickAwayListener onClickAway={() => setAnchorEl(null)}>
            <Paper elevation={4} sx={{ minWidth: 200, maxWidth: 280, mb: 0.5 }}>
              <MenuList dense>
                {suggestions.map((u) => (
                  <MenuItem key={u.id} onClick={() => pick(u)}>
                    <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, mr: 1, flexShrink: 0 }}>{(u.name || '?').slice(0, 1).toUpperCase()}</Box>
                    <Typography variant="body2" noWrap>{u.name}</Typography>
                  </MenuItem>
                ))}
              </MenuList>
            </Paper>
          </ClickAwayListener>
        </Popper>
      </Box>
      <Button variant="contained" disableElevation startIcon={<SendIcon />} disabled={!body.trim() || submitting} onClick={submit}>Enviar</Button>
    </Stack>
  )
}

// Gerenciar modelos de checklist (passo-a-passo reutilizável) da empresa.
function ChecklistsDialog({ onClose, notify, onChanged }) {
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['tasks-checklists'], queryFn: () => tasksService.checklists() })
  const items = q.data?.items || []
  const [form, setForm] = React.useState({ id: null, name: '', steps: '' })
  const reset = () => setForm({ id: null, name: '', steps: '' })
  const save = useMutation({
    mutationFn: () => {
      const steps = form.steps.split('\n').map((s) => s.trim()).filter(Boolean)
      return form.id ? tasksService.updateChecklist(form.id, { name: form.name.trim(), steps }) : tasksService.createChecklist({ name: form.name.trim(), steps })
    },
    onSuccess: () => { reset(); q.refetch(); onChanged && onChanged() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error'),
  })
  const del = useMutation({ mutationFn: (id) => tasksService.deleteChecklist(id), onSuccess: () => { reset(); q.refetch(); onChanged && onChanged() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error') })
  const handleDel = async (c) => { const ok = await confirm({ title: 'Excluir checklist', description: `Excluir o modelo "${c.name}"?`, confirmText: 'Excluir', tone: 'danger' }); if (ok) del.mutate(c.id) }
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Modelos de checklist</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1} sx={{ mb: 2 }}>
          {items.length === 0 ? <Typography variant="caption" color="text.secondary">Nenhum modelo ainda.</Typography>
            : items.map((c) => (
              <Stack key={c.id} direction="row" alignItems="center" spacing={1}>
                <PlaylistAddIcon fontSize="small" color="disabled" />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }} noWrap onClick={() => setForm({ id: c.id, name: c.name, steps: (c.steps || []).join('\n') })}>{c.name} <Typography component="span" variant="caption" color="text.secondary">({(c.steps || []).length} passos)</Typography></Typography>
                <IconButton size="small" onClick={() => setForm({ id: c.id, name: c.name, steps: (c.steps || []).join('\n') })}><EditOutlinedIcon fontSize="small" /></IconButton>
                <IconButton size="small" color="error" onClick={() => handleDel(c)}><DeleteOutlineIcon fontSize="small" /></IconButton>
              </Stack>
            ))}
        </Stack>
        <Divider sx={{ mb: 2 }}><Typography variant="caption" color="text.secondary">{form.id ? 'Editar' : 'Novo'} modelo</Typography></Divider>
        <Stack spacing={1.5}>
          <TextField size="small" label="Nome do modelo" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth autoFocus />
          <TextField label="Passos (um por linha)" value={form.steps} onChange={(e) => setForm((f) => ({ ...f, steps: e.target.value }))} fullWidth multiline minRows={4} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {form.id && <Button onClick={reset} color="inherit">Cancelar edição</Button>}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} color="inherit">Fechar</Button>
        <Button variant="contained" disableElevation disabled={form.name.trim().length < 1 || save.isPending} onClick={() => save.mutate()}>{form.id ? 'Salvar' : 'Adicionar'}</Button>
      </DialogActions>
    </Dialog>
  )
}

// Aplicar um modelo de checklist como subitens diretos da tarefa (tarefa avulsa com modelo).
function ApplyChecklistDialog({ nodeId, onClose, onDone, notify }) {
  const q = useQuery({ queryKey: ['tasks-checklists'], queryFn: () => tasksService.checklists() })
  const items = q.data?.items || []
  const [sel, setSel] = React.useState('')
  const mut = useMutation({
    mutationFn: () => tasksService.applyChecklist(nodeId, Number(sel)),
    onSuccess: (r) => { notify(`${r.created} passo(s) adicionados.`); onDone(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao aplicar.', 'error'),
  })
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Aplicar modelo na tarefa</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {items.length === 0
            ? <Typography variant="body2" color="text.secondary">Nenhum modelo salvo. Use “Gerenciar checklists” para criar.</Typography>
            : (
              <TextField select label="Modelo" value={sel} onChange={(e) => setSel(e.target.value)} fullWidth>
                {items.map((c) => <MenuItem key={c.id} value={String(c.id)}>{c.name} ({(c.steps || []).length})</MenuItem>)}
              </TextField>
            )}
          <Typography variant="caption" color="text.secondary">Adiciona os passos como subitens desta tarefa (herda cliente/contrato). Passos já existentes são ignorados.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!sel || mut.isPending} onClick={() => mut.mutate()}>Aplicar</Button>
      </DialogActions>
    </Dialog>
  )
}

// Gera subtarefas em massa por cliente ou contrato, replicando o mesmo passo-a-passo.
function ExpandDialog({ nodeId, defaultSteps = [], onClose, onDone, notify }) {
  const checklistsQ = useQuery({ queryKey: ['tasks-checklists'], queryFn: () => tasksService.checklists() })
  const checklists = checklistsQ.data?.items || []
  const [granularity, setGranularity] = React.useState('client')
  const [selected, setSelected] = React.useState([])
  const [input, setInput] = React.useState('')
  const [dq, setDq] = React.useState('')
  React.useEffect(() => { const t = setTimeout(() => setDq(input.trim()), 300); return () => clearTimeout(t) }, [input])
  const clientsQ = useQuery({ queryKey: ['expand-clients', dq], queryFn: () => clientsService.list({ pageSize: 50, q: dq || undefined }), placeholderData: (p) => p })
  const options = clientsQ.data || []
  const [steps, setSteps] = React.useState(defaultSteps.join('\n'))
  const mut = useMutation({
    mutationFn: () => tasksService.expand(nodeId, { client_ids: selected.map((c) => c.id), granularity, steps: steps.split('\n').map((s) => s.trim()).filter(Boolean) }),
    onSuccess: (r) => { notify(`${r.createdTargets} subtarefa(s) e ${r.createdSteps} passo(s) criados.`); onDone(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao gerar.', 'error'),
  })
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Aplicar por cliente / contrato</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <ToggleButtonGroup exclusive size="small" value={granularity} onChange={(_e, v) => v && setGranularity(v)}>
            <ToggleButton value="client">Uma por cliente</ToggleButton>
            <ToggleButton value="contract">Uma por contrato</ToggleButton>
          </ToggleButtonGroup>
          <Autocomplete
            multiple options={options} value={selected}
            getOptionLabel={(o) => o?.name || ''} isOptionEqualToValue={(o, v) => o.id === v.id}
            filterOptions={(x) => x} loading={clientsQ.isFetching} noOptionsText={dq ? 'Nenhum cliente' : 'Digite para buscar…'}
            onChange={(_e, v) => setSelected(v)} onInputChange={(_e, val, reason) => { if (reason === 'input' || reason === 'clear') setInput(val) }}
            renderInput={(params) => <TextField {...params} label="Clientes" placeholder="Buscar cliente…" />}
          />
          <Typography variant="caption" color="text.secondary">
            {granularity === 'contract' ? 'Cria uma subtarefa por CONTRATO dos clientes selecionados.' : 'Cria uma subtarefa por CLIENTE selecionado.'} Alvos já existentes são ignorados (pode rodar de novo ao incluir novos).
          </Typography>
          {checklists.length > 0 && (
            <TextField select label="Usar um modelo de checklist" value="" onChange={(e) => { const c = checklists.find((x) => String(x.id) === e.target.value); if (c) setSteps((c.steps || []).join('\n')) }} fullWidth>
              {checklists.map((c) => <MenuItem key={c.id} value={String(c.id)}>{c.name} ({(c.steps || []).length})</MenuItem>)}
            </TextField>
          )}
          <TextField label="Passos (um por linha)" value={steps} onChange={(e) => setSteps(e.target.value)} fullWidth multiline minRows={4}
            helperText="Cada linha vira uma sub-subtarefa dentro de cada cliente/contrato." />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!selected.length || mut.isPending} onClick={() => mut.mutate()}>Gerar</Button>
      </DialogActions>
    </Dialog>
  )
}

// Detalhe da tarefa: cabeçalho editável + árvore de subitens + histórico.
function TaskDetailDialog({ nodeId, users, stages, canManage, currentUserId, labels = [], focusCommentId, onClose, onChanged, notify }) {
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['task-node', nodeId], queryFn: () => tasksService.node(nodeId) })
  const [editing, setEditing] = React.useState(false)
  const [addingTop, setAddingTop] = React.useState(false)
  const [expanding, setExpanding] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [modelsMenuEl, setModelsMenuEl] = React.useState(null)
  const [highlightId, setHighlightId] = React.useState(null)
  const promptedRef = React.useRef(false)
  const node = q.data?.node
  const children = q.data?.children || []
  const activity = q.data?.activity || []
  const comments = q.data?.comments || []
  const refreshAll = () => { q.refetch(); onChanged() }
  const childrenMap = React.useMemo(() => {
    const m = new Map()
    for (const c of children) { const k = c.parent_id; if (!m.has(k)) m.set(k, []); m.get(k).push(c) }
    return m
  }, [children])
  const topKids = childrenMap.get(nodeId) || []
  // Passos padrão para "Gerar por clientes" = os passos do 1º subitem existente.
  const defaultSteps = topKids[0] ? (childrenMap.get(topKids[0].id) || []).map((k) => k.title) : []
  const allSubDone = topKids.length > 0 && topKids.every((k) => k.status === 'done')
  // Todas as subtarefas concluídas → oferece CONCLUIR a tarefa (move p/ "Concluído" e,
  // se for recorrente, materializa a próxima ocorrência no backend).
  React.useEffect(() => {
    if (!node) return
    if (!allSubDone) { promptedRef.current = false; return }
    if (promptedRef.current || node.status === 'done') return
    promptedRef.current = true
    ;(async () => {
      const ok = await confirm({ title: 'Subtarefas concluídas', description: `Todas as subtarefas de "${node.title}" foram concluídas. Concluir a tarefa?`, confirmText: 'Concluir' })
      if (ok) {
        try { await tasksService.toggleNode(node.id, true); refreshAll() }
        catch (e) { notify(e?.response?.data?.error || 'Falha ao concluir.', 'error') }
      }
    })()
  }, [allSubDone, node?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const edit = useMutation({ mutationFn: (payload) => tasksService.updateNode(nodeId, payload), onSuccess: () => { setEditing(false); refreshAll() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error') })
  const addTop = useMutation({ mutationFn: (payload) => tasksService.createNode({ ...payload, parent_id: nodeId }), onSuccess: () => { setAddingTop(false); refreshAll() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao adicionar.', 'error') })
  const addCommentMut = useMutation({ mutationFn: ({ body, ids }) => tasksService.addComment(nodeId, body, ids), onSuccess: () => q.refetch(), onError: (e) => notify(e?.response?.data?.error || 'Falha ao comentar.', 'error') })
  // Deep-link de menção: rola até o comentário e realça por alguns segundos.
  React.useEffect(() => {
    if (!focusCommentId || !q.data) return
    setHighlightId(focusCommentId)
    const el = typeof document !== 'undefined' && document.getElementById(`task-comment-${focusCommentId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => setHighlightId(null), 2800)
    return () => clearTimeout(t)
  }, [focusCommentId, q.data])
  const delCommentMut = useMutation({ mutationFn: (id) => tasksService.deleteComment(id), onSuccess: () => q.refetch(), onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir comentário.', 'error') })
  const setLabelsMut = useMutation({ mutationFn: (ids) => tasksService.setNodeLabels(nodeId, ids), onSuccess: () => refreshAll(), onError: (e) => notify(e?.response?.data?.error || 'Falha ao atualizar etiquetas.', 'error') })
  const nodeLabelIds = (node?.labels || []).map((l) => l.id)
  const toggleNodeLabel = (id) => setLabelsMut.mutate(nodeLabelIds.includes(id) ? nodeLabelIds.filter((x) => x !== id) : [...nodeLabelIds, id])
  const p = node ? (PRIORITY[node.priority] || PRIORITY.media) : PRIORITY.media
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      {!node ? (
        <DialogContent><Typography color="text.secondary">Carregando…</Typography></DialogContent>
      ) : (
        <>
          <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
            {node.title}
            {canManage && (
              <IconButton onClick={() => setEditing(true)} sx={{ position: 'absolute', right: 12, top: 12 }}><EditOutlinedIcon /></IconButton>
            )}
          </DialogTitle>
          <DialogContent dividers>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
              <Chip size="small" label={p.label} color={p.color} variant="outlined" />
              {node.due_date && <Chip size="small" label={`Prazo ${fmtDate(node.due_date)}`} variant="outlined" />}
              <Chip size="small" label={node.status === 'done' ? 'Concluída' : 'Aberta'} color={node.status === 'done' ? 'success' : 'default'} variant="outlined" />
              {node.assignee_name && <Typography variant="caption" color="text.secondary">👤 {node.assignee_name}</Typography>}
            </Stack>
            {(node.client_name || node.contract_description) && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                🔗 {[node.client_name, node.contract_description].filter(Boolean).join(' · ')}
              </Typography>
            )}

            {(nodeLabelIds.length > 0 || (canManage && labels.length > 0)) && (
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Etiquetas</Typography>
                {canManage
                  ? <LabelPicker labels={labels} selectedIds={nodeLabelIds} onToggle={toggleNodeLabel} />
                  : <LabelChips labels={node.labels} />}
              </Box>
            )}

            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: 'stretch' }}>
              {/* Conteúdo principal */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {node.description && <Typography variant="body2" color="text.secondary" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>{node.description}</Typography>}
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Subitens</Typography>
                  {canManage && (
                    <Stack direction="row" spacing={0.5}>
                      <Button size="small" startIcon={<PlaylistAddIcon />} endIcon={<ArrowDropDownIcon />} onClick={(e) => setModelsMenuEl(e.currentTarget)}>Modelos</Button>
                      <Menu anchorEl={modelsMenuEl} open={Boolean(modelsMenuEl)} onClose={() => setModelsMenuEl(null)}>
                        <MenuItem onClick={() => { setModelsMenuEl(null); setApplying(true) }}>Aplicar na tarefa (geral)…</MenuItem>
                        <MenuItem onClick={() => { setModelsMenuEl(null); setExpanding(true) }}>Aplicar por cliente/contrato…</MenuItem>
                      </Menu>
                      <Button size="small" startIcon={<AddIcon />} onClick={() => setAddingTop(true)}>Adicionar</Button>
                    </Stack>
                  )}
                </Stack>
                {topKids.length === 0
                  ? <Typography variant="caption" color="text.secondary">Nenhum subitem. {canManage ? 'Use “Adicionar” para quebrar a tarefa em passos.' : ''}</Typography>
                  : topKids.map((k) => <SubtreeItem key={k.id} node={k} childrenMap={childrenMap} users={users} depth={0} canManage={canManage} onChanged={refreshAll} notify={notify} />)}

                {/* Comentários (discussão) */}
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 1 }}>
                  <ChatBubbleOutlineIcon fontSize="small" color="disabled" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Comentários</Typography>
                </Stack>
                <Stack spacing={1.25} sx={{ mb: 1.5 }}>
                  {comments.length === 0
                    ? <Typography variant="caption" color="text.secondary">Sem comentários. Inicie a discussão abaixo.</Typography>
                    : comments.map((c) => (
                      <Stack key={c.id} id={`task-comment-${c.id}`} direction="row" spacing={1} alignItems="flex-start"
                        sx={{ borderRadius: 1, p: 0.5, transition: 'background-color .4s', bgcolor: highlightId === c.id ? 'action.selected' : 'transparent' }}>
                        <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                          {(c.user_name || '?').slice(0, 1).toUpperCase()}
                        </Box>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="caption" color="text.secondary"><b>{c.user_name || 'Usuário'}</b> · {fmtDateTime(c.created_at)}</Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{c.body}</Typography>
                          {c.mentions?.length > 0 && (
                            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                              {c.mentions.map((m) => <Chip key={m.user_id} size="small" icon={<AlternateEmailIcon sx={{ fontSize: 13 }} />} label={m.name} variant="outlined" color="primary" sx={{ height: 20 }} />)}
                            </Stack>
                          )}
                        </Box>
                        {(canManage || c.user_id === currentUserId) && (
                          <Tooltip title="Excluir"><IconButton size="small" color="error" onClick={() => delCommentMut.mutate(c.id)} sx={{ p: 0.25 }}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                        )}
                      </Stack>
                    ))}
                </Stack>
                <CommentComposer onSubmit={(body, ids) => addCommentMut.mutate({ body, ids })} submitting={addCommentMut.isPending} />
              </Box>

              {/* Histórico (lateral) */}
              <Box
                sx={{
                  flex: { xs: '1 1 auto', md: '0 0 280px' }, minWidth: 0,
                  borderLeft: { md: 1 }, borderTop: { xs: 1, md: 0 }, borderColor: { xs: 'divider', md: 'divider' },
                  pl: { md: 2 }, pt: { xs: 1.5, md: 0 },
                }}
              >
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 1 }}>
                  <HistoryIcon fontSize="small" color="disabled" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Histórico</Typography>
                </Stack>
                {activity.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">Nenhuma atividade ainda.</Typography>
                ) : (
                  <Stack spacing={1.5} sx={{ maxHeight: { md: 340 }, overflowY: 'auto', pr: 0.5 }}>
                    {activity.map((a, i) => {
                      const { Icon, color, text, sub } = describeActivity(a)
                      return (
                        <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                          <Icon sx={{ fontSize: 18, color, mt: '2px', flexShrink: 0 }} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ lineHeight: 1.3 }}>
                              {text}{a.user_name ? <> por <b>{a.user_name}</b></> : ''}
                            </Typography>
                            {sub && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{sub}</Typography>}
                            <Typography variant="caption" color="text.disabled">{fmtDateTime(a.created_at)}</Typography>
                          </Box>
                        </Stack>
                      )
                    })}
                  </Stack>
                )}
              </Box>
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={onClose}>Fechar</Button>
          </DialogActions>
          {editing && <NodeForm heading="Editar tarefa" initial={node} users={users} submitting={edit.isPending} isMain onClose={() => setEditing(false)} onSubmit={(payload) => edit.mutate(payload)} />}
          {addingTop && <NodeForm heading="Novo subitem" initial={null} users={users} submitting={addTop.isPending} onClose={() => setAddingTop(false)} onSubmit={(payload) => addTop.mutate(payload)} />}
          {expanding && <ExpandDialog nodeId={nodeId} defaultSteps={defaultSteps} onClose={() => setExpanding(false)} onDone={refreshAll} notify={notify} />}
          {applying && <ApplyChecklistDialog nodeId={nodeId} onClose={() => setApplying(false)} onDone={refreshAll} notify={notify} />}
        </>
      )}
    </Dialog>
  )
}

// Gerenciar rotinas recorrentes (templates ocultos do board). Abrir uma rotina
// leva ao seu detalhe (para montar os subitens que serão clonados nas ocorrências).
function RecurrencesDialog({ canManage, onOpen, onClose, notify, onChanged }) {
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['task-templates'], queryFn: () => tasksService.templates() })
  const items = q.data?.items || []
  const del = useMutation({
    mutationFn: (id) => tasksService.deleteNode(id),
    onSuccess: () => { q.refetch(); onChanged() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error'),
  })
  const gen = useMutation({
    mutationFn: () => tasksService.generate(),
    onSuccess: (r) => { notify(`${r.created} ocorrência(s) gerada(s).`); q.refetch(); onChanged() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao gerar.', 'error'),
  })
  const pauseMut = useMutation({
    mutationFn: ({ id, paused }) => tasksService.updateNode(id, { recurrence_paused: paused }),
    onSuccess: () => { q.refetch(); onChanged() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao atualizar.', 'error'),
  })
  const handleDelete = async (t) => {
    const ok = await confirm({ title: 'Excluir rotina', description: `Excluir a rotina "${t.title}"? As ocorrências já geradas permanecem.`, confirmText: 'Excluir', tone: 'danger' })
    if (ok) del.mutate(t.id)
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Rotinas recorrentes
        {canManage && <Button size="small" startIcon={<AutorenewIcon />} onClick={() => gen.mutate()} disabled={gen.isPending}>Gerar agora</Button>}
      </DialogTitle>
      <DialogContent dividers>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Nenhuma rotina recorrente. Crie uma tarefa com repetição semanal, quinzenal, mensal ou anual.</Typography>
        ) : (
          <Stack divider={<Divider flexItem />} spacing={0}>
            {items.map((t) => {
              const p = PRIORITY[t.priority] || PRIORITY.media
              return (
                <Stack key={t.id} direction="row" alignItems="center" spacing={1} sx={{ py: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }} onClick={() => { onOpen(t.id); onClose() }} noWrap>{t.title}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {recurrenceLabel(t.recurrence, t.recurrence_day, t.recurrence_month)}{t.group_name ? ` · ${t.group_name}` : ''}{t.assignee_name ? ` · ${t.assignee_name}` : ''} · {t.occurrences} ocorrência(s)
                    </Typography>
                  </Box>
                  {t.recurrence_paused && <Chip size="small" label="Pausada" color="warning" variant="outlined" sx={{ height: 20 }} />}
                  <Chip size="small" label={p.label} color={p.color} variant="outlined" sx={{ height: 20 }} />
                  {canManage && (
                    <Tooltip title={t.recurrence_paused ? 'Retomar' : 'Pausar'}>
                      <IconButton size="small" onClick={() => pauseMut.mutate({ id: t.id, paused: !t.recurrence_paused })}>
                        {t.recurrence_paused ? <PlayCircleOutlineIcon fontSize="small" /> : <PauseCircleOutlineIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  )}
                  {canManage && <IconButton size="small" color="error" onClick={() => handleDelete(t)}><DeleteOutlineIcon fontSize="small" /></IconButton>}
                </Stack>
              )
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}><Button onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  )
}

// Projeta as ocorrências FUTURAS previstas das rotinas recorrentes no mês visível
// (sem materializar) — só datas ≥ hoje que ainda não têm ocorrência real.
// Retorna Map(dateKey → [{ title, id }]).
function projectMonth(templates, realSet, year, month, todayKey) {
  const res = new Map()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const add = (key, t) => { if (!res.has(key)) res.set(key, []); res.get(key).push({ title: t.title, id: t.id }) }
  const put = (t, y, m, d) => {
    const dd = Math.min(Math.max(d, 1), daysInMonth)
    const key = `${y}-${pad2(m)}-${pad2(dd)}`
    if (key < todayKey || realSet.has(`${t.id}:${key}`)) return
    add(key, t)
  }
  for (const t of templates) {
    if (t.recurrence_paused) continue
    const wd = Number(t.recurrence_day) || 0
    if (t.recurrence === 'monthly') put(t, year, month + 1, Number(t.recurrence_day) || 1)
    else if (t.recurrence === 'yearly') { if ((Number(t.recurrence_month) || 1) === month + 1) put(t, year, month + 1, Number(t.recurrence_day) || 1) }
    else if (t.recurrence === 'weekly') {
      for (let d = 1; d <= daysInMonth; d++) if (new Date(year, month, d).getDay() === wd) put(t, year, month + 1, d)
    } else if (t.recurrence === 'biweekly') {
      let anchor
      if (t.last_due) { const [ay, am, ad] = String(t.last_due).slice(0, 10).split('-').map(Number); anchor = new Date(ay, am - 1, ad) } else { const now = new Date(); anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate()); anchor.setDate(anchor.getDate() + ((wd - anchor.getDay() + 7) % 7)) }
      const monthStart = new Date(year, month, 1).getTime()
      const monthEnd = new Date(year, month, daysInMonth).getTime()
      const stepMs = 14 * 86400000
      let cur = anchor.getTime()
      while (cur < monthStart) cur += stepMs
      while (cur - stepMs >= monthStart) cur -= stepMs
      for (; cur <= monthEnd; cur += stepMs) {
        if (cur < monthStart) continue
        const c = new Date(cur)
        put(t, c.getFullYear(), c.getMonth() + 1, c.getDate())
      }
    }
  }
  return res
}

// Chip de tarefa no calendário — arrastável (reagenda o prazo) quando canManage.
function CalChip({ node, canManage, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `cal-${node.id}`, data: { type: 'cal', id: node.id, from: String(node.due_date).slice(0, 10) }, disabled: !canManage,
  })
  const done = node.status === 'done'
  const style = { transform: transform ? CSS.Translate.toString(transform) : undefined, opacity: isDragging ? 0.4 : (done ? 0.6 : 1) }
  return (
    <Tooltip title={node.title}>
      <Box
        ref={setNodeRef} style={style} {...listeners} {...attributes}
        onClick={() => onOpen(node.id)}
        sx={{
          borderLeft: 3, borderLeftColor: (PRIORITY[node.priority] || PRIORITY.media).bar,
          bgcolor: 'action.hover', borderRadius: 0.5, px: 0.5, py: 0.25, cursor: canManage ? 'grab' : 'pointer',
          touchAction: 'none', '&:hover': { bgcolor: 'action.selected' },
        }}
      >
        <Typography variant="caption" noWrap sx={{ display: 'block', textDecoration: done ? 'line-through' : 'none' }}>
          {node.source_node_id ? '🔄 ' : ''}{node.title}
        </Typography>
      </Box>
    </Tooltip>
  )
}

// Célula de dia — alvo de soltura (drop) para reagendar.
function CalDay({ dateKey, day, isToday, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dateKey}`, data: { dateISO: dateKey } })
  return (
    <Box
      ref={setNodeRef}
      sx={{
        minHeight: 96, border: 1, borderColor: (isOver || isToday) ? 'primary.main' : 'divider', borderRadius: 1, p: 0.5,
        display: 'flex', flexDirection: 'column', gap: 0.25, bgcolor: isOver ? 'action.selected' : 'transparent',
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: isToday ? 700 : 500, color: isToday ? 'primary.main' : 'text.primary', alignSelf: 'flex-end' }}>{day}</Typography>
      {children}
    </Box>
  )
}

// Visão de calendário: tarefas posicionadas pela data de prazo, navegável por mês/ano.
// Serve para acompanhar se as ocorrências recorrentes do próximo período foram criadas.
function CalendarView({ nodes, realNodes, templates, onOpenNode, canManage, onReschedule }) {
  const now = new Date()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const onDragEnd = ({ active, over }) => {
    if (!over) return
    const id = active.data.current?.id
    const from = active.data.current?.from
    const to = over.data.current?.dateISO
    if (id && to && to !== from) onReschedule(id, to)
  }
  const [cursor, setCursor] = React.useState({ year: now.getFullYear(), month: now.getMonth() })
  const { year, month } = cursor
  const prefix = `${year}-${pad2(month + 1)}`
  const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`

  // Tarefas do mês agrupadas por dia (ordenadas por prioridade).
  const byDay = React.useMemo(() => {
    const m = new Map()
    let total = 0
    for (const n of nodes) {
      if (!n.due_date) continue
      const key = String(n.due_date).slice(0, 10)
      if (!key.startsWith(prefix)) continue
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(n)
      total += 1
    }
    for (const arr of m.values()) arr.sort((a, b) => prioWeight(b.priority) - prioWeight(a.priority) || a.id - b.id)
    return { m, total }
  }, [nodes, prefix])

  // Ocorrências reais já materializadas (por template) e projeção das futuras.
  const realSet = React.useMemo(() => {
    const s = new Set()
    for (const n of (realNodes || [])) { if (n.source_node_id && n.due_date) s.add(`${n.source_node_id}:${String(n.due_date).slice(0, 10)}`) }
    return s
  }, [realNodes])
  const projByDay = React.useMemo(() => projectMonth(templates || [], realSet, year, month, todayKey), [templates, realSet, year, month, todayKey])

  const startWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))
  const nextMonth = () => setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))
  const years = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 3 + i)

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <IconButton size="small" onClick={prevMonth}><ChevronLeftIcon /></IconButton>
          <TextField select size="small" value={month} onChange={(e) => setCursor((c) => ({ ...c, month: Number(e.target.value) }))} sx={{ minWidth: 130 }}>
            {MONTHS.map((m, i) => <MenuItem key={i} value={i}>{m}</MenuItem>)}
          </TextField>
          <TextField select size="small" value={year} onChange={(e) => setCursor((c) => ({ ...c, year: Number(e.target.value) }))} sx={{ minWidth: 90 }}>
            {years.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
          <IconButton size="small" onClick={nextMonth}><ChevronRightIcon /></IconButton>
          <Button size="small" onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}>Hoje</Button>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {byDay.total} tarefa(s) com prazo em {MONTHS[month]}/{year}
        </Typography>
      </Stack>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
          {WEEKDAYS.map((w) => (
            <Typography key={w} variant="caption" sx={{ fontWeight: 700, textAlign: 'center', color: 'text.secondary', py: 0.5 }}>{w}</Typography>
          ))}
          {cells.map((d, i) => {
            if (d == null) return <Box key={`e${i}`} sx={{ minHeight: 96, borderRadius: 1, bgcolor: 'action.hover', opacity: 0.4 }} />
            const key = `${prefix}-${pad2(d)}`
            const dayTasks = byDay.m.get(key) || []
            return (
              <CalDay key={key} dateKey={key} day={d} isToday={key === todayKey}>
                {dayTasks.slice(0, 4).map((t) => <CalChip key={t.id} node={t} canManage={canManage} onOpen={onOpenNode} />)}
                {dayTasks.length > 4 && <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>+{dayTasks.length - 4} mais</Typography>}
                {(projByDay.get(key) || []).slice(0, 2).map((g, i) => (
                  <Tooltip key={`g${i}`} title={`Ocorrência prevista: ${g.title}`}>
                    <Box onClick={() => onOpenNode(g.id)} sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 0.5, px: 0.5, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
                      <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.disabled', fontStyle: 'italic' }}>🔄 {g.title}</Typography>
                    </Box>
                  </Tooltip>
                ))}
              </CalDay>
            )
          })}
        </Box>
      </DndContext>

      <Stack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">🔄 = recorrente · 🔄 <i>itálico cinza</i> = prevista (ainda não criada)</Typography>
        {Object.entries(PRIORITY).map(([k, v]) => (
          <Stack key={k} direction="row" spacing={0.5} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: v.bar }} />
            <Typography variant="caption" color="text.secondary">{v.label}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

export default function TasksPage() {
  const { selectedCompanyId, user } = useAuth()
  const { can } = usePermissions()
  const qc = useQueryClient()
  const canView = can('tasks.view')
  const canManage = can('tasks.manage')
  const enabled = Number.isInteger(selectedCompanyId)
  const [toast, setToast] = React.useState(null)
  const [dialog, setDialog] = React.useState(null) // 'column' | 'task' | 'recurrences'
  const [renameStage, setRenameStage] = React.useState(null)
  const [openNodeId, setOpenNodeId] = React.useState(null)
  const [focusCommentId, setFocusCommentId] = React.useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  // Deep-link de notificação: /tasks?open=<id>&comment=<id> abre a tarefa e rola até o
  // comentário. Depende de searchParams p/ funcionar também se já estiver na página.
  React.useEffect(() => {
    const open = searchParams.get('open')
    if (!open) return
    setOpenNodeId(Number(open))
    const c = searchParams.get('comment')
    setFocusCommentId(c ? Number(c) : null)
    const next = new URLSearchParams(searchParams)
    next.delete('open'); next.delete('comment')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])
  const [activeDrag, setActiveDrag] = React.useState(null) // { type, node?|stage? }
  const [view, setView] = React.useState('board') // 'board' | 'calendar'
  const emptyFilters = { q: '', assignee: 'all', priority: 'all', overdue: false, mine: false, label: 'all' }
  const [filters, setFilters] = React.useState(emptyFilters)
  const notify = (msg, severity = 'success') => setToast({ msg, severity, key: Date.now() })
  const boardKey = ['tasks-board', selectedCompanyId]

  const boardQ = useQuery({ queryKey: boardKey, queryFn: () => tasksService.board(), enabled: enabled && canView })
  const usersQ = useQuery({ queryKey: ['tasks-users', selectedCompanyId], queryFn: () => tasksService.companyUsers(), enabled: enabled && canManage })
  const labelsQ = useQuery({ queryKey: ['tasks-labels', selectedCompanyId], queryFn: () => tasksService.labels(), enabled: enabled && canView })
  const templatesQ = useQuery({ queryKey: ['tasks-templates-cal', selectedCompanyId], queryFn: () => tasksService.templates(), enabled: enabled && canView })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const confirm = useConfirm()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tasks-board'] })
    qc.invalidateQueries({ queryKey: ['tasks-templates-cal'] })
    qc.invalidateQueries({ queryKey: ['tasks-labels'] })
  }

  // Reordenar colunas (otimista).
  const reorderMut = useMutation({
    mutationFn: (order) => tasksService.reorderStages(order),
    onMutate: async (order) => {
      await qc.cancelQueries({ queryKey: boardKey })
      const prev = qc.getQueryData(boardKey)
      if (prev) {
        const byId = new Map(prev.stages.map((s) => [s.id, s]))
        // order só tem as colunas abertas; Concluído (is_done) segue por último.
        const movableOrdered = order.map((id) => byId.get(id)).filter(Boolean)
        const done = prev.stages.filter((s) => s.is_done)
        qc.setQueryData(boardKey, { ...prev, stages: [...movableOrdered, ...done] })
      }
      return { prev }
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev); notify('Falha ao reordenar.', 'error') },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks-board'] }),
  })

  // Soltar um cartão: reordena dentro da coluna e/ou move de coluna. `order` é a nova
  // ordem (ids) da coluna de destino. Otimista (position + stage_id/status no cache).
  const cardDropMut = useMutation({
    mutationFn: async ({ id, toStage, fromStage, order }) => {
      if (toStage !== fromStage) await tasksService.moveNode(id, toStage)
      await tasksService.reorderNodes(toStage, order)
    },
    onMutate: async ({ id, toStage, fromStage, order }) => {
      await qc.cancelQueries({ queryKey: boardKey })
      const prev = qc.getQueryData(boardKey)
      if (prev) {
        const isDone = prev.stages.find((s) => s.id === toStage)?.is_done
        const posById = new Map(order.map((nid, i) => [nid, i]))
        const nodes2 = prev.nodes.map((n) => {
          let m = n
          if (n.id === id && toStage !== fromStage) m = { ...m, stage_id: toStage, status: isDone ? 'done' : 'open' }
          if (posById.has(n.id)) m = { ...m, position: posById.get(n.id) }
          return m
        })
        qc.setQueryData(boardKey, { ...prev, nodes: nodes2 })
      }
      return { prev }
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev); notify(e?.response?.data?.error || 'Falha ao mover.', 'error') },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks-board'] }),
  })

  // Reordena uma coluna pela prioridade (reescreve as positions).
  const sortPriorityMut = useMutation({
    mutationFn: ({ stageId, order }) => tasksService.reorderNodes(stageId, order),
    onSuccess: () => refresh(),
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao ordenar.', 'error'),
  })
  const handleSortByPriority = (stage) => {
    const order = byPriority(filteredNodes.filter((n) => n.stage_id === stage.id)).map((n) => n.id)
    if (order.length) sortPriorityMut.mutate({ stageId: stage.id, order })
  }

  // Reagendar (calendário): muda o due_date. Otimista.
  const rescheduleMut = useMutation({
    mutationFn: ({ id, dueDate }) => tasksService.updateNode(id, { due_date: dueDate }),
    onMutate: async ({ id, dueDate }) => {
      await qc.cancelQueries({ queryKey: boardKey })
      const prev = qc.getQueryData(boardKey)
      if (prev) qc.setQueryData(boardKey, { ...prev, nodes: prev.nodes.map((n) => (n.id === id ? { ...n, due_date: dueDate } : n)) })
      return { prev }
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev); notify(e?.response?.data?.error || 'Falha ao reagendar.', 'error') },
    onSuccess: () => notify('Prazo atualizado.'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks-board'] }),
  })

  const delStage = useMutation({
    mutationFn: (id) => tasksService.deleteStage(id),
    onSuccess: () => { notify('Coluna excluída.'); refresh() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir a coluna.', 'error'),
  })
  const handleDeleteStage = async (stage) => {
    const ok = await confirm({ title: 'Excluir coluna', description: `Excluir a coluna "${stage.name}"? Só é possível se não houver tarefas nela.`, confirmText: 'Excluir', tone: 'danger' })
    if (ok) delStage.mutate(stage.id)
  }

  if (!canView) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Gerenciador de Tarefas" />
        <Alert severity="warning">Seu perfil não tem permissão para acessar o Gerenciador de Tarefas.</Alert>
      </Stack>
    )
  }
  if (!enabled) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Gerenciador de Tarefas" subtitle="Rotinas, tarefas e subtarefas em Kanban." />
        <CompanyRequiredAlert />
      </Stack>
    )
  }

  const stages = boardQ.data?.stages || []
  const nodes = boardQ.data?.nodes || []
  const labels = labelsQ.data?.items || []
  const templates = templatesQ.data?.items || []
  // Colunas "abertas" reordenáveis vs. Concluído (is_done) fixo por último.
  const movable = stages.filter((s) => !s.is_done)
  const doneStages = stages.filter((s) => s.is_done)
  const movableIds = movable.map((s) => s.id)

  // Filtros (busca/responsável/prioridade/atrasadas/minhas) — aplicados ao quadro e ao calendário.
  const assignees = Array.from(
    new Map(nodes.filter((n) => n.assignee_id).map((n) => [n.assignee_id, n.assignee_name || `#${n.assignee_id}`])).entries()
  ).map(([id, name]) => ({ id, name }))
  const activeFilters = Boolean(filters.q.trim()) || filters.assignee !== 'all' || filters.priority !== 'all' || filters.overdue || filters.mine || filters.label !== 'all'
  const q = filters.q.trim().toLowerCase()
  const t0 = todayISO()
  const filteredNodes = nodes.filter((n) => {
    if (q && !`${n.title} ${n.description || ''} ${n.client_name || ''} ${n.contract_description || ''} ${n.assignee_name || ''} ${n.sub_links || ''}`.toLowerCase().includes(q)) return false
    if (filters.mine && String(n.assignee_id || '') !== String(user?.id || '')) return false
    if (filters.assignee !== 'all' && String(n.assignee_id || 'none') !== String(filters.assignee)) return false
    if (filters.priority !== 'all' && n.priority !== filters.priority) return false
    if (filters.overdue && !(n.due_date && String(n.due_date).slice(0, 10) < t0 && n.status !== 'done')) return false
    if (filters.label !== 'all' && !(n.labels || []).some((l) => String(l.id) === String(filters.label))) return false
    return true
  })
  // Cartões de uma coluna, na ordem MANUAL (position). "Ordenar por prioridade"
  // reescreve as positions sob demanda.
  const colNodes = (stageId) => filteredNodes
    .filter((n) => n.stage_id === stageId)
    .sort((a, b) => (a.position - b.position) || a.id - b.id)
  // Ordem por prioridade (usada pelo "Ordenar por prioridade" e como ordem inicial).
  const byPriority = (list) => [...list].sort((a, b) => prioWeight(b.priority) - prioWeight(a.priority)
    || String(a.due_date || '9999-99-99').localeCompare(String(b.due_date || '9999-99-99')) || a.id - b.id)

  const onDragStart = ({ active }) => {
    const type = active.data.current?.type
    if (type === 'card') setActiveDrag({ type, node: nodes.find((n) => n.id === active.data.current.nodeId) })
    else if (type === 'column') setActiveDrag({ type, stage: stages.find((s) => s.id === active.id) })
  }
  const onDragEnd = ({ active, over }) => {
    setActiveDrag(null)
    if (!over) return
    const type = active.data.current?.type
    if (type === 'column') {
      if (active.id === over.id) return
      const oldIndex = movableIds.indexOf(active.id)
      const newIndex = movableIds.indexOf(over.id)
      if (oldIndex < 0 || newIndex < 0) return // soltar sobre "Concluído" não reordena
      reorderMut.mutate(arrayMove(movableIds, oldIndex, newIndex))
    } else if (type === 'card') {
      const activeId = active.data.current.nodeId
      const fromStage = active.data.current.fromStageId
      // Alvo: outro cartão (mesma/outra coluna) ou o corpo da coluna (fim).
      let toStage; let overNodeId = null
      if (typeof over.id === 'string' && over.id.startsWith('card-')) {
        overNodeId = Number(over.id.slice(5))
        toStage = nodes.find((n) => n.id === overNodeId)?.stage_id
      } else {
        toStage = Number(over.id)
      }
      if (!toStage || overNodeId === activeId) return
      // Ordem completa (não filtrada) da coluna de destino, por position.
      const fullCol = nodes.filter((n) => n.stage_id === toStage && n.id !== activeId).sort((a, b) => (a.position - b.position) || a.id - b.id).map((n) => n.id)
      let insertAt = fullCol.length
      if (overNodeId != null) { const idx = fullCol.indexOf(overNodeId); if (idx >= 0) insertAt = idx }
      fullCol.splice(insertAt, 0, activeId)
      const current = nodes.filter((n) => n.stage_id === toStage).sort((a, b) => (a.position - b.position) || a.id - b.id).map((n) => n.id)
      if (toStage === fromStage && current.join(',') === fullCol.join(',')) return
      cardDropMut.mutate({ id: activeId, toStage, fromStage, order: fullCol })
    }
  }

  const actions = (
    <Stack direction="row" spacing={1}>
      <Button variant="text" startIcon={<AutorenewIcon />} onClick={() => setDialog('recurrences')}>Recorrências</Button>
      {canManage && <Button variant="text" startIcon={<ChecklistIcon />} onClick={() => setDialog('checklists')}>Checklists</Button>}
      {canManage && <Button variant="text" startIcon={<LabelOutlinedIcon />} onClick={() => setDialog('labels')}>Etiquetas</Button>}
      {canManage && <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setDialog('column')}>Nova coluna</Button>}
      {canManage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog('task')} disabled={!stages.length}>Nova tarefa</Button>}
    </Stack>
  )

  return (
    <Stack spacing={2.5}>
      <PageHeader title="Gerenciador de Tarefas" subtitle="Colunas arrastáveis · cartões ordenados por prioridade." actions={actions} />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <ToggleButtonGroup exclusive size="small" value={view} onChange={(_e, v) => v && setView(v)}>
          <ToggleButton value="board"><ViewKanbanIcon fontSize="small" sx={{ mr: 0.5 }} /> Quadro</ToggleButton>
          <ToggleButton value="calendar"><CalendarMonthIcon fontSize="small" sx={{ mr: 0.5 }} /> Calendário</ToggleButton>
        </ToggleButtonGroup>

        <TextField
          size="small" placeholder="Buscar tarefa, cliente, responsável…" value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.5, color: 'text.disabled' }} /> }}
          sx={{ flex: 1, minWidth: 200 }}
        />
        <TextField select size="small" label="Responsável" value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))} sx={{ minWidth: 160 }}>
          <MenuItem value="all">Todos</MenuItem>
          <MenuItem value="none">Sem responsável</MenuItem>
          {assignees.map((a) => <MenuItem key={a.id} value={String(a.id)}>{a.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Prioridade" value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))} sx={{ minWidth: 130 }}>
          <MenuItem value="all">Todas</MenuItem>
          {Object.entries(PRIORITY).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
        </TextField>
        {labels.length > 0 && (
          <TextField select size="small" label="Etiqueta" value={filters.label} onChange={(e) => setFilters((f) => ({ ...f, label: e.target.value }))} sx={{ minWidth: 150 }}>
            <MenuItem value="all">Todas</MenuItem>
            {labels.map((l) => <MenuItem key={l.id} value={String(l.id)}>{l.name}</MenuItem>)}
          </TextField>
        )}
        <Chip label="Atrasadas" size="small" color={filters.overdue ? 'error' : 'default'} variant={filters.overdue ? 'filled' : 'outlined'} onClick={() => setFilters((f) => ({ ...f, overdue: !f.overdue }))} />
        <Chip label="Só as minhas" size="small" color={filters.mine ? 'primary' : 'default'} variant={filters.mine ? 'filled' : 'outlined'} onClick={() => setFilters((f) => ({ ...f, mine: !f.mine }))} />
        {activeFilters && (
          <Tooltip title="Limpar filtros">
            <IconButton size="small" onClick={() => setFilters(emptyFilters)}><FilterAltOffIcon fontSize="small" /></IconButton>
          </Tooltip>
        )}
      </Stack>

      {boardQ.isError && <Alert severity="error">Falha ao carregar o quadro.</Alert>}
      {view === 'board' && !boardQ.isLoading && !stages.length && (
        <Alert severity="info">Nenhuma coluna ainda. {canManage ? 'Crie uma coluna para começar.' : ''}</Alert>
      )}

      {view === 'calendar' && (
        <PapperBlock title="Calendário" subtitle="Tarefas pela data de prazo · filtre por mês/ano" icon={<CalendarMonthIcon />}>
          <CalendarView nodes={filteredNodes} realNodes={nodes} templates={templates} onOpenNode={setOpenNodeId} canManage={canManage} onReschedule={(id, dueDate) => rescheduleMut.mutate({ id, dueDate })} />
        </PapperBlock>
      )}

      {view === 'board' && (
      <PapperBlock title="Quadro" subtitle="Arraste colunas para reordenar · arraste cartões entre colunas" icon={<ViewKanbanIcon />} noPadding>
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveDrag(null)}>
          <Box sx={{ overflowX: 'auto', p: 1.5 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', minHeight: 120 }}>
              <SortableContext items={movableIds} strategy={horizontalListSortingStrategy}>
                {movable.map((s) => (
                  <BoardColumn
                    key={s.id} stage={s} nodes={colNodes(s.id)} canManage={canManage}
                    onOpenNode={setOpenNodeId} onRename={setRenameStage} onDelete={handleDeleteStage} onSortByPriority={handleSortByPriority}
                    onChanged={refresh} notify={notify}
                  />
                ))}
              </SortableContext>
              {doneStages.map((s) => (
                <DoneColumn
                  key={s.id} stage={s} nodes={colNodes(s.id)} canManage={canManage}
                  onOpenNode={setOpenNodeId} onRename={setRenameStage} onDelete={handleDeleteStage} onSortByPriority={handleSortByPriority}
                  onChanged={refresh} notify={notify}
                />
              ))}
            </Stack>
          </Box>
          <DragOverlay>
            {activeDrag?.type === 'card' && activeDrag.node && (
              <Card variant="outlined" sx={{ borderRadius: 2, width: 272, borderLeft: 4, borderLeftColor: (PRIORITY[activeDrag.node.priority] || PRIORITY.media).bar, boxShadow: 4 }}>
                <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{activeDrag.node.title}</Typography>
                </CardContent>
              </Card>
            )}
            {activeDrag?.type === 'column' && activeDrag.stage && (
              <Paper elevation={4} sx={{ width: 300, p: 1, borderRadius: 2, opacity: 0.9 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{activeDrag.stage.name}</Typography>
              </Paper>
            )}
          </DragOverlay>
        </DndContext>
      </PapperBlock>
      )}

      {dialog === 'column' && <ColumnDialog onClose={() => setDialog(null)} onSaved={refresh} notify={notify} />}
      {renameStage && <ColumnDialog initial={renameStage} onClose={() => setRenameStage(null)} onSaved={refresh} notify={notify} />}
      {dialog === 'task' && <TaskDialog stages={stages} users={usersQ.data?.items || []} labels={labels} onClose={() => setDialog(null)} onSaved={refresh} notify={notify} />}
      {dialog === 'labels' && <LabelsDialog onClose={() => setDialog(null)} notify={notify} onChanged={() => { qc.invalidateQueries({ queryKey: ['tasks-labels'] }); refresh() }} />}
      {dialog === 'checklists' && <ChecklistsDialog onClose={() => setDialog(null)} notify={notify} onChanged={() => qc.invalidateQueries({ queryKey: ['tasks-checklists'] })} />}
      {dialog === 'recurrences' && <RecurrencesDialog canManage={canManage} onOpen={setOpenNodeId} onClose={() => setDialog(null)} notify={notify} onChanged={refresh} />}
      {openNodeId && <TaskDetailDialog nodeId={openNodeId} users={usersQ.data?.items || []} stages={stages} canManage={canManage} currentUserId={user?.id} labels={labels} focusCommentId={focusCommentId} onClose={() => { setOpenNodeId(null); setFocusCommentId(null) }} onChanged={refresh} notify={notify} />}

      {toast && (
        <Paper elevation={6} sx={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1400 }}>
          <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert>
        </Paper>
      )}
    </Stack>
  )
}
