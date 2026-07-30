import React from 'react'
import {
  Dialog, DialogContent, DialogActions, Button, Box, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'

const ConfirmContext = React.createContext(null)

// Provider de confirmação: expõe um confirm() que retorna uma Promise<boolean>
// e renderiza um único diálogo MUI estilizado (substitui o window.confirm nativo).
export function ConfirmProvider({ children }) {
  const [state, setState] = React.useState(null) // { opts, resolve }

  const confirm = React.useCallback((options) => {
    const opts = typeof options === 'string' ? { description: options } : (options || {})
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

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(state)}
        onClose={() => handleClose(false)}
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
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, pt: 0, gap: 1.25 }}>
          <Button
            fullWidth
            variant="outlined"
            color="inherit"
            onClick={() => handleClose(false)}
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
            onClick={() => handleClose(true)}
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
