import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import { messageTemplatesService } from './messageTemplates.service'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import RestoreIcon from '@mui/icons-material/Restore'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import EditNoteIcon from '@mui/icons-material/EditNote'
import AddCommentIcon from '@mui/icons-material/AddComment'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import EmailIcon from '@mui/icons-material/Email'

const TEMPLATE_TYPES = [
  { key: 'pre', title: 'Pré-vencimento (só chave Pix)', description: 'Manda só a chave Pix no texto. Usado quando não há Pix copia e cola.' },
  { key: 'pre_gateway', title: 'Pré-vencimento (Pix copia e cola)', description: 'Manda o Pix copia e cola (Efí ou chave Pix estática) — em balão separado com {{quebra}}.' },
  { key: 'due', title: 'Dia do vencimento (só chave Pix)', description: 'Manda só a chave Pix no dia do vencimento.' },
  { key: 'due_gateway', title: 'Dia do vencimento (Pix copia e cola)', description: 'Manda o Pix copia e cola no dia do vencimento — em balão separado.' },
  { key: 'late', title: 'Em atraso (só chave Pix)', description: 'Cobrança em atraso com a chave Pix crua.' },
  { key: 'late_gateway', title: 'Em atraso (Pix copia e cola)', description: 'Cobrança em atraso com o Pix copia e cola — em balão separado.' },
  { key: 'due_weekly', title: 'Semanal - dia do vencimento (só chave Pix)', description: 'Cobrança semanal no vencimento, só com a chave Pix.' },
  { key: 'due_weekly_gateway', title: 'Semanal - dia do vencimento (Pix copia e cola)', description: 'Cobrança semanal no vencimento, com o Pix copia e cola em balão separado.' },
  { key: 'late_weekly', title: 'Semanal - em atraso (só chave Pix)', description: 'Cobrança semanal em atraso, só com a chave Pix.' },
  { key: 'late_weekly_gateway', title: 'Semanal - em atraso (Pix copia e cola)', description: 'Cobrança semanal em atraso, com o Pix copia e cola em balão separado.' },
  { key: 'due_custom', title: 'Data personalizada - dia do vencimento (só chave Pix)', description: 'Cobrança em data personalizada, só com a chave Pix.' },
  { key: 'due_custom_gateway', title: 'Data personalizada - dia do vencimento (Pix copia e cola)', description: 'Cobrança em data personalizada, com o Pix copia e cola em balão separado.' },
  { key: 'late_custom', title: 'Data personalizada - em atraso (só chave Pix)', description: 'Cobrança personalizada em atraso, só com a chave Pix.' },
  { key: 'late_custom_gateway', title: 'Data personalizada - em atraso (Pix copia e cola)', description: 'Cobrança personalizada em atraso, com o Pix copia e cola em balão separado.' },
  { key: 'paid', title: 'Pagamento confirmado', description: 'Mensagem enviada quando o pagamento é confirmado.' },
];

// Modelos de E-mail — corpo (texto) da mensagem. Valor, vencimento, PIX e QR Code
// são adicionados automaticamente pelo layout HTML do e-mail.
const EMAIL_TEMPLATE_TYPES = [
  { key: 'pre_email', title: 'E-mail · Pré-vencimento', description: 'Corpo do e-mail enviado antes do vencimento.' },
  { key: 'due_email', title: 'E-mail · Dia do vencimento', description: 'Corpo do e-mail enviado no dia do vencimento.' },
  { key: 'late_email', title: 'E-mail · Em atraso', description: 'Corpo do e-mail enviado quando a cobrança está em atraso.' },
  { key: 'paid_email', title: 'E-mail · Pagamento confirmado', description: 'Corpo do e-mail enviado quando o pagamento é confirmado.' },
];

