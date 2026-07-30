import React from 'react'
import { Autocomplete, TextField } from '@mui/material'

/**
 * Seletor de cliente com BUSCA (digite para filtrar) — substitui o <select> longo.
 *
 * props:
 *  - options: [{ id, name }]
 *  - value: id selecionado (número) ou '' / null
 *  - onChange: (id | '') => void   (retorna '' quando limpo)
 *  - label, size, fullWidth, error, helperText, placeholder, disabled
 */
export default function ClientAutocomplete({
  options = [],
  value,
  onChange,
  label = 'Cliente',
  size = 'small',
  fullWidth = true,
  error,
  helperText,
  placeholder = 'Digite para buscar…',
  disabled = false,
  sx,
}) {
  const selected = React.useMemo(
    () => options.find((o) => Number(o.id) === Number(value)) || null,
    [options, value]
  )

  return (
    <Autocomplete
      options={options}
      value={selected}
      onChange={(_, opt) => onChange(opt ? opt.id : '')}
      getOptionLabel={(o) => o?.name || ''}
      isOptionEqualToValue={(o, v) => Number(o?.id) === Number(v?.id)}
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      sx={sx}
      autoHighlight
      noOptionsText="Nenhum cliente encontrado"
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          error={error}
          helperText={helperText}
        />
      )}
    />
  )
}
