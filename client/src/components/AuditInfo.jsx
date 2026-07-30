import React from 'react'
import { Box, Typography } from '@mui/material'

function fmt(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR')
}

// Exibe "Criado por X · DD/MM/AAAA" e, se houver, "Editado por Y · DD/MM/AAAA".
export default function AuditInfo({ createdByName, createdAt, updatedByName, updatedAt }) {
  const hasCreated = createdByName || createdAt
  const hasUpdated = updatedByName && updatedAt
  if (!hasCreated && !hasUpdated) {
    return <Typography variant="caption" color="text.disabled">—</Typography>
  }
  return (
    <Box sx={{ minWidth: 0, lineHeight: 1.35 }}>
      {hasCreated && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Criado{createdByName ? ` por ${createdByName}` : ''}{createdAt ? ` · ${fmt(createdAt)}` : ''}
        </Typography>
      )}
      {hasUpdated && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Editado por {updatedByName} · {fmt(updatedAt)}
        </Typography>
      )}
    </Box>
  )
}
