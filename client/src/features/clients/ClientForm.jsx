import React from 'react'
import { Box, Stack, TextField, Button, Grid, InputAdornment, Typography, Divider } from '@mui/material'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import AssignmentIndOutlinedIcon from '@mui/icons-material/AssignmentIndOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

const startIcon = (Icon) => ({
  startAdornment: (
    <InputAdornment position="start">
      <Icon fontSize="small" sx={{ color: 'text.disabled' }} />
    </InputAdornment>
  ),
})

export const digitsOnly = (value = '') => String(value).replace(/\D+/g, '')

const formatCpf = (digits) => {
  const clean = digits.slice(0, 11)
  return clean
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

const formatCnpj = (digits) => {
  const clean = digits.slice(0, 14)
  return clean
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{4})/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

export const formatDocumentValue = (value) => {
  const digits = digitsOnly(value).slice(0, 14)
  if (!digits) return ''
  if (digits.length <= 11) return formatCpf(digits)
  return formatCnpj(digits)
}

export const formatPhoneValue = (value = '') => {
  const digits = digitsOnly(value).slice(0, 11)
  if (!digits) return ''
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, (_, a, b, c) => {
      const partC = c ? `-${c}` : ''
      return `(${a}) ${b}${partC}`
    })
  }
  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) => {
    const partC = c ? `-${c}` : ''
    return `(${a}) ${b}${partC}`
  })
}

const schema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  email: z.string().trim().email('Email inválido').optional().nullable(),
  phone: z.string().trim().min(8, 'Telefone inválido').optional().nullable(),
  responsavel: z.string().trim().min(2, 'Responsável obrigatório'),
  document: z.string().trim().optional().nullable().refine((value) => {
    if (!value) return true
    const d = digitsOnly(value)
    return d.length === 11 || d.length === 14
  }, { message: 'Documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos' }),
})

/**
 * Formulário de cliente (campos + ações) — usado na página de cadastro/edição.
 * props: defaultValues (cliente ou null), onSubmit(form), onCancel(), submitting
 */
export default function ClientForm({ defaultValues, onSubmit, onCancel, submitting }) {
  const formDefaults = React.useMemo(() => ({
    name: defaultValues?.name ?? '',
    email: defaultValues?.email ?? '',
    phone: formatPhoneValue(defaultValues?.phone ?? ''),
    responsavel: defaultValues?.responsavel ?? '',
    document: formatDocumentValue(defaultValues?.document ?? defaultValues?.document_cpf ?? defaultValues?.document_cnpj ?? ''),
  }), [defaultValues])

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, control } = useForm({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })
  React.useEffect(() => { reset(formDefaults) }, [formDefaults, reset])

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1 }}>
        Identificação
      </Typography>
      <Grid container spacing={2.5} sx={{ mt: 0 }}>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth label="Nome" required placeholder="Nome do cliente"
            {...register('name')} error={!!errors.name} helperText={errors.name?.message}
            InputProps={startIcon(PersonOutlineIcon)}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth label="Responsável" required placeholder="Quem responde pelo contrato"
            {...register('responsavel')} error={!!errors.responsavel}
            helperText={errors.responsavel?.message || 'Pessoa responsável pelo contrato/pagamento'}
            InputProps={startIcon(BadgeOutlinedIcon)}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <Controller
            name="document"
            control={control}
            render={({ field }) => (
              <TextField
                fullWidth label="CPF/CNPJ" placeholder="Informe o CPF ou CNPJ"
                value={field.value ?? ''}
                onChange={(event) => field.onChange(formatDocumentValue(event.target.value))}
                inputProps={{ inputMode: 'numeric' }}
                error={!!errors.document} helperText={errors.document?.message}
                InputProps={startIcon(AssignmentIndOutlinedIcon)}
              />
            )}
          />
        </Grid>
      </Grid>

      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1, display: 'block', mt: 3 }}>
        Contato
      </Typography>
      <Grid container spacing={2.5} sx={{ mt: 0 }}>
        <Grid item xs={12} md={6}>
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <TextField
                fullWidth label="Telefone" placeholder="(67) 99999-9999"
                value={field.value ?? ''}
                onChange={(event) => field.onChange(formatPhoneValue(event.target.value))}
                error={!!errors.phone} helperText={errors.phone?.message || 'Usado para enviar as notificações de cobrança'}
                inputProps={{ inputMode: 'tel' }}
                InputProps={startIcon(PhoneOutlinedIcon)}
              />
            )}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth label="Email" placeholder="email@exemplo.com"
            {...register('email')} error={!!errors.email} helperText={errors.email?.message}
            InputProps={startIcon(EmailOutlinedIcon)}
          />
        </Grid>
      </Grid>

      <Divider sx={{ mt: 3.5, mb: 2 }} />
      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <Button type="button" color="inherit" onClick={onCancel}>Cancelar</Button>
        <Button
          type="submit"
          variant="contained"
          size="large"
          startIcon={<CheckCircleOutlineIcon />}
          disabled={isSubmitting || submitting}
        >
          {defaultValues?.id ? 'Salvar cliente' : 'Cadastrar cliente'}
        </Button>
      </Stack>
    </Box>
  )
}
