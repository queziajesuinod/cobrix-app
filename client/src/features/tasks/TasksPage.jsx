import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Tooltip, Typography, IconButton,
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
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { usePermissions } from '@/features/permissions/PermissionsContext'
import { useConfirm } from '@/components/ConfirmDialog'
import { tasksService } from './tasks.service'
import { clientsService } from '@/features/clients/clients.service'
import { contractsService } from '@/features/contracts/contracts.service'

const PRIORITY = {
  baixa: { label: 'Baixa', color: 'default' },
  media: { label: 'Média', color: 'info' },
  alta: { label: 'Alta', color: 'warning' },
  urgente: { label: 'Urgente', color: 'error' },
}
const AVULSAS = '__avulsas__'
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const fmtDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10).split('-').reverse().join('/') : '')
const recurrenceLabel = (r, day, month) => (
  r === 'monthly' ? `Mensal · dia ${day}` : r === 'yearly' ? `Anual · ${day}/${String(month).padStart(2, '0')}` : ''
)

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

function GroupDialog({ onClose, onSaved, notify }) {
  const [form, setForm] = React.useState({ name: '', description: '', recurring: true, default_priority: 'media' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const mut = useMutation({
    mutationFn: () => tasksService.createGroup(form),
    onSuccess: () => { notify('Rotina criada.'); onSaved(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao criar rotina.', 'error'),
  })
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Nova rotina</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Nome da rotina" value={form.name} onChange={set('name')} fullWidth autoFocus />
          <TextField label="Descrição" value={form.description} onChange={set('description')} fullWidth multiline minRows={2} />
          <TextField select label="Prioridade padrão" value={form.default_priority} onChange={set('default_priority')} fullWidth>
            {Object.entries(PRIORITY).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
          </TextField>
          <FormControlLabel
            control={<Switch checked={form.recurring} onChange={(e) => setForm((f) => ({ ...f, recurring: e.target.checked }))} />}
            label="Rotina fixa (recorrente)"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={form.name.trim().length < 2 || mut.isPending} onClick={() => mut.mutate()}>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

function TaskDialog({ groups, stages, users, onClose, onSaved, notify }) {
  const [form, setForm] = React.useState({
    group_id: groups[0]?.id ? String(groups[0].id) : AVULSAS,
    title: '', description: '', assignee_id: '', priority: 'media', due_date: '', stage_id: stages[0]?.id ? String(stages[0].id) : '',
    recurrence: 'none', recurrence_day: '10', recurrence_month: '1', client_id: null, contract_id: null,
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const recurring = form.recurrence !== 'none'
  const mut = useMutation({
    mutationFn: () => tasksService.createNode({
      group_id: form.group_id === AVULSAS ? null : Number(form.group_id),
      title: form.title.trim(),
      description: form.description.trim() || null,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
      priority: form.priority,
      due_date: recurring ? null : (form.due_date || null),
      stage_id: form.stage_id ? Number(form.stage_id) : null,
      kind: form.group_id === AVULSAS ? 'avulsa' : 'fixa',
      recurrence: form.recurrence,
      recurrence_day: recurring ? Number(form.recurrence_day) : null,
      recurrence_month: form.recurrence === 'yearly' ? Number(form.recurrence_month) : null,
      // Vínculo só é enviado se escolhido; em branco, herda o da rotina no servidor.
      ...(form.client_id ? { client_id: form.client_id, contract_id: form.contract_id || null } : {}),
    }),
    onSuccess: () => { notify('Tarefa criada.'); onSaved(); onClose() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao criar tarefa.', 'error'),
  })
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Nova tarefa</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField select label="Rotina" value={form.group_id} onChange={set('group_id')} fullWidth>
            <MenuItem value={AVULSAS}>Avulsas (sem rotina)</MenuItem>
            {groups.map((g) => <MenuItem key={g.id} value={String(g.id)}>{g.name}</MenuItem>)}
          </TextField>
          <TextField label="Descrição da tarefa" value={form.title} onChange={set('title')} fullWidth autoFocus />
          <TextField label="Detalhes" value={form.description} onChange={set('description')} fullWidth multiline minRows={2} />
          <TextField select label="Responsável" value={form.assignee_id} onChange={set('assignee_id')} fullWidth>
            <MenuItem value=""><em>Sem responsável</em></MenuItem>
            {users.map((u) => <MenuItem key={u.id} value={String(u.id)}>{u.name}</MenuItem>)}
          </TextField>
          <Stack direction="row" spacing={2}>
            <TextField select label="Prioridade" value={form.priority} onChange={set('priority')} fullWidth>
              {Object.entries(PRIORITY).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
            </TextField>
            <TextField select label="Repetição" value={form.recurrence} onChange={set('recurrence')} fullWidth>
              <MenuItem value="none">Não repete</MenuItem>
              <MenuItem value="monthly">Mensal</MenuItem>
              <MenuItem value="yearly">Anual</MenuItem>
            </TextField>
          </Stack>
          {!recurring && (
            <TextField label="Prazo" type="date" value={form.due_date} onChange={set('due_date')} InputLabelProps={{ shrink: true }} fullWidth />
          )}
          {recurring && (
            <Stack direction="row" spacing={2}>
              <TextField label="Dia" type="number" inputProps={{ min: 1, max: 31 }} value={form.recurrence_day} onChange={set('recurrence_day')} fullWidth
                helperText={form.recurrence === 'monthly' ? 'Todo mês neste dia' : 'Dia do mês'} />
              {form.recurrence === 'yearly' && (
                <TextField select label="Mês" value={form.recurrence_month} onChange={set('recurrence_month')} fullWidth>
                  {MONTHS.map((m, i) => <MenuItem key={i} value={String(i + 1)}>{m}</MenuItem>)}
                </TextField>
              )}
            </Stack>
          )}
          <TextField select label="Etapa inicial" value={form.stage_id} onChange={set('stage_id')} fullWidth>
            {stages.map((s) => <MenuItem key={s.id} value={String(s.id)}>{s.name}</MenuItem>)}
          </TextField>
          <ClientContractPicker clientId={form.client_id} contractId={form.contract_id} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
          <Typography variant="caption" color="text.secondary">Cliente/contrato em branco herda o da rotina.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button variant="contained" disableElevation disabled={form.title.trim().length < 2 || mut.isPending} onClick={() => mut.mutate()}>Salvar</Button>
      </DialogActions>
    </Dialog>
  )
}

function TaskCard({ node, canManage, onOpen, onChanged, notify, onDragStart, onDragEnd, dragging }) {
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
  const p = PRIORITY[node.priority] || PRIORITY.media
  const done = node.status === 'done'
  return (
    <Card
      variant="outlined"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(node.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart?.(node.id) }}
      onDragEnd={() => onDragEnd?.()}
      sx={{ borderRadius: 2, mb: 1, opacity: dragging ? 0.4 : (done ? 0.7 : 1), cursor: 'grab', '&:active': { cursor: 'grabbing' } }}
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
              <Chip size="small" label={p.label} color={p.color} variant="outlined" sx={{ height: 20 }} />
              {node.due_date && <Chip size="small" label={fmtDate(node.due_date)} variant="outlined" sx={{ height: 20 }} />}
              {node.sub_total > 0 && <Chip size="small" label={`${node.sub_done}/${node.sub_total}`} variant="outlined" sx={{ height: 20 }} />}
              {node.assignee_name && <Typography variant="caption" color="text.secondary" noWrap>{node.assignee_name}</Typography>}
            </Stack>
            {(node.client_name || node.contract_description) && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }}>
                🔗 {[node.client_name, node.contract_description].filter(Boolean).join(' · ')}
              </Typography>
            )}
          </Box>
          {canManage && (
            <IconButton size="small" color="error" onClick={() => del.mutate()} sx={{ p: 0.25 }}><DeleteOutlineIcon fontSize="small" /></IconButton>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
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
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
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
          {isMain && (
            <ClientContractPicker clientId={form.client_id} contractId={form.contract_id} clientName={initial?.client_name} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
          )}
          {!isMain && <Typography variant="caption" color="text.secondary">Responsável e cliente/contrato são herdados da tarefa principal.</Typography>}
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
            due_date: form.due_date || null,
            // Subitem herda responsável e cliente/contrato do pai — não são enviados.
            ...(isMain ? { assignee_id: form.assignee_id ? Number(form.assignee_id) : null, client_id: form.client_id, contract_id: form.contract_id } : {}),
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
      {kids.map((k) => <SubtreeItem key={k.id} node={k} childrenMap={childrenMap} users={users} depth={depth + 1} canManage={canManage} onChanged={onChanged} notify={notify} />)}
      {adding && <NodeForm heading="Novo subitem" initial={null} users={users} submitting={add.isPending} onClose={() => setAdding(false)} onSubmit={(payload) => add.mutate(payload)} />}
      {editing && <NodeForm heading="Editar tarefa" initial={node} users={users} submitting={edit.isPending} onClose={() => setEditing(false)} onSubmit={(payload) => edit.mutate(payload)} />}
    </Box>
  )
}

// Detalhe da tarefa: cabeçalho editável + árvore de subitens + histórico.
function TaskDetailDialog({ nodeId, users, stages, canManage, onClose, onChanged, notify }) {
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['task-node', nodeId], queryFn: () => tasksService.node(nodeId) })
  const [editing, setEditing] = React.useState(false)
  const [addingTop, setAddingTop] = React.useState(false)
  const promptedRef = React.useRef(false)
  const node = q.data?.node
  const children = q.data?.children || []
  const activity = q.data?.activity || []
  const refreshAll = () => { q.refetch(); onChanged() }
  const childrenMap = React.useMemo(() => {
    const m = new Map()
    for (const c of children) { const k = c.parent_id; if (!m.has(k)) m.set(k, []); m.get(k).push(c) }
    return m
  }, [children])
  const topKids = childrenMap.get(nodeId) || []
  const allSubDone = topKids.length > 0 && topKids.every((k) => k.status === 'done')
  // Todas as subtarefas concluídas → oferece mover a tarefa para a próxima etapa (com confirmação).
  React.useEffect(() => {
    if (!node || !stages?.length) return
    if (!allSubDone) { promptedRef.current = false; return }
    if (promptedRef.current || node.status === 'done') return
    const idx = stages.findIndex((s) => s.id === node.stage_id)
    const next = idx >= 0 ? stages[idx + 1] : null
    if (!next) return
    promptedRef.current = true
    ;(async () => {
      const ok = await confirm({ title: 'Subtarefas concluídas', description: `Todas as subtarefas de "${node.title}" foram concluídas. Mover a tarefa para "${next.name}"?`, confirmText: 'Mover' })
      if (ok) {
        try { await tasksService.moveNode(node.id, next.id); refreshAll() }
        catch (e) { notify(e?.response?.data?.error || 'Falha ao mover.', 'error') }
      }
    })()
  }, [allSubDone, node?.stage_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const edit = useMutation({ mutationFn: (payload) => tasksService.updateNode(nodeId, payload), onSuccess: () => { setEditing(false); refreshAll() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao salvar.', 'error') })
  const addTop = useMutation({ mutationFn: (payload) => tasksService.createNode({ ...payload, parent_id: nodeId }), onSuccess: () => { setAddingTop(false); refreshAll() }, onError: (e) => notify(e?.response?.data?.error || 'Falha ao adicionar.', 'error') })
  const p = node ? (PRIORITY[node.priority] || PRIORITY.media) : PRIORITY.media
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
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
            {node.description && <Typography variant="body2" color="text.secondary" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>{node.description}</Typography>}

            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Subitens</Typography>
              {canManage && <Button size="small" startIcon={<AddIcon />} onClick={() => setAddingTop(true)}>Adicionar</Button>}
            </Stack>
            {topKids.length === 0
              ? <Typography variant="caption" color="text.secondary">Nenhum subitem. {canManage ? 'Use “Adicionar” para quebrar a tarefa em passos.' : ''}</Typography>
              : topKids.map((k) => <SubtreeItem key={k.id} node={k} childrenMap={childrenMap} users={users} depth={0} canManage={canManage} onChanged={refreshAll} notify={notify} />)}

            {activity.length > 0 && (
              <Box sx={{ mt: 2.5 }}>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
                  <HistoryIcon fontSize="small" color="disabled" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Histórico</Typography>
                </Stack>
                <Stack spacing={0.25}>
                  {activity.slice(0, 8).map((a, i) => (
                    <Typography key={i} variant="caption" color="text.secondary">
                      {a.user_name || 'Sistema'} · {a.action}{a.detail ? ` — ${a.detail}` : ''}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={onClose}>Fechar</Button>
          </DialogActions>
          {editing && <NodeForm heading="Editar tarefa" initial={node} users={users} submitting={edit.isPending} isMain onClose={() => setEditing(false)} onSubmit={(payload) => edit.mutate(payload)} />}
          {addingTop && <NodeForm heading="Novo subitem" initial={null} users={users} submitting={addTop.isPending} onClose={() => setAddingTop(false)} onSubmit={(payload) => addTop.mutate(payload)} />}
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
          <Typography variant="body2" color="text.secondary">Nenhuma rotina recorrente. Crie uma tarefa com repetição mensal/anual.</Typography>
        ) : (
          <Stack divider={<Divider flexItem />} spacing={0}>
            {items.map((t) => {
              const p = PRIORITY[t.priority] || PRIORITY.media
              return (
                <Stack key={t.id} direction="row" alignItems="center" spacing={1} sx={{ py: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }} onClick={() => { onOpen(t.id); onClose() }} noWrap>{t.title}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {recurrenceLabel(t.recurrence, t.recurrence_day, t.recurrence_month)}{t.group_name ? ` · ${t.group_name}` : ' · Avulsas'}{t.assignee_name ? ` · ${t.assignee_name}` : ''} · {t.occurrences} ocorrência(s)
                    </Typography>
                  </Box>
                  <Chip size="small" label={p.label} color={p.color} variant="outlined" sx={{ height: 20 }} />
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

export default function TasksPage() {
  const { selectedCompanyId } = useAuth()
  const { can } = usePermissions()
  const qc = useQueryClient()
  const canView = can('tasks.view')
  const canManage = can('tasks.manage')
  const enabled = Number.isInteger(selectedCompanyId)
  const [toast, setToast] = React.useState(null)
  const [dialog, setDialog] = React.useState(null) // 'group' | 'task'
  const [openNodeId, setOpenNodeId] = React.useState(null)
  const [draggedId, setDraggedId] = React.useState(null)
  const [dragOverKey, setDragOverKey] = React.useState(null)
  const notify = (msg, severity = 'success') => setToast({ msg, severity, key: Date.now() })

  const boardQ = useQuery({ queryKey: ['tasks-board', selectedCompanyId], queryFn: () => tasksService.board(), enabled: enabled && canView })
  const usersQ = useQuery({ queryKey: ['tasks-users', selectedCompanyId], queryFn: () => tasksService.companyUsers(), enabled: enabled && canManage })

  const confirm = useConfirm()
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks-board'] })
  const moveMut = useMutation({
    mutationFn: ({ id, stageId }) => tasksService.moveNode(id, stageId),
    onSuccess: () => refresh(),
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao mover.', 'error'),
  })
  const delGroup = useMutation({
    mutationFn: (id) => tasksService.deleteGroup(id),
    onSuccess: () => { notify('Rotina excluída.'); refresh() },
    onError: (e) => notify(e?.response?.data?.error || 'Falha ao excluir rotina.', 'error'),
  })
  const handleDeleteGroup = async (lane) => {
    const ok = await confirm({ title: 'Excluir rotina', description: `Excluir a rotina "${lane.name}"? Só é possível se não houver tarefas vinculadas.`, confirmText: 'Excluir', tone: 'danger' })
    if (ok) delGroup.mutate(lane.id)
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
  const groups = boardQ.data?.groups || []
  const nodes = boardQ.data?.nodes || []
  // Raias = grupos + "Avulsas" (group_id nulo).
  const swimlanes = [...groups, { id: AVULSAS, name: 'Avulsas', virtual: true }]
  const cellNodes = (laneId, stageId) => nodes.filter((n) =>
    (laneId === AVULSAS ? n.group_id == null : n.group_id === laneId) && n.stage_id === stageId)
  const handleDrop = (stageId) => (e) => {
    e.preventDefault()
    setDragOverKey(null); setDraggedId(null)
    const id = Number(e.dataTransfer.getData('text/plain'))
    const dragged = nodes.find((n) => n.id === id)
    if (id && dragged && dragged.stage_id !== stageId) moveMut.mutate({ id, stageId })
  }

  const actions = (
    <Stack direction="row" spacing={1}>
      <Button variant="text" startIcon={<AutorenewIcon />} onClick={() => setDialog('recurrences')}>Recorrências</Button>
      {canManage && <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setDialog('group')}>Nova rotina</Button>}
      {canManage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog('task')} disabled={!stages.length}>Nova tarefa</Button>}
    </Stack>
  )

  return (
    <Stack spacing={2.5}>
      <PageHeader title="Gerenciador de Tarefas" subtitle="Rotinas (raias) × etapas (colunas) — modelo do fluxograma." actions={actions} />

      {boardQ.isError && <Alert severity="error">Falha ao carregar o quadro.</Alert>}
      {!boardQ.isLoading && !groups.length && !nodes.length && (
        <Alert severity="info">Nenhuma rotina ou tarefa ainda. {canManage ? 'Crie uma rotina ou uma tarefa avulsa para começar.' : ''}</Alert>
      )}

      <PapperBlock title="Quadro" subtitle="Raias = rotinas · Colunas = etapas" icon={<ViewKanbanIcon />} noPadding>
        <Box sx={{ overflowX: 'auto', p: 1 }}>
          <Box sx={{ minWidth: 160 + stages.length * 150 }}>
            {/* Cabeçalho das etapas */}
            <Box sx={{ display: 'flex', borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ flex: '0 0 160px', p: 1, fontWeight: 700 }}>Rotina</Box>
              {stages.map((s) => (
                <Box key={s.id} sx={{ flex: '1 1 0', minWidth: 150, p: 1, fontWeight: 700, borderLeft: 1, borderColor: 'divider', color: s.is_done ? 'success.main' : 'text.primary' }}>{s.name}</Box>
              ))}
            </Box>
            {/* Raias */}
            {swimlanes.map((lane) => (
              <Box key={lane.id} sx={{ display: 'flex', borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={{ flex: '0 0 160px', p: 1 }}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={0.5}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{lane.name}</Typography>
                    {canManage && !lane.virtual && (
                      <Tooltip title="Excluir rotina">
                        <IconButton size="small" color="error" onClick={() => handleDeleteGroup(lane)} sx={{ p: 0.25, mt: -0.25 }}><DeleteOutlineIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                  {!lane.virtual && lane.description && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{lane.description}</Typography>}
                </Box>
                {stages.map((s) => {
                  const key = `${lane.id}:${s.id}`
                  const isOver = dragOverKey === key
                  return (
                    <Box
                      key={s.id}
                      onDragOver={(e) => { e.preventDefault(); if (dragOverKey !== key) setDragOverKey(key) }}
                      onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
                      onDrop={handleDrop(s.id)}
                      sx={{
                        flex: '1 1 0', minWidth: 150, p: 1, borderLeft: 1, borderColor: 'divider', minHeight: 90,
                        bgcolor: isOver ? 'action.selected' : 'action.hover', transition: 'background-color .12s',
                        outline: isOver ? '2px dashed' : 'none', outlineColor: 'primary.main', outlineOffset: '-4px',
                      }}
                    >
                      {cellNodes(lane.id, s.id).map((n) => (
                        <TaskCard
                          key={n.id} node={n} canManage={canManage} onOpen={setOpenNodeId} onChanged={refresh} notify={notify}
                          onDragStart={setDraggedId} onDragEnd={() => setDraggedId(null)} dragging={draggedId === n.id}
                        />
                      ))}
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        </Box>
      </PapperBlock>

      {dialog === 'group' && <GroupDialog onClose={() => setDialog(null)} onSaved={refresh} notify={notify} />}
      {dialog === 'task' && <TaskDialog groups={groups} stages={stages} users={usersQ.data?.items || []} onClose={() => setDialog(null)} onSaved={refresh} notify={notify} />}
      {dialog === 'recurrences' && <RecurrencesDialog canManage={canManage} onOpen={setOpenNodeId} onClose={() => setDialog(null)} notify={notify} onChanged={refresh} />}
      {openNodeId && <TaskDetailDialog nodeId={openNodeId} users={usersQ.data?.items || []} stages={stages} canManage={canManage} onClose={() => setOpenNodeId(null)} onChanged={refresh} notify={notify} />}

      {toast && (
        <Paper elevation={6} sx={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1400 }}>
          <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert>
        </Paper>
      )}
    </Stack>
  )
}
