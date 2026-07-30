import React from 'react'
import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'

const CFG = {
  alto: { color: 'error', label: 'Alto' },
  medio: { color: 'warning', label: 'Médio' },
  baixo: { color: 'success', label: 'Baixo' },
  sem_historico: { color: 'grey', label: 'Sem histórico' },
}

// Anel de score (gauge com conic-gradient) — o preenchimento é proporcional ao
// score e a cor segue a faixa. Theme-aware (o miolo usa background.paper).
export default function RiskBadge({ score, band, size = 56, showLabel = true }) {
  const cfg = CFG[band] || CFG.sem_historico
  const isGrey = cfg.color === 'grey'
  const main = (t) => (isGrey ? t.palette.text.disabled : t.palette[cfg.color].main)
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  const deg = (pct / 100) * 360
  const inner = size - 10

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          flex: '0 0 auto',
          display: 'grid',
          placeItems: 'center',
          background: (t) => `conic-gradient(${main(t)} ${deg}deg, ${alpha(main(t), 0.16)} ${deg}deg 360deg)`,
        }}
      >
        <Box
          sx={{
            width: inner,
            height: inner,
            borderRadius: '50%',
            bgcolor: 'background.paper',
            display: 'grid',
            placeItems: 'center',
            boxShadow: (t) => `inset 0 0 0 1px ${alpha(main(t), 0.15)}`,
          }}
        >
          <Typography sx={{ fontWeight: 800, fontSize: size * 0.3, lineHeight: 1, color: main }}>
            {score == null ? '—' : score}
          </Typography>
        </Box>
      </Box>
      {showLabel && (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1 }}>
            Risco
          </Typography>
          <Typography sx={{ fontWeight: 700, color: main, lineHeight: 1.3 }}>{cfg.label}</Typography>
        </Box>
      )}
    </Box>
  )
}
