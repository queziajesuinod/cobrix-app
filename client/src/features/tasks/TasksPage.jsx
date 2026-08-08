import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Avatar, Box, Button, Card, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, LinearProgress, Menu, MenuItem, Snackbar, Stack, Tab, Table, TableBody, TableCell,
  TableHead, TableRow, Tabs, TextField, Tooltip, Typography, alpha,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import GroupsIcon from '@mui/icons-material/Groups'
import ViewKanbanIcon from '@mui/icons-material/ViewKanban'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import PersonOffRoundedIcon from '@mui/icons-material/PersonOffRounded'
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import ChecklistRoundedIcon from '@mui/icons-material/ChecklistRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import GroupAddRoundedIcon from '@mui/icons-material/GroupAddRounded'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCorners, useDroppable, useDraggable,
} from '@dnd-kit/core'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { useConfirm } from '@/components/ConfirmDialog'
import { tasksService } from './tasks.service'

const pad = (n) => String(n).padStart(2, '0')
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const currentYm = () => todayISO().slice(0, 7)
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const ymLabel = (ym) => { const [y, m] = ym.split('-'); return `${MES[Number(m) - 1]}/${y}` }
const addYm = (ym, d) => { const [y, m] = ym.split('-').map(Number); const i = y * 12 + (m - 1) + d; return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}` }
const fmtBR = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '')
const daysUntil = (iso) => Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000)
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?'

// Tom semântico do cartão pela situação de prazo (borda de acento + selo).
function dueTone(card) {
  if (card.status === 'done') return 'success'
  if (card.due_date) {
    const d = daysUntil(String(card.due_date).slice(0, 10))
    if (d < 0) return 'error'
    if (d <= 3) return 'warning'
  } else if (card.months_rolled > 0) return 'warning'
  return 'neutral'
}
const sxChip = { height: 22, borderRadius: 1, fontSize: 11.5, fontWeight: 600, '& .MuiChip-icon': { fontSize: 14, ml: 0.5 } }

// Selo de prazo do cartão.
function dueChip(card) {
  const common = { size: 'small', variant: 'outlined', sx: sxChip }
  if (card.status === 'done') return <Chip {...common} color="success" icon={<CheckCircleRoundedIcon />} label="Concluída" />
  if (card.due_date) {
    const d = daysUntil(String(card.due_date).slice(0, 10))
    if (d < 0) return <Chip {...common} color="error" icon={<WarningAmberRoundedIcon />} label={`Atrasada ${-d}d`} />
    if (d <= 3) return <Chip {...common} color="warning" icon={<ScheduleRoundedIcon />} label={d === 0 ? 'Vence hoje' : `Vence em ${d}d`} />
    return <Chip {...common} icon={<ScheduleRoundedIcon />} label={fmtBR(card.due_date)} />
  }
  if (card.months_rolled > 0) return <Chip {...common} color="warning" icon={<RepeatRoundedIcon />} label="Rolou de mês" />
  return null
}

function CardDialog({ cardId, canManage, columns = [], onClose, notify, refetchBoard }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['task-card', cardId], queryFn: () => tasksService.card(cardId), enabled: !!cardId })
  const card = q.data?.card
  const items = q.data?.items || []
  const activity = q.data?.activity || []
  const confirm = useConfirm()
  const [newItem, setNewItem] = React.useState('')
  const [newItemStage, setNewItemStage] = React.useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['task-card', cardId] }); refetchBoard() }
  const toggle = useMutation({ mutationFn: ({ id, done }) => tasksService.toggleItem(id, done), onSuccess: refresh, onError: (e) => notify(e?.response?.data?.error || 'Falha ao atualizar micro.', 'error') })
  const add = useMutation({ mutationFn: () => tasksService.addItem(cardId, { title: newItem.trim(), stage_column_id: newItemStage || card?.column_id }), onSuccess: () => { setNewItem(''); refresh() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao adicionar.', 'error') })
  const del = useMutation({ mutationFn: () => tasksService.deleteCard(cardId), onSuccess: () => { notify('Tarefa excluída.'); refetchBoard(); onClose() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error') })
  // Responsável: o gerente distribui entre os membros da equipe.
  const membersQ = useQuery({ queryKey: ['task-members', card?.team_id], queryFn: () => tasksService.members(card.team_id), enabled: canManage && !!card?.team_id })
  const members = membersQ.data?.items || []
  const setAssignee = useMutation({ mutationFn: (uid) => tasksService.updateCard(cardId, { assignee_id: uid || null }), onSuccess: () => { notify('Responsável atualizado.'); refresh() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao atribuir.', 'error') })

  const curCol = columns.find((c) => c.id === card?.column_id)
  const curColName = curCol?.name
  const stage = items.filter((it) => it.stage_column_id === card?.column_id || it.stage_column_id == null)
  const others = items.filter((it) => it.stage_column_id != null && it.stage_column_id !== card?.column_id).length
  const doneN = stage.filter((it) => it.done).length
  // Excluir macro só se: nenhuma micro pendente E não estiver na etapa final.
  const hasPending = items.some((it) => !it.done)
  const isFinal = Boolean(curCol?.is_done_col)
  const deleteBlock = isFinal ? 'Tarefa na etapa final não pode ser excluída.' : hasPending ? 'Conclua ou remova as micro-tarefas pendentes primeiro.' : null
  const handleDelete = async () => {
    const ok = await confirm({ title: 'Excluir tarefa', description: `Excluir "${card?.title}"? Esta ação não pode ser desfeita.`, confirmText: 'Excluir', tone: 'danger' })
    if (ok) del.mutate()
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ p: 0 }}>
        <Box sx={{ px: 3, pt: 2.5, pb: 2, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 20, lineHeight: 1.25, wordBreak: 'break-word' }}>{card?.title || 'Tarefa'}</Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
              {curColName && <Chip size="small" variant="outlined" icon={<ViewColumnIcon />} label={curColName} sx={sxChip} />}
              {card && dueChip(card)}
              {card?.months_rolled > 0 && <Chip size="small" color="warning" variant="outlined" icon={<RepeatRoundedIcon />} label={`${card.months_rolled}× rolada`} sx={sxChip} />}
            </Stack>
          </Box>
          <IconButton onClick={onClose} size="small" aria-label="Fechar"><CloseRoundedIcon /></IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {q.isLoading ? <Box sx={{ p: 3 }}><LinearProgress /></Box> : (
          <Stack direction={{ xs: 'column', md: 'row' }} alignItems="stretch" divider={<Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />}>
            {/* Esquerda: descrição + micro-tarefas */}
            <Box sx={{ flex: 1.7, p: 3, minWidth: 0 }}>
              {card?.description && (
                <Box sx={{ mb: 2.5 }}>
                  <Typography variant="overline" color="text.secondary">Descrição</Typography>
                  <Typography variant="body2" sx={{ mt: 0.25, whiteSpace: 'pre-wrap' }}>{card.description}</Typography>
                </Box>
              )}
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
                <ChecklistRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Micro-tarefas desta coluna</Typography>
                {stage.length > 0 && <Chip size="small" variant="outlined" label={`${doneN}/${stage.length}`} sx={sxChip} />}
              </Stack>
              {stage.length > 0 && <LinearProgress variant="determinate" value={Math.round((doneN / stage.length) * 100)} color={doneN === stage.length ? 'success' : 'primary'} sx={{ height: 6, borderRadius: 3, mb: 1.5, bgcolor: 'action.hover' }} />}
              <Stack sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                {stage.map((it, i) => (
                  <Stack key={it.id} direction="row" alignItems="center" spacing={0.5}
                    sx={{ px: 0.5, py: 0.25, borderTop: i ? '1px solid' : 'none', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
                    <Checkbox size="small" checked={it.done} onChange={(e) => toggle.mutate({ id: it.id, done: e.target.checked })} sx={{ p: 0.75 }} />
                    <Typography variant="body2" sx={{ textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'text.disabled' : 'text.primary' }}>{it.title}</Typography>
                  </Stack>
                ))}
                {!stage.length && <Typography variant="caption" color="text.secondary" sx={{ p: 1.5 }}>Nenhuma micro-tarefa nesta coluna.</Typography>}
              </Stack>
              {others > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                  + {others} micro(s) em outras colunas — aparecem quando o cartão chegar lá.
                </Typography>
              )}
              {canManage && (
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="flex-start">
                  <TextField select size="small" label="Etapa" value={newItemStage || card?.column_id || ''} onChange={(e) => setNewItemStage(e.target.value)} sx={{ minWidth: 130 }}>
                    {columns.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                  </TextField>
                  <TextField size="small" fullWidth placeholder="Nova micro-tarefa" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newItem.trim()) add.mutate() }} />
                  <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={!newItem.trim() || add.isPending} onClick={() => add.mutate()} sx={{ flexShrink: 0, mt: 0.25 }}>Adicionar</Button>
                </Stack>
              )}
            </Box>

            {/* Direita: responsável + histórico */}
            <Box sx={{ flex: 1, p: 3, minWidth: 0, bgcolor: (t) => alpha(t.palette.text.primary, 0.02) }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><PersonRoundedIcon sx={{ fontSize: 16 }} /> Responsável</Typography>
              {canManage ? (
                <TextField select size="small" value={card?.assignee_id || ''} onChange={(e) => setAssignee.mutate(Number(e.target.value) || null)} fullWidth sx={{ mt: 0.5 }}>
                  <MenuItem value=""><em>Sem responsável</em></MenuItem>
                  {members.map((m) => <MenuItem key={m.user_id} value={m.user_id}>{m.name}{m.role === 'manager' ? ' (gerente)' : ''}</MenuItem>)}
                </TextField>
              ) : (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                  {card?.assignee_name
                    ? <><Avatar sx={{ width: 26, height: 26, fontSize: 12, fontWeight: 700, bgcolor: 'primary.main' }}>{initials(card.assignee_name)}</Avatar><Typography variant="body2">{card.assignee_name}</Typography></>
                    : <Chip size="small" variant="outlined" color="warning" label="Sem responsável" />}
                </Stack>
              )}

              <Divider sx={{ my: 2 }} />
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
                <HistoryRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Histórico</Typography>
              </Stack>
              <Stack spacing={1.5} sx={{ maxHeight: 300, overflow: 'auto' }}>
                {activity.map((a) => (
                  <Stack key={a.id} direction="row" spacing={1.25} alignItems="flex-start">
                    <Box sx={{ mt: '5px', width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', bgcolor: 'primary.main' }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ lineHeight: 1.35 }}><b>{a.user_name || 'Sistema'}</b> {actionLabel(a)}</Typography>
                      <Typography variant="caption" color="text.secondary">{fmtBR(a.created_at)}</Typography>
                    </Box>
                  </Stack>
                ))}
                {!activity.length && <Typography variant="caption" color="text.secondary">Sem movimentações.</Typography>}
              </Stack>
            </Box>
          </Stack>
        )}
      </DialogContent>
      {canManage && (
        <DialogActions sx={{ px: 3, py: 1.5, justifyContent: 'space-between' }}>
          <Tooltip title={deleteBlock || ''}>
            <span>
              <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} disabled={Boolean(deleteBlock) || del.isPending} onClick={handleDelete}>
                Excluir tarefa
              </Button>
            </span>
          </Tooltip>
          <Button size="small" onClick={onClose}>Fechar</Button>
        </DialogActions>
      )}
    </Dialog>
  )
}

function actionLabel(a) {
  switch (a.action) {
    case 'created': return 'criou a tarefa'
    case 'moved': return `moveu de "${a.from_name || '—'}" para "${a.to_name || '—'}"`
    case 'item_done': return `concluiu "${a.detail || 'micro'}"`
    case 'item_undone': return `reabriu "${a.detail || 'micro'}"`
    case 'item_added': return `adicionou "${a.detail || 'micro'}"`
    case 'rolled': return a.detail || 'rolou de mês'
    case 'assigned': return 'definiu o responsável'
    case 'edited': return 'editou a tarefa'
    default: return a.action
  }
}

function NewCardDialog({ teamId, columns, ym, onClose, onSaved, notify }) {
  // Não é possível criar tarefa na etapa final.
  const openColumns = columns.filter((c) => !c.is_done_col)
  const [form, setForm] = React.useState({ title: '', description: '', column_id: openColumns[0]?.id || '', due_date: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const mut = useMutation({
    mutationFn: () => tasksService.createCard(teamId, { ...form, ym, due_date: form.due_date || undefined }),
    onSuccess: () => { notify('Tarefa criada.'); onSaved(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao criar.', 'error'),
  })
  const valid = form.title.trim().length >= 2 && form.column_id
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Nova tarefa</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Título" value={form.title} onChange={set('title')} required fullWidth autoFocus />
          <TextField label="Descrição" value={form.description} onChange={set('description')} fullWidth multiline minRows={2} />
          <TextField select label="Coluna" value={form.column_id} onChange={set('column_id')} fullWidth>
            {openColumns.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField type="date" label="Prazo (opcional)" value={form.due_date} onChange={set('due_date')} InputLabelProps={{ shrink: true }} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>Criar</Button>
      </DialogActions>
    </Dialog>
  )
}

// Editor de modelo de tarefa: nome, equipe, prazo padrão e micros por etapa.
function ModelEditorDialog({ model, teams, onClose, onSaved, notify }) {
  const isEdit = Boolean(model?.id)
  const detailQ = useQuery({ queryKey: ['task-model', model?.id], queryFn: () => tasksService.model(model.id), enabled: isEdit })
  const [form, setForm] = React.useState({ name: '', title: '', team_id: teams[0]?.id || '', due_days: '' })
  const [items, setItems] = React.useState([])
  React.useEffect(() => {
    if (isEdit && detailQ.data) {
      const m = detailQ.data.model
      setForm({ name: m.name, title: m.title || '', team_id: m.team_id || '', due_days: m.due_days ?? '' })
      setItems((detailQ.data.items || []).map((i) => ({ stage_name: i.stage_name, title: i.title })))
    }
  }, [isEdit, detailQ.data])
  const colsQ = useQuery({ queryKey: ['task-cols', form.team_id], queryFn: () => tasksService.columns(form.team_id), enabled: !!form.team_id })
  const cols = colsQ.data?.items || []
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setItem = (i, k, v) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)))
  const addItem = () => setItems((arr) => [...arr, { stage_name: cols[0]?.name || '', title: '' }])
  const rmItem = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i))

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        title: form.title.trim() || null,
        team_id: form.team_id || null,
        due_days: form.due_days === '' ? null : Number(form.due_days),
        items: items.filter((it) => it.title.trim()).map((it) => ({ stage_name: it.stage_name, title: it.title.trim() })),
      }
      return isEdit ? tasksService.updateModel(model.id, payload) : tasksService.createModel(payload)
    },
    onSuccess: () => { notify('Modelo salvo.'); onSaved(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar modelo.', 'error'),
  })
  const valid = form.name.trim().length >= 2

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>{isEdit ? 'Editar modelo' : 'Novo modelo de tarefa'}</DialogTitle>
      <DialogContent dividers>
        {!teams.length ? (
          <Alert severity="warning">Crie uma equipe antes de montar modelos (o modelo precisa de uma equipe para gerar o cartão).</Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Nome do modelo (ex.: Abertura de empresa)" value={form.name} onChange={set('name')} required fullWidth autoFocus />
            <TextField label="Título do cartão gerado (opcional)" value={form.title} onChange={set('title')} fullWidth placeholder="Se vazio, usa o nome do modelo" />
            <Stack direction="row" spacing={2}>
              <TextField select label="Equipe" value={form.team_id} onChange={set('team_id')} fullWidth>
                {teams.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
              </TextField>
              <TextField type="number" label="Prazo padrão (dias)" value={form.due_days} onChange={set('due_days')} inputProps={{ min: 0 }} sx={{ width: 180 }} />
            </Stack>
            <Divider />
            <Typography variant="overline" color="text.secondary">Micro-tarefas por etapa</Typography>
            <Stack spacing={1}>
              {items.map((it, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <TextField select size="small" label="Etapa" value={cols.some((c) => c.name === it.stage_name) ? it.stage_name : ''} onChange={(e) => setItem(i, 'stage_name', e.target.value)} sx={{ minWidth: 150 }}>
                    {cols.map((c) => <MenuItem key={c.id} value={c.name}>{c.name}</MenuItem>)}
                  </TextField>
                  <TextField size="small" placeholder="Micro-tarefa" value={it.title} onChange={(e) => setItem(i, 'title', e.target.value)} sx={{ flex: 1 }} />
                  <IconButton size="small" color="error" onClick={() => rmItem(i)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </Stack>
              ))}
              <Button size="small" startIcon={<AddIcon />} onClick={addItem} disabled={!cols.length}>Adicionar micro</Button>
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!valid || save.isPending || !teams.length} onClick={() => save.mutate()}>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

function ModelsManager({ teams, notify }) {
  const q = useQuery({ queryKey: ['task-models'], queryFn: () => tasksService.models() })
  const models = q.data?.items || []
  const [editing, setEditing] = React.useState(null)
  const del = useMutation({ mutationFn: (id) => tasksService.deleteModel(id), onSuccess: () => { notify('Modelo excluído.'); q.refetch() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error') })
  return (
    <PapperBlock title="Modelos de tarefa" subtitle="Checklists padronizados por etapa — usados no cadastro de contrato ou avulsos." icon={<ViewKanbanIcon />} iconColor="linear-gradient(135deg,#4f46e5,#8b87f5)" noPadding>
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Novo modelo</Button>
      </Box>
      <Divider />
      <Box sx={{ overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Modelo</TableCell><TableCell>Equipe</TableCell><TableCell align="right">Prazo (dias)</TableCell>
              <TableCell align="right">Micros</TableCell><TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m.id} hover>
                <TableCell><Typography sx={{ fontWeight: 600 }}>{m.name}</Typography></TableCell>
                <TableCell>{m.team_name || <Typography variant="caption" color="warning.main">sem equipe</Typography>}</TableCell>
                <TableCell align="right">{m.due_days ?? '—'}</TableCell>
                <TableCell align="right">{m.items}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => setEditing(m)}><ViewColumnIcon fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => del.mutate(m.id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {!models.length && <TableRow><TableCell colSpan={5}><Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>Nenhum modelo. Crie o primeiro.</Box></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>
      {editing && <ModelEditorDialog model={editing.id ? editing : null} teams={teams} onClose={() => setEditing(null)} onSaved={() => q.refetch()} notify={notify} />}
    </PapperBlock>
  )
}

// Criar equipe (Admin): nome + gerente opcional. Colunas padrão são semeadas no servidor.
function NewTeamDialog({ onClose, onCreated, notify }) {
  const [name, setName] = React.useState('')
  const [managerId, setManagerId] = React.useState('')
  const usersQ = useQuery({ queryKey: ['task-company-users'], queryFn: () => tasksService.companyUsers() })
  const users = usersQ.data?.items || []
  const mut = useMutation({
    mutationFn: () => tasksService.createTeam({ name: name.trim(), manager_id: managerId || undefined }),
    onSuccess: (team) => { notify('Equipe criada.'); onCreated(team); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao criar equipe.', 'error'),
  })
  const valid = name.trim().length >= 2
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Nova equipe</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Nome da equipe" value={name} onChange={(e) => setName(e.target.value)} required fullWidth autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && valid && !mut.isPending) mut.mutate() }} />
          <TextField select label="Gerente (opcional)" value={managerId} onChange={(e) => setManagerId(e.target.value)} fullWidth>
            <MenuItem value=""><em>Definir depois</em></MenuItem>
            {users.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
          </TextField>
          <Typography variant="caption" color="text.secondary">As colunas padrão (A fazer, Em andamento, Concluído) são criadas automaticamente — você pode editar depois.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>Criar equipe</Button>
      </DialogActions>
    </Dialog>
  )
}

// Membros da equipe (Admin): vincula usuários e define gerente/membro. É aqui que
// as pessoas passam a poder receber tarefas como responsável.
function MembersDialog({ teamId, teamName, onClose, notify }) {
  const qc = useQueryClient()
  const membersQ = useQuery({ queryKey: ['task-members', teamId], queryFn: () => tasksService.members(teamId), enabled: !!teamId })
  const usersQ = useQuery({ queryKey: ['task-company-users'], queryFn: () => tasksService.companyUsers() })
  const members = membersQ.data?.items || []
  const users = usersQ.data?.items || []
  const [userId, setUserId] = React.useState('')
  const [role, setRole] = React.useState('member')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['task-members', teamId] }); qc.invalidateQueries({ queryKey: ['task-teams'] }) }
  const add = useMutation({ mutationFn: () => tasksService.addMember(teamId, { user_id: Number(userId), role }), onSuccess: () => { setUserId(''); setRole('member'); notify('Membro vinculado.'); refresh() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao vincular.', 'error') })
  const changeRole = useMutation({ mutationFn: ({ id, r }) => tasksService.addMember(teamId, { user_id: id, role: r }), onSuccess: refresh, onError: (e) => notify(e?.response?.data?.error || 'Falha ao alterar papel.', 'error') })
  const remove = useMutation({ mutationFn: (id) => tasksService.removeMember(teamId, id), onSuccess: () => { notify('Membro removido.'); refresh() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao remover.', 'error') })
  const memberIds = new Set(members.map((m) => m.user_id))
  const available = users.filter((u) => !memberIds.has(u.id))

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Membros — {teamName}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1}>
          {members.map((m) => (
            <Stack key={m.user_id} direction="row" spacing={1} alignItems="center">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{m.name}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>{m.email}</Typography>
              </Box>
              <TextField select size="small" value={m.role} onChange={(e) => changeRole.mutate({ id: m.user_id, r: e.target.value })} sx={{ width: 130 }}>
                <MenuItem value="member">Membro</MenuItem>
                <MenuItem value="manager">Gerente</MenuItem>
              </TextField>
              <IconButton size="small" color="error" onClick={() => remove.mutate(m.user_id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
            </Stack>
          ))}
          {!members.length && <Typography variant="caption" color="text.secondary">Nenhum membro ainda.</Typography>}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Typography variant="overline" color="text.secondary">Vincular usuário</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
          <TextField select size="small" label="Usuário" value={userId} onChange={(e) => setUserId(e.target.value)} sx={{ flex: 1 }}>
            {available.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
            {!available.length && <MenuItem value="" disabled>Todos já vinculados</MenuItem>}
          </TextField>
          <TextField select size="small" label="Papel" value={role} onChange={(e) => setRole(e.target.value)} sx={{ width: 120 }}>
            <MenuItem value="member">Membro</MenuItem>
            <MenuItem value="manager">Gerente</MenuItem>
          </TextField>
          <Button variant="outlined" disabled={!userId || add.isPending} onClick={() => add.mutate()}>Add</Button>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}><Button variant="contained" disableElevation onClick={onClose}>Concluir</Button></DialogActions>
    </Dialog>
  )
}

// Cartão apresentacional (usado na coluna e no overlay de arraste).
function CardTile({ card, columns, dragging }) {
  const pct = card.items_total ? Math.round((card.items_done / card.items_total) * 100) : (card.status === 'done' ? 100 : 0)
  const idx = columns.findIndex((c) => c.id === card.column_id)
  const forwardBlocked = idx < columns.length - 1 && card.stage_open > 0
  const tone = dueTone(card)
  const accent = tone === 'neutral' ? 'divider' : `${tone}.main`
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2, position: 'relative', cursor: 'grab', bgcolor: 'background.paper',
        borderLeft: '3px solid', borderLeftColor: accent,
        boxShadow: dragging ? 6 : 0,
        transition: 'box-shadow .18s ease, border-color .18s ease, transform .12s ease',
        '&:hover': { boxShadow: 2, borderColor: 'primary.main', borderLeftColor: accent },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Typography sx={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.35, flex: 1, wordBreak: 'break-word', textDecoration: card.status === 'done' ? 'line-through' : 'none', color: card.status === 'done' ? 'text.secondary' : 'text.primary' }}>{card.title}</Typography>
          {card.assignee_name ? (
            <Tooltip title={`Responsável: ${card.assignee_name}`}>
              <Avatar sx={{ width: 24, height: 24, fontSize: 11, fontWeight: 700, bgcolor: 'primary.main' }}>{initials(card.assignee_name)}</Avatar>
            </Tooltip>
          ) : (
            <Tooltip title="Sem responsável">
              <Avatar variant="rounded" sx={{ width: 24, height: 24, bgcolor: 'transparent', color: 'warning.main', border: '1px dashed', borderColor: 'warning.main' }}>
                <PersonOutlineRoundedIcon sx={{ fontSize: 15 }} />
              </Avatar>
            </Tooltip>
          )}
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
          {dueChip(card)}
          {forwardBlocked && (
            <Tooltip title={`${card.stage_open} micro(s) a fechar nesta coluna`}>
              <Chip size="small" color="warning" variant="filled" icon={<LockOutlinedIcon />} label={card.stage_open}
                sx={{ ...sxChip, color: 'warning.contrastText', bgcolor: 'warning.main', '& .MuiChip-icon': { color: 'inherit', fontSize: 14, ml: 0.5 } }} />
            </Tooltip>
          )}
        </Stack>
        {card.items_total > 0 && (
          <Box sx={{ mt: 1 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                <ChecklistRoundedIcon sx={{ fontSize: 14 }} /> {card.items_done}/{card.items_total}
              </Typography>
              <Typography variant="caption" color={pct === 100 ? 'success.main' : 'text.secondary'} sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{pct}%</Typography>
            </Stack>
            <LinearProgress variant="determinate" value={pct} color={pct === 100 ? 'success' : 'primary'} sx={{ borderRadius: 2, height: 5, bgcolor: 'action.hover' }} />
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

function DraggableCard({ card, columns, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `card:${card.id}`, data: { card } })
  return (
    <Box ref={setNodeRef} {...attributes} {...listeners}
      onClick={() => onOpen(card.id)}
      sx={{ opacity: isDragging ? 0.4 : 1, touchAction: 'none' }}>
      <CardTile card={card} columns={columns} />
    </Box>
  )
}

// Compositor de novo cartão dentro da coluna (estilo Trello).
function AddCardComposer({ onAdd }) {
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const submit = async () => {
    const t = title.trim()
    if (!t) return
    setBusy(true)
    try { await onAdd(t); setTitle('') } finally { setBusy(false) }
  }
  if (!open) {
    return (
      <Button fullWidth size="small" startIcon={<AddIcon />} onClick={() => setOpen(true)}
        sx={{ justifyContent: 'flex-start', color: 'text.secondary', textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}>
        Adicionar cartão
      </Button>
    )
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <TextField
        autoFocus multiline size="small" placeholder="Título do cartão…" value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } if (e.key === 'Escape') setOpen(false) }}
        sx={{ bgcolor: 'background.paper', borderRadius: 1 }}
      />
      <Stack direction="row" spacing={1} alignItems="center">
        <Button size="small" variant="contained" disableElevation disabled={!title.trim() || busy} onClick={submit}>Adicionar</Button>
        <IconButton size="small" onClick={() => { setOpen(false); setTitle('') }}><CloseRoundedIcon fontSize="small" /></IconButton>
      </Stack>
    </Box>
  )
}

function DroppableColumn({ col, cards, columns, onOpen, canManage, index, total, onMove, onQuickAdd }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` })
  const [menuEl, setMenuEl] = React.useState(null)
  const closeMenu = () => setMenuEl(null)
  return (
    <Box ref={setNodeRef}
      sx={{
        borderRadius: 2.5, p: 1, display: 'flex', flexDirection: 'column', gap: 1,
        bgcolor: (t) => alpha(t.palette.text.primary, isOver ? 0.08 : 0.035),
        border: '1px solid', borderColor: isOver ? 'primary.main' : 'divider',
        transition: 'background-color .15s ease, border-color .15s ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 0.75, py: 0.25 }}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
          {col.is_done_col && <CheckCircleRoundedIcon sx={{ fontSize: 16, color: 'success.main' }} />}
          <Typography noWrap sx={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.secondary' }}>{col.name}</Typography>
        </Stack>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Box sx={{ minWidth: 20, height: 20, px: 0.75, borderRadius: 5, display: 'grid', placeItems: 'center', bgcolor: 'action.selected', color: 'text.secondary', fontSize: 11.5, fontWeight: 700 }}>{cards.length}</Box>
          {canManage && (
            <IconButton size="small" onClick={(e) => setMenuEl(e.currentTarget)} aria-label="Ações da lista"><MoreHorizRoundedIcon fontSize="small" /></IconButton>
          )}
        </Stack>
      </Stack>

      <Menu anchorEl={menuEl} open={Boolean(menuEl)} onClose={closeMenu}>
        <MenuItem disabled={index === 0} onClick={() => { onMove(col, -1); closeMenu() }}>Mover para a esquerda</MenuItem>
        <MenuItem disabled={index === total - 1} onClick={() => { onMove(col, 1); closeMenu() }}>Mover para a direita</MenuItem>
      </Menu>

      {cards.map((c) => <DraggableCard key={c.id} card={c} columns={columns} onOpen={onOpen} />)}
      {!cards.length && (
        <Box sx={{ py: 3, textAlign: 'center', color: 'text.disabled', fontSize: 12, borderRadius: 2, border: '1px dashed', borderColor: 'divider', m: 0.5 }}>
          {isOver ? 'Soltar aqui' : 'Sem cartões'}
        </Box>
      )}
      {canManage && !col.is_done_col && <AddCardComposer onAdd={(title) => onQuickAdd(col.id, title)} />}
    </Box>
  )
}

// Gerenciar colunas (livres): criar, renomear, marcar coluna final, reordenar, excluir.
function ColumnsDialog({ teamId, columns, onClose, onChanged, notify }) {
  const [name, setName] = React.useState('')
  const add = useMutation({ mutationFn: () => tasksService.createColumn(teamId, { name: name.trim() }), onSuccess: () => { setName(''); onChanged() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao criar coluna.', 'error') })
  const upd = useMutation({ mutationFn: ({ id, payload }) => tasksService.updateColumn(id, payload), onSuccess: onChanged, onError: (e) => notify(e?.response?.data?.error || 'Falha ao atualizar.', 'error') })
  const del = useMutation({ mutationFn: (id) => tasksService.deleteColumn(id), onSuccess: onChanged, onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir.', 'error') })
  const swap = (a, b) => { upd.mutate({ id: a.id, payload: { position: b.position } }); upd.mutate({ id: b.id, payload: { position: a.position } }) }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Colunas do quadro</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1}>
          {columns.map((c, i) => (
            <Stack key={c.id} direction="row" spacing={0.5} alignItems="center">
              <TextField size="small" defaultValue={c.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) upd.mutate({ id: c.id, payload: { name: v } }) }} sx={{ flex: 1 }} />
              <Tooltip title={c.is_done_col ? 'Coluna final (entrega)' : 'Marcar como coluna final'}>
                <IconButton size="small" color={c.is_done_col ? 'success' : 'default'} onClick={() => upd.mutate({ id: c.id, payload: { is_done_col: !c.is_done_col } })}>✓</IconButton>
              </Tooltip>
              <IconButton size="small" disabled={i === 0} onClick={() => swap(c, columns[i - 1])}><ArrowUpwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" disabled={i === columns.length - 1} onClick={() => swap(c, columns[i + 1])}><ArrowDownwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" color="error" onClick={() => del.mutate(c.id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <TextField size="small" fullWidth placeholder="Nova coluna" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) add.mutate() }} />
          <Button variant="outlined" startIcon={<AddIcon />} disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>Add</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>Para excluir uma coluna, mova antes os cartões dela.</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}><Button variant="contained" disableElevation onClick={onClose}>Concluir</Button></DialogActions>
    </Dialog>
  )
}

// Indicador compacto de SLA (ícone + valor + rótulo).
function StatPill({ icon, label, value, tone = 'primary' }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 0.9, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', minWidth: 132 }}>
      <Box sx={{ width: 30, height: 30, borderRadius: 1.5, flex: '0 0 auto', display: 'grid', placeItems: 'center', color: `${tone}.main`, bgcolor: (t) => alpha(t.palette[tone].main, t.palette.mode === 'dark' ? 0.22 : 0.12) }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{label}</Typography>
      </Box>
    </Box>
  )
}

export default function TasksPage() {
  const { selectedCompanyId } = useAuth()
  const { can } = usePermissions()
  const qc = useQueryClient()
  const enabled = Number.isInteger(selectedCompanyId)
  const [toast, setToast] = React.useState(null)
  const notify = (msg, sev = 'success') => setToast({ msg, sev })
  const [teamId, setTeamId] = React.useState(null)
  const [ym, setYm] = React.useState(currentYm())
  const [openCard, setOpenCard] = React.useState(null)
  const [newCard, setNewCard] = React.useState(false)
  const [newTeam, setNewTeam] = React.useState('')
  const [manageCols, setManageCols] = React.useState(false)
  const [manageMembers, setManageMembers] = React.useState(false)
  const [newTeamOpen, setNewTeamOpen] = React.useState(false)
  const [view, setView] = React.useState('board')
  const [activeId, setActiveId] = React.useState(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))

  const teamsQ = useQuery({ queryKey: ['task-teams', selectedCompanyId], queryFn: () => tasksService.teams(), enabled })
  const teams = teamsQ.data?.items || []
  const isAdmin = teamsQ.data?.isAdmin
  React.useEffect(() => { if (!teamId && teams.length) setTeamId(teams[0].id) }, [teams, teamId])
  const activeTeam = teams.find((t) => t.id === teamId)
  // Gestão é definida pelo PAPEL na equipe (gerente) ou por ser admin.
  const canManage = Boolean(isAdmin || activeTeam?.my_role === 'manager')
  const canManageModels = Boolean(isAdmin || teams.some((t) => t.my_role === 'manager'))

  const boardQ = useQuery({ queryKey: ['task-board', teamId, ym], queryFn: () => tasksService.board(teamId, ym), enabled: enabled && !!teamId })
  const columns = boardQ.data?.columns || []
  const cards = boardQ.data?.cards || []
  const statsQ = useQuery({ queryKey: ['task-stats', teamId], queryFn: () => tasksService.stats(teamId), enabled: enabled && !!teamId && view === 'board' })
  const stats = statsQ.data
  const boardRole = boardQ.data?.role
  const refetchBoard = () => { qc.invalidateQueries({ queryKey: ['task-board'] }); qc.invalidateQueries({ queryKey: ['task-stats'] }) }

  const createTeam = useMutation({ mutationFn: () => tasksService.createTeam({ name: newTeam.trim() }), onSuccess: () => { setNewTeam(''); notify('Equipe criada.'); teamsQ.refetch() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao criar equipe.', 'error') })
  const move = useMutation({
    mutationFn: ({ id, to }) => tasksService.moveCard(id, to),
    onSuccess: (updated, { id, to }) => {
      // Move o cartão no cache na hora (não depende do refetch) e reconcilia.
      qc.setQueriesData({ queryKey: ['task-board'] }, (old) => (
        old?.cards ? { ...old, cards: old.cards.map((c) => (c.id === id ? { ...c, column_id: to, status: updated?.status ?? c.status } : c)) } : old
      ))
      refetchBoard()
    },
    onError: (e) => notify(e?.response?.data?.error || 'Não foi possível mover.', 'warning'),
  })
  const colUpdate = useMutation({ mutationFn: ({ id, payload }) => tasksService.updateColumn(id, payload), onSuccess: refetchBoard, onError: (e) => notify(e?.response?.data?.error || 'Falha ao reordenar.', 'error') })
  const quickAdd = useMutation({ mutationFn: ({ columnId, title }) => tasksService.createCard(teamId, { title, column_id: columnId, ym }), onSuccess: refetchBoard, onError: (e) => notify(e?.response?.data?.error || 'Falha ao criar cartão.', 'error') })
  // Troca a posição da coluna com a vizinha (ordenar listas).
  const moveColumn = (col, dir) => {
    const i = columns.findIndex((c) => c.id === col.id)
    const j = i + dir
    if (j < 0 || j >= columns.length) return
    const other = columns[j]
    colUpdate.mutate({ id: col.id, payload: { position: other.position } })
    colUpdate.mutate({ id: other.id, payload: { position: col.position } })
  }

  // Filtro por responsável (visão do gerente): "" = todos, "none" = sem responsável, id = pessoa.
  const [filterAssignee, setFilterAssignee] = React.useState('')
  React.useEffect(() => { setFilterAssignee('') }, [teamId, ym])
  const assignees = React.useMemo(() => {
    const map = new Map()
    let hasUnassigned = false
    for (const c of cards) {
      if (c.assignee_id) map.set(c.assignee_id, c.assignee_name || `#${c.assignee_id}`)
      else hasUnassigned = true
    }
    return { list: [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), hasUnassigned }
  }, [cards])
  const matchesFilter = (c) => !filterAssignee || (filterAssignee === 'none' ? !c.assignee_id : Number(c.assignee_id) === Number(filterAssignee))
  const cardsByCol = (colId) => cards.filter((c) => c.column_id === colId && matchesFilter(c))
  const activeCard = activeId ? cards.find((c) => `card:${c.id}` === activeId) : null

  const onDragEnd = ({ active, over }) => {
    setActiveId(null)
    if (!over) return
    const cardId = Number(String(active.id).split(':')[1])
    const toColId = Number(String(over.id).split(':')[1])
    const card = cards.find((c) => c.id === cardId)
    if (!card || card.column_id === toColId) return
    const from = columns.find((c) => c.id === card.column_id)
    const to = columns.find((c) => c.id === toColId)
    // Portão (espelha o servidor): avançar exige as micros da coluna atual fechadas.
    if (from && to && to.position > from.position && card.stage_open > 0) {
      notify(`Feche as ${card.stage_open} micro-tarefa(s) desta coluna antes de avançar.`, 'warning')
      return
    }
    move.mutate({ id: cardId, to: toColId })
  }

  if (!can('tasks.view')) {
    return <Stack spacing={2}><PageHeader title="Gerenciador de Tarefas" /><Alert severity="warning">Seu perfil não tem acesso ao Gerenciador de Tarefas.</Alert></Stack>
  }
  if (!enabled) {
    return <Stack spacing={2}><PageHeader title="Gerenciador de Tarefas" subtitle="Quadro Kanban por equipe." /><CompanyRequiredAlert /></Stack>
  }

  const monthControl = (
    <Stack direction="row" spacing={1} alignItems="center">
      <IconButton size="small" onClick={() => setYm(addYm(ym, -1))}><ChevronLeftIcon /></IconButton>
      <Chip label={ymLabel(ym)} variant="outlined" sx={{ fontWeight: 700, minWidth: 96 }} />
      <IconButton size="small" onClick={() => setYm(addYm(ym, 1))}><ChevronRightIcon /></IconButton>
      {ym !== currentYm() && <Button size="small" onClick={() => setYm(currentYm())}>Mês atual</Button>}
    </Stack>
  )

  return (
    <Stack spacing={2.5}>
      <PageHeader title="Gerenciador de Tarefas" subtitle="Quadro Kanban por equipe — trabalha no mês vigente; o que não fecha rola para o próximo." actions={view === 'board' ? monthControl : null} />

      {canManageModels && (
        <Tabs value={view} onChange={(_e, v) => setView(v)} sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}>
          <Tab value="board" label="Quadro" />
          <Tab value="models" label="Modelos" />
        </Tabs>
      )}

      {view === 'models' ? (
        <ModelsManager teams={teams} notify={notify} />
      ) : teamsQ.isLoading ? <LinearProgress /> : !teams.length ? (
        <Alert severity={isAdmin ? 'info' : 'warning'} icon={<GroupsIcon />}>
          {isAdmin ? 'Nenhuma equipe ainda. Crie a primeira equipe abaixo.' : 'Você ainda não faz parte de nenhuma equipe. Peça ao administrador para incluí-lo.'}
          {isAdmin && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, maxWidth: 420 }}>
              <TextField size="small" fullWidth placeholder="Nome da equipe" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} />
              <Button variant="contained" disableElevation disabled={newTeam.trim().length < 2 || createTeam.isPending} onClick={() => createTeam.mutate()}>Criar</Button>
            </Stack>
          )}
        </Alert>
      ) : (
        <>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
            <TextField select size="small" label="Equipe" value={teamId || ''} onChange={(e) => setTeamId(Number(e.target.value))} sx={{ minWidth: 210 }}
              SelectProps={{ renderValue: (val) => teams.find((t) => t.id === val)?.name || '' }}>
              {teams.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, width: '100%' }}>
                    <span>{t.name}</span>
                    <Chip size="small" variant="outlined" color={t.my_role === 'manager' ? 'primary' : 'default'} label={t.my_role === 'manager' ? 'Gerente' : 'Membro'} sx={{ height: 18, fontSize: 10.5, '& .MuiChip-label': { px: 0.75 } }} />
                  </Box>
                </MenuItem>
              ))}
            </TextField>
            {activeTeam && (
              <Chip size="small" variant="outlined" color={isAdmin ? 'secondary' : activeTeam.my_role === 'manager' ? 'primary' : 'default'}
                label={`Seu papel: ${isAdmin ? 'Admin' : activeTeam.my_role === 'manager' ? 'Gerente' : 'Membro'}`} />
            )}
            {canManage && (
              <TextField select size="small" label="Responsável" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} sx={{ minWidth: 190 }}>
                <MenuItem value="">Todos</MenuItem>
                {assignees.hasUnassigned && <MenuItem value="none">Sem responsável</MenuItem>}
                {assignees.list.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
              </TextField>
            )}
            <Box sx={{ flex: 1 }} />
            {isAdmin && <Button variant="outlined" startIcon={<GroupAddRoundedIcon />} onClick={() => setNewTeamOpen(true)}>Nova equipe</Button>}
            {isAdmin && <Button variant="outlined" startIcon={<GroupsIcon />} disabled={!activeTeam} onClick={() => setManageMembers(true)}>Membros</Button>}
            {canManage && <Button variant="outlined" startIcon={<ViewColumnIcon />} disabled={!activeTeam} onClick={() => setManageCols(true)}>Colunas</Button>}
            {canManage && <Button variant="contained" startIcon={<AddIcon />} disabled={!columns.length} onClick={() => setNewCard(true)}>Nova tarefa</Button>}
          </Stack>

          {boardRole === 'member' && (
            <Alert severity="info" sx={{ py: 0.25 }}>Você vê apenas as tarefas atribuídas a você.</Alert>
          )}
          {stats && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <StatPill tone="success" icon={<CheckCircleRoundedIcon fontSize="small" />} value={stats.onTimePct == null ? '—' : `${Math.round(stats.onTimePct * 100)}%`} label="No prazo" />
              <StatPill tone="info" icon={<ScheduleRoundedIcon fontSize="small" />} value={stats.avgDays == null ? '—' : `${stats.avgDays}d`} label="Entrega média" />
              <StatPill tone={stats.openOverdue ? 'error' : 'primary'} icon={<WarningAmberRoundedIcon fontSize="small" />} value={stats.openOverdue} label="Atrasadas abertas" />
              <StatPill tone={stats.unassigned ? 'warning' : 'primary'} icon={<PersonOffRoundedIcon fontSize="small" />} value={stats.unassigned} label="Sem responsável" />
              <StatPill tone="warning" icon={<RepeatRoundedIcon fontSize="small" />} value={stats.monthsRolledTotal} label="Meses rolados" />
            </Stack>
          )}

          <PapperBlock title={activeTeam?.name || 'Quadro'} subtitle={`Competência ${ymLabel(ym)} — arraste os cartões entre as colunas`} icon={<ViewKanbanIcon />} iconColor="linear-gradient(135deg,#4f46e5,#8b87f5)" noPadding>
            {boardQ.isLoading ? <LinearProgress /> : !columns.length ? (
              <Box sx={{ p: 3 }}><Alert severity="info">Este quadro ainda não tem colunas.{canManage ? ' Use o botão “Colunas” para criar.' : ''}</Alert></Box>
            ) : (
              <Box sx={{ p: 2, overflowX: 'auto' }}>
                <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={({ active }) => setActiveId(active.id)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(232px, 1fr))`, gap: 1.5, alignItems: 'start' }}>
                    {columns.map((col, i) => (
                      <DroppableColumn key={col.id} col={col} cards={cardsByCol(col.id)} columns={columns} onOpen={setOpenCard}
                        canManage={canManage} index={i} total={columns.length} onMove={moveColumn}
                        onQuickAdd={(columnId, title) => quickAdd.mutateAsync({ columnId, title })} />
                    ))}
                  </Box>
                  <DragOverlay>{activeCard ? <Box sx={{ width: 264 }}><CardTile card={activeCard} columns={columns} dragging /></Box> : null}</DragOverlay>
                </DndContext>
              </Box>
            )}
          </PapperBlock>
        </>
      )}

      {openCard && <CardDialog cardId={openCard} canManage={canManage} columns={columns} onClose={() => setOpenCard(null)} notify={notify} refetchBoard={refetchBoard} />}
      {newCard && <NewCardDialog teamId={teamId} columns={columns} ym={ym} onClose={() => setNewCard(false)} onSaved={refetchBoard} notify={notify} />}
      {manageCols && <ColumnsDialog teamId={teamId} columns={columns} onClose={() => setManageCols(false)} onChanged={refetchBoard} notify={notify} />}
      {manageMembers && <MembersDialog teamId={teamId} teamName={activeTeam?.name} onClose={() => setManageMembers(false)} notify={notify} />}
      {newTeamOpen && <NewTeamDialog onClose={() => setNewTeamOpen(false)} onCreated={(team) => { teamsQ.refetch(); if (team?.id) setTeamId(team.id) }} notify={notify} />}

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.sev} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
