import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/PageHeader'
import { messageTemplatesService } from './messageTemplates.service'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Grid,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import RestoreIcon from '@mui/icons-material/Restore'

const TEMPLATE_TYPES = [
  { key: 'pre', title: 'Pré-vencimento (sem gateway)', description: 'Aviso enviado três dias antes para empresas sem link Pix.' },
  { key: 'pre_gateway', title: 'Pré-vencimento (com gateway)', description: 'Versão enviada quando existe link de pagamento automático.' },
  { key: 'due', title: 'Dia do vencimento (sem gateway)', description: 'Mensagem enviada no dia do vencimento sem link Pix.' },
  { key: 'due_gateway', title: 'Dia do vencimento (com gateway)', description: 'Mensagem com link Pix enviada no D0.' },
  { key: 'late', title: 'Em atraso (sem gateway)', description: 'Cobrança enviada quatro dias após o vencimento.' },
  { key: 'late_gateway', title: 'Em atraso (com gateway)', description: 'Cobrança com link Pix para empresas integradas ao gateway.' },
];

const TEMPLATE_KEYS = TEMPLATE_TYPES.map((item) => item.key);
const INITIAL_VALUES = TEMPLATE_KEYS.reduce((acc, key) => ({ ...acc, [key]: '' }), {});
const tokenFromKey = (key) => `{{${key}}}`

export default function MessageTemplatesPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['message-templates'],
    queryFn: messageTemplatesService.list,
  })

  const [values, setValues] = useState({ ...INITIAL_VALUES })
  const [activeType, setActiveType] = useState('pre')
  const [snack, setSnack] = useState(null)

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
      if (Object.prototype.hasOwnProperty.call(placeholderExamples, key)) {
        return placeholderExamples[key]
      }
      return match
    })
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
    return TEMPLATE_TYPES.some(({ key }) => (values[key] ?? '') !== (data.templates[key] ?? ''))
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

      <Card variant="outlined">
        <CardHeader title="Campos disponí­veis" subheader="Arraste um campo para dentro do texto ou clique para inserir onde estiver o cursor." />
        <CardContent>
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
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        {TEMPLATE_TYPES.map(({ key, title, description }) => {
          const defaultValue = data?.defaults?.[key] ?? ''
          const currentValue = values[key] ?? ''
          const isCustom = currentValue.trim() !== defaultValue.trim()
          return (
            <Grid key={key} item xs={12} md={4}>
              <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardHeader
                  title={title}
                  subheader={description}
                  action={(
                    <Button size="small" startIcon={<RestoreIcon />} onClick={() => handleReset(key)}>
                      Padrão
                    </Button>
                  )}
                />
                <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
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

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Pré-visualização com dados de exemplo
                    </Typography>
                    <Box
                      sx={{
                        mt: 1,
                        p: 1.5,
                        bgcolor: 'grey.100',
                        borderRadius: 1,
                        fontFamily: 'monospace',
                        fontSize: 13,
                        whiteSpace: 'pre-line',
                        minHeight: 150,
                      }}
                    >
                      {renderPreview(currentValue) || 'Sem conteúdo.'}
                    </Box>
                  </Box>
                </CardContent>
              </Card>
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





