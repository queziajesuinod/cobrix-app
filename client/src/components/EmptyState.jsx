import React from 'react'
import { Box, Typography } from '@mui/material'

/** Estado vazio reutilizável: ícone + título + descrição + ação opcional. */
export default function EmptyState({ icon, title = 'Nada por aqui', description, action }) {
  return (
    <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
      {icon && (
        <Box sx={{ color: 'text.disabled', mb: 1.5, '& svg': { fontSize: 52 } }}>{icon}</Box>
      )}
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 420, mx: 'auto' }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2.5 }}>{action}</Box>}
    </Box>
  )
}
