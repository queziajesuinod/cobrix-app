import React from 'react'
import { Box, Stack, TextField, InputAdornment, IconButton, Typography, Chip } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'

/**
 * Barra de ferramentas de tabela: busca (com ícone e limpar), controles de filtro,
 * contador de resultados e chips de filtros ativos (removíveis).
 *
 * props:
 *  - search, onSearchChange, searchPlaceholder
 *  - filters: node com selects/controles extras de filtro
 *  - activeChips: [{ label, onDelete }] filtros aplicados
 *  - onClear: limpar todos os filtros (mostra chip "Limpar tudo")
 *  - count, countLabel: contador de resultados
 */
export default function TableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Buscar…',
  filters,
  activeChips = [],
  onClear,
  count,
  countLabel = 'resultados',
}) {
  return (
    <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        {onSearchChange && (
          <TextField
            size="small"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            sx={{ minWidth: { xs: '100%', md: 300 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
              endAdornment: search ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => onSearchChange('')} aria-label="limpar busca" edge="end">
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
        )}
        {filters}
        <Box sx={{ flexGrow: 1 }} />
        {typeof count === 'number' && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            <Box component="b" sx={{ color: 'text.primary' }}>{count}</Box> {countLabel}
          </Typography>
        )}
      </Stack>

      {activeChips.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }} alignItems="center">
          <Typography variant="caption" color="text.secondary">Filtros ativos:</Typography>
          {activeChips.map((chip, i) => (
            <Chip key={i} size="small" color="primary" variant="outlined" label={chip.label} onDelete={chip.onDelete} />
          ))}
          {onClear && (
            <Chip size="small" variant="filled" label="Limpar tudo" onClick={onClear} sx={{ cursor: 'pointer' }} />
          )}
        </Stack>
      )}
    </Box>
  )
}
