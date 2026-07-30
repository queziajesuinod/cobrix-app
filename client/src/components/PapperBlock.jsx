import React from 'react'
import { Card, Box, Typography, Divider } from '@mui/material'

/**
 * PapperBlock — painel de conteúdo no padrão Dandelion: cabeçalho com ícone
 * colorido + título/subtítulo, divisória e o conteúdo abaixo.
 *
 * props:
 *  - title, subtitle: textos do cabeçalho
 *  - icon: elemento de ícone (opcional)
 *  - iconColor: cor de fundo do quadrado do ícone (token do tema ou hex/gradiente)
 *  - action: elemento à direita do cabeçalho (botões, etc.)
 *  - noPadding: remove o padding do corpo (útil para tabelas)
 */
export default function PapperBlock({
  title,
  subtitle,
  icon,
  iconColor = 'primary.main',
  action,
  noPadding = false,
  children,
}) {
  // iconColor pode ser um token do tema ('info.main') OU um gradiente/hex CSS.
  // Tokens resolvem via `bgcolor`; gradientes precisam de `background`.
  const isGradient = typeof iconColor === 'string' && iconColor.includes('gradient')
  const iconBg = isGradient ? { background: iconColor } : { bgcolor: iconColor }

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 3, pt: 2.5, pb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        {icon && (
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              ...iconBg,
            }}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" noWrap>
              {subtitle}
            </Typography>
          )}
        </Box>
        {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
      </Box>
      <Divider />
      <Box sx={{ p: noPadding ? 0 : 3, flex: 1 }}>{children}</Box>
    </Card>
  )
}
