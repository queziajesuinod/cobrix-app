import React from 'react'
import {
  Dialog, DialogContent, DialogActions, Button, Box, Typography, TextField,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'

const ConfirmContext = React.createContext(null)

// Data de hoje no formato YYYY-MM-DD (local, sem shift de fuso).
function todayIso() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Provider de confirmação: expõe um confirm() que retorna uma Promise<boolean>
// (substitui o window.confirm nativo). Com a opção { dateField: true } o diálogo
// mostra um campo de data (padrão: hoje) e resolve com a data escolhida (string
// YYYY-MM-DD) no confirmar, ou null no cancelar — para "marcar como pago" na data certa.
export function ConfirmProvider({ children }) {
  const [state, setState] = React.useState(null) // { opts, resolve }
  const [dateValue, setDateValue] = React.useState(todayIso())

  const confirm = React.useCallback((options) => {
    const opts = typeof options === 'string' ? { description: options } : (options || {})
    setDateValue(opts.dateDefault || todayIso())
    return new Promise((resolve) => setState({ opts, resolve }))
  }, [])

  const handleClose = (result) => {
    setState((current) => {
      current?.resolve(result)
      return null
    })
  }

  const opts = state?.opts || {}
  const danger = opts.tone === 'danger'
  const color = danger ? 'error' : (opts.color || 'primary')
  const Icon = danger ? WarningAmberRoundedIcon : HelpOutlineRoundedIcon
  const hasDate = Boolean(opts.dateField)
  // Confirmar → boolean puro, ou a data escolhida quando dateField. Cancelar → false/null.
  const onConfirm = () => handleClose(hasDate ? (dateValue || null) : true)
  const onCancel = () => handleClose(hasDate ? null : false)

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(state)}
        onClose={onCancel}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3, p: { xs: 0.5, sm: 1 } } } }}
      >
        <DialogContent sx={{ textAlign: 'center', pt: 4, pb: 2, px: 3 }}>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              mx: 'auto',
              mb: 2,
              display: 'grid',
              placeItems: 'center',
              bgcolor: (t) => alpha(t.palette[color].main, t.palette.mode === 'dark' ? 0.22 : 0.12),
              color: `${color}.main`,
            }}
          >
            <Icon sx={{ fontSize: 34 }} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: opts.description ? 0.75 : 0 }}>
            {opts.title || 'Confirmar ação'}
          </Typography>
          {opts.description && (
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              {opts.description}
            </Typography>
          )}
          {hasDate && (
            <TextField
              type="date"
              label={opts.dateLabel || 'Data do pagamento'}
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
              inputProps={{ max: todayIso() }}
              InputLabelProps={{ shrink: true }}
              fullWidth
              size="small"
              sx={{ mt: 2.5 }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, pt: 0, gap: 1.25 }}>
          <Button
            fullWidth
            variant="outlined"
            color="inherit"
            onClick={onCancel}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
          >
            {opts.cancelText || 'Cancelar'}
          </Button>
          <Button
            fullWidth
            variant="contained"
            color={color}
            disableElevation
            autoFocus
            disabled={hasDate && !dateValue}
            onClick={onConfirm}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
          >
            {opts.confirmText || 'Confirmar'}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm deve ser usado dentro de <ConfirmProvider>')
  return ctx
}