const ALL_TYPES = [...TEMPLATE_TYPES, ...EMAIL_TEMPLATE_TYPES];
const TEMPLATE_KEYS = ALL_TYPES.map((item) => item.key);
const INITIAL_VALUES = TEMPLATE_KEYS.reduce((acc, key) => ({ ...acc, [key]: '' }), {});
const tokenFromKey = (key) => `{{${key}}}`
const isGatewayKey = (key) => key.endsWith('_gateway')
const alwaysVisibleKeys = new Set(['paid'])

export default function MessageTemplatesPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['message-templates'],
    queryFn: messageTemplatesService.list,
  })

  const [values, setValues] = useState({ ...INITIAL_VALUES })
  const [activeType, setActiveType] = useState(TEMPLATE_TYPES[0]?.key || 'pre')
  const [channel, setChannel] = useState('whatsapp')
  const [snack, setSnack] = useState(null)

  const visibleTypes = useMemo(() => {
    if (channel === 'email') return EMAIL_TEMPLATE_TYPES
    if (!data) return TEMPLATE_TYPES
    // Mostra os modelos com Pix copia e cola (em balões) quando a empresa
    // consegue gerar Pix — por Efí OU chave Pix estática. É o que reflete o que
    // realmente é enviado. Fallback p/ gatewayReady se o backend for antigo.
    const pixReady = data.pixReady ?? data.gatewayReady
    if (pixReady) {
      return TEMPLATE_TYPES.filter(({ key }) => isGatewayKey(key) || alwaysVisibleKeys.has(key))
    }
    return TEMPLATE_TYPES.filter(({ key }) => !isGatewayKey(key))
  }, [data, channel])

  useEffect(() => {
    if (!visibleTypes.length) return
    if (!visibleTypes.some(({ key }) => key === activeType)) {
      setActiveType(visibleTypes[0].key)
    }
  }, [activeType, visibleTypes])

  const fieldRefs = useMemo(() => {
    return TEMPLATE_KEYS.reduce((acc, key) => {
      acc[key] = React.createRef()
      return acc
    }, {})
  }, [])

  useEffect(() => {
    if (data?.templates) {
      setValues((prev) => {
        const next = { ...prev }
        TEMPLATE_KEYS.forEach((key) => {
          next[key] = data.templates[key] ?? ''
        })
        return next
      })
    } else {
      setValues({ ...INITIAL_VALUES })
    }
  }, [data])

  const placeholderExamples = useMemo(() => {
    const map = {}
    for (const item of data?.placeholders || []) {
      map[item.key] = item.example || item.token || tokenFromKey(item.key)
    }
    return map
  }, [data])

  const renderPreview = (text) => {
    if (!text) return ''
    return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
      if (key === 'quebra') return match
      if (Object.prototype.hasOwnProperty.call(placeholderExamples, key)) {
        return placeholderExamples[key]
      }
      return match
    })
  }

  // Divide o modelo no marcador {{quebra}} em balões separados, como o WhatsApp
  // enviará. Cada trecho vira uma mensagem própria (útil p/ o Pix copia e cola).
  const renderPreviewSegments = (text) => {
    if (!text) return []
    return String(text)
      .split(/\{\{\s*quebra\s*\}\}/gi)
      .map((part) => renderPreview(part).trim())
      .filter((part) => part.length > 0)
  }

  const mutation = useMutation({
    mutationFn: messageTemplatesService.save,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['message-templates'] })
      setSnack({ type: 'success', message: 'Modelos salvos com sucesso.' })
    },
    onError: (error) => {
      const msg = error?.response?.data?.error || 'Falha ao salvar modelos.'
      setSnack({ type: 'error', message: msg })
    },
  })

  const handleInsertToken = (type, token) => {
    const ref = fieldRefs[type]?.current
    if (!ref) return
    ref.focus()
    const start = ref.selectionStart ?? values[type]?.length ?? 0
    const end = ref.selectionEnd ?? start

    setValues((prev) => {
      const current = prev[type] ?? ''
      const before = current.slice(0, start)
      const after = current.slice(end)
      const next = `${before}${token}${after}`

      requestAnimationFrame(() => {
        ref.focus()
        const cursor = start + token.length
        ref.setSelectionRange(cursor, cursor)
      })

      return { ...prev, [type]: next }
    })
  }

  // Insere uma quebra de balão ({{quebra}}) no ponto do cursor. Cada quebra faz
  // o WhatsApp enviar dali em diante como uma NOVA mensagem. Não depende do token
  // estar na lista de campos — é o jeito direto de separar o Pix em outro balão.
  const handleInsertBreak = (type) => {
    handleInsertToken(type, '\n\n{{quebra}}\n\n')
  }

  const handleDrop = (type, event) => {
    event.preventDefault()
    event.stopPropagation()
    const token = event.dataTransfer.getData('text/plain')
    if (!token) return
    handleInsertToken(type, token)
  }

  const handleDragStart = (event, token) => {
    event.dataTransfer.setData('text/plain', token)
    event.dataTransfer.effectAllowed = 'copyMove'
  }

  const handleSave = async () => {
    await mutation.mutateAsync(values)
  }

  const handleReset = (type) => {
    const fallback = data?.defaults?.[type] ?? ''
    setValues((prev) => ({ ...prev, [type]: fallback }))
  }

  const isDirty = useMemo(() => {
    if (!data?.templates) return false
    return ALL_TYPES.some(({ key }) => (values[key] ?? '') !== (data.templates[key] ?? ''))
  }, [data, values])

  if (isLoading) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Mensagens automáticas" subtitle="Personalize o conteúdo das notificações automáticas." />
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
          <CircularProgress />
        </Box>
      </Stack>
    )
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Mensagens automáticas"
        subtitle="Monte os textos das notificações arrastando os campos disponí­veis. Use os tokens para preencher dados automaticamente."
      />

      <ToggleButtonGroup
        exclusive size="small" color="primary"
        value={channel}
        onChange={(_, v) => v && setChannel(v)}
      >
        <ToggleButton value="whatsapp" sx={{ px: 3, fontWeight: 700 }}>
          <WhatsAppIcon fontSize="small" sx={{ mr: 1 }} /> WhatsApp
        </ToggleButton>
        <ToggleButton value="email" sx={{ px: 3, fontWeight: 700 }}>
          <EmailIcon fontSize="small" sx={{ mr: 1 }} /> E-mail
        </ToggleButton>
      </ToggleButtonGroup>

      {channel === 'email' && (
        <Alert severity="info">
          Aqui você edita apenas o <strong>texto</strong> do e-mail. O layout, o valor, o vencimento, o
          <strong> PIX copia-e-cola</strong> e o <strong>QR Code</strong> são adicionados automaticamente ao redor da sua mensagem.
        </Alert>
      )}

      {data?.audit?.updated_at && (
        <Typography variant="caption" color="text.secondary">
          Última edição{data.audit.updated_by_name ? ` por ${data.audit.updated_by_name}` : ''} · {new Date(data.audit.updated_at).toLocaleString('pt-BR')}
        </Typography>
      )}

      <PapperBlock
        title="Campos disponí­veis"
        subtitle="Arraste um campo para dentro do texto ou clique para inserir onde estiver o cursor."
        icon={<DragIndicatorIcon/>}
        iconColor="secondary.main"
      >
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {(data?.placeholders || []).map((item) => {
            const token = item.token || tokenFromKey(item.key)
            return (
              <Chip
                key={item.key}
                label={`${item.label} (${token})`}
                draggable
                onDragStart={(event) => handleDragStart(event, token)}
                onClick={() => handleInsertToken(activeType, token)}
                sx={{ cursor: 'grab' }}
              />
            )
          })}
        </Stack>
      </PapperBlock>

      <Grid container spacing={2}>
        {visibleTypes.map(({ key, title, description }) => {
          const defaultValue = data?.defaults?.[key] ?? ''
          const currentValue = values[key] ?? ''
          const isCustom = currentValue.trim() !== defaultValue.trim()
          return (
            <Grid key={key} item xs={12} md={4}>
              <PapperBlock
                title={title}
                subtitle={description}
                icon={<EditNoteIcon/>}
                iconColor="primary.main"
                action={(
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<AddCommentIcon />}
                      onClick={() => handleInsertBreak(key)}
                    >
                      Novo balão
                    </Button>
                    <Button size="small" startIcon={<RestoreIcon />} onClick={() => handleReset(key)}>
                      Padrão
                    </Button>
                  </Stack>
                )}
              >
                <Stack sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
                  {isCustom && (
                    <Chip label="Customizado" color="primary" size="small" sx={{ alignSelf: 'flex-start' }} />
                  )}

                  <TextField
                    multiline
                    minRows={12}
                    value={currentValue}
                    inputRef={fieldRefs[key]}
                    onFocus={() => setActiveType(key)}
                    onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))}
                    inputProps={{
                      onDrop: (event) => handleDrop(key, event),
                      onDragOver: (event) => event.preventDefault(),
                    }}
                    fullWidth
                  />

                  <Typography variant="caption" color="text.secondary">
                    Onde aparecer <b>{'{{quebra}}'}</b> o WhatsApp começa uma nova mensagem (balão).
                    Posicione o cursor e clique em <b>Novo balão</b> — ex.: deixe o Pix copia e cola
                    ({'{{payment_code}}'}) sozinho no último balão, fácil de copiar.
                  </Typography>

                  <Box>
                    {(() => {
                      const segments = renderPreviewSegments(currentValue)
                      return (
                        <>
                          <Typography variant="caption" color="text.secondary">
                            Pré-visualização (como o cliente vê no WhatsApp)
                            {segments.length > 1 ? ` · ${segments.length} balões` : ''}
                          </Typography>
                          <Stack
                            sx={(theme) => ({
                              mt: 1,
                              p: 1.5,
                              gap: 1,
                              minHeight: 150,
                              borderRadius: 1.5,
                              alignItems: 'flex-end',
                              justifyContent: segments.length === 0 ? 'center' : 'flex-start',
                              bgcolor: theme.palette.mode === 'dark' ? '#0b141a' : '#efeae2',
                              border: `1px solid ${theme.palette.divider}`,
                            })}
                          >
                            {segments.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">
                                Sem conteúdo.
                              </Typography>
                            ) : (
                              segments.map((segment, index) => (
                                <Box
                                  key={index}
                                  sx={(theme) => ({
                                    maxWidth: '88%',
                                    px: 1.25,
                                    py: 0.75,
                                    borderRadius: 2,
                                    borderTopRightRadius: 0.5,
                                    fontSize: 13,
                                    lineHeight: 1.45,
                                    whiteSpace: 'pre-line',
                                    wordBreak: 'break-word',
                                    boxShadow: theme.shadows[1],
                                    bgcolor: theme.palette.mode === 'dark' ? '#005c4b' : '#d9fdd3',
                                    color: theme.palette.mode === 'dark' ? '#e9edef' : '#111b21',
                                  })}
                                >
                                  {segment}
                                </Box>
                              ))
                            )}
                          </Stack>
                        </>
                      )
                    })()}
                  </Box>
                </Stack>
              </PapperBlock>
            </Grid>
          )
        })}
      </Grid>

      <Stack direction="row" spacing={2} justifyContent="flex-end">
        <Button
          variant="contained"
          startIcon={<SaveOutlinedIcon />}
          onClick={handleSave}
          disabled={!isDirty || mutation.isPending}
        >
          Salvar modelos
        </Button>
      </Stack>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {snack ? <Alert severity={snack.type}>{snack.message}</Alert> : null}
      </Snackbar>
    </Stack>
  )
}





