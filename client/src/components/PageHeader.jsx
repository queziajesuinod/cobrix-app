import React from 'react'
import { Stack, Typography, Box } from '@mui/material'
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <div>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{title}</Typography>
          {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
        </div>
        <Stack direction="row" spacing={1} alignItems="center">{actions}</Stack>
      </Stack>
    </Box>
  )
}
