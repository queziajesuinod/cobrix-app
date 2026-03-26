import React, { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Stack, TextField, FormControlLabel, Checkbox,
  Typography, Box, Divider, Alert, Chip,
} from '@mui/material'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'

// Formata 'YYYY-MM-DD' para 'DD/MM/YYYY' para exibição
function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function BillingsRunDialog({ open, onClose, onConfirm }) {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'))
  const [flags, setFlags] = useState({
    generate: true,
    includeWeekly: true,
    includeCustom: true,
    pre: true,
    due: true,
    late: true,
  })
  const toggle = (k) => setFlags((s) => ({ ...s, [k]: !s[k] }))

  const notifCount = [flags.pre, flags.due, flags.late].filter(Boolean).length
  const submit = () => onConfirm({ date, ...flags })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" fontWeight={700}>Executar rotina de cobranças</Typography>
        <Typography variant="body2" color="text.secondary" mt={0.5}>
          Escolha o que deseja executar para a data selecionada
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={3}>

          {/* Data de referência */}
          <Box>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <CalendarTodayIcon fontSize="small" color="action" />
              <Typography variant="subtitle2" fontWeight={600} color="text.secondary">
                DATA DE REFERÊNCIA
              </Typography>
            </Box>
            <TextField
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              fullWidth
              helperText="A rotina será executada como se fosse esse dia"
            />
          </Box>

          <Divider />

          {/* Etapa 1 — Geração de cobranças */}
          <Box>
            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
              <ReceiptLongIcon fontSize="small" color="primary" />
              <Typography variant="subtitle2" fontWeight={600} color="primary">
                ETAPA 1 — GERAR COBRANÇAS
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
              Cria as cobranças (boletas) para contratos com vencimento na data escolhida
            </Typography>

            <FormControlLabel
              control={<Checkbox checked={flags.generate} onChange={() => toggle('generate')} color="primary" />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>Gerar cobranças do dia</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Cria cobranças pendentes para contratos mensais
                  </Typography>
                </Box>
              }
            />

            {/* Sub-opções indentadas — dependem de "generate" */}
            <Box pl={4} mt={0.5} sx={{ opacity: flags.generate ? 1 : 0.4, pointerEvents: flags.generate ? 'auto' : 'none' }}>
              <FormControlLabel
                control={<Checkbox checked={flags.includeWeekly} onChange={() => toggle('includeWeekly')} size="small" />}
                label={
                  <Box>
                    <Typography variant="body2">Incluir contratos por intervalo de dias</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Ex: cobranças semanais, quinzenais
                    </Typography>
                  </Box>
                }
              />
              <FormControlLabel
                control={<Checkbox checked={flags.includeCustom} onChange={() => toggle('includeCustom')} size="small" />}
                label={
                  <Box>
                    <Typography variant="body2">Incluir datas personalizadas</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Contratos com calendário de datas específicas
                    </Typography>
                  </Box>
                }
              />
            </Box>
          </Box>

          <Divider />

          {/* Etapa 2 — Notificações */}
          <Box>
            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
              <WhatsAppIcon fontSize="small" sx={{ color: '#25D366' }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ color: '#25D366' }}>
                ETAPA 2 — NOTIFICAÇÕES WHATSAPP
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
              Envia mensagens automáticas para os clientes via WhatsApp
            </Typography>

            <Stack spacing={1}>
              <FormControlLabel
                control={<Checkbox checked={flags.pre} onChange={() => toggle('pre')} />}
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={500}>
                      Lembrete antecipado
                      <Chip label="4 dias antes" size="small" variant="outlined" sx={{ ml: 1, height: 18, fontSize: 10 }} />
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Avisa o cliente que o vencimento está chegando
                    </Typography>
                  </Box>
                }
              />

              <FormControlLabel
                control={<Checkbox checked={flags.due} onChange={() => toggle('due')} />}
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={500}>
                      Cobrança no vencimento
                      <Chip label="hoje" size="small" color="warning" variant="outlined" sx={{ ml: 1, height: 18, fontSize: 10 }} />
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Envia o link de pagamento PIX no dia do vencimento
                    </Typography>
                  </Box>
                }
              />

              <FormControlLabel
                control={<Checkbox checked={flags.late} onChange={() => toggle('late')} />}
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={500}>
                      Aviso de atraso
                      <Chip label="3 dias em atraso" size="small" color="error" variant="outlined" sx={{ ml: 1, height: 18, fontSize: 10 }} />
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Lembra clientes com cobranças vencidas há 3 dias
                    </Typography>
                  </Box>
                }
              />
            </Stack>
          </Box>

          {/* Resumo do que vai executar */}
          {(flags.generate || notifCount > 0) && (
            <Alert
              severity="info"
              icon={<PlayArrowIcon />}
              sx={{ '& .MuiAlert-message': { width: '100%' } }}
            >
              <Typography variant="body2" fontWeight={600} gutterBottom>
                O que será executado para {fmtDate(date)}:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {flags.generate && (
                  <li>
                    <Typography variant="body2">
                      Geração de cobranças
                      {flags.includeWeekly || flags.includeCustom
                        ? ` (+ ${[flags.includeWeekly && 'semanais', flags.includeCustom && 'personalizadas'].filter(Boolean).join(', ')})`
                        : ''}
                    </Typography>
                  </li>
                )}
                {flags.pre  && <li><Typography variant="body2">Notificação de lembrete antecipado (4 dias antes)</Typography></li>}
                {flags.due  && <li><Typography variant="body2">Notificação de vencimento (hoje)</Typography></li>}
                {flags.late && <li><Typography variant="body2">Notificação de atraso (3 dias)</Typography></li>}
              </Box>
            </Alert>
          )}

          {!flags.generate && notifCount === 0 && (
            <Alert severity="warning">
              Nenhuma etapa selecionada. Marque pelo menos uma opção para executar.
            </Alert>
          )}

        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Cancelar</Button>
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          onClick={submit}
          disabled={!flags.generate && notifCount === 0}
        >
          Executar rotina
        </Button>
      </DialogActions>
    </Dialog>
  )
}
