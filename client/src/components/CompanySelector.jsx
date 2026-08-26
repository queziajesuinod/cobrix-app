import React from 'react'
import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Chip,
  CircularProgress,
  Alert
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthContext'
import { companyService } from '@/features/companies/company.service'
import BusinessIcon from '@mui/icons-material/Business'

// Seletor de empresa ativa. Aparece para:
//  - master: sempre (pode alternar entre todas as empresas às quais está vinculado);
//  - demais papéis (ex.: admin): apenas quando vinculado a MAIS de uma empresa.
// A troca persiste em selectedCompanyId (localStorage) e o X-Company-Id vai em
// toda requisição, agora honrado pelo backend também para não-master.
export default function CompanySelector() {
  const { user, selectedCompanyId, setSelectedCompanyId } = useAuth()

  const isMaster = user?.role === 'master'
  const linkedCount = user?.company_ids?.length || 0
  // Não-master só precisa do seletor quando tem mais de uma empresa.
  const shouldRender = isMaster || linkedCount > 1

  const { data: companies = [], isLoading, error } = useQuery({
    // Master usa a lista completa (/companies); demais usam apenas as suas (/mine).
    queryKey: isMaster ? ['companies'] : ['companies-mine'],
    queryFn: () => (isMaster ? companyService.list() : companyService.mine()),
    enabled: shouldRender,
    staleTime: 5 * 60 * 1000,
  })

  if (!shouldRender) {
    return null
  }

  const handleCompanyChange = (event) => {
    const companyId = event.target.value
    setSelectedCompanyId(companyId === '' ? null : Number(companyId))
  }

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId)

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          Carregando empresas...
        </Typography>
      </Box>
    )
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Erro ao carregar empresas: {error.message}
      </Alert>
    )
  }

  return (
    <Box
      sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      data-testid="company-selector"
    >
      <FormControl fullWidth size="small">
        <InputLabel id="company-selector-label">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BusinessIcon fontSize="small" />
            Empresa Ativa
          </Box>
        </InputLabel>
        <Select
          labelId="company-selector-label"
          value={selectedCompanyId ?? ''}
          onChange={handleCompanyChange}
          label="Empresa Ativa"
          sx={{
            '& .MuiSelect-select': {
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }
          }}
        >
          {/* Master pode "desmarcar" (fica sem empresa e escolhe na lista de Empresas).
              Para não-master, uma empresa ativa é sempre necessária. */}
          {isMaster && (
            <MenuItem value="">
              <Typography color="text.secondary" fontStyle="italic">
                Selecione uma empresa
              </Typography>
            </MenuItem>
          )}
          {companies.map((company) => (
            <MenuItem key={company.id} value={company.id}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <BusinessIcon fontSize="small" color="primary" />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={500}>
                    {company.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    ID: {company.id}
                  </Typography>
                </Box>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {selectedCompany && (
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            icon={<BusinessIcon />}
            label={`${selectedCompany.name} (ID: ${selectedCompany.id})`}
            color="primary"
            variant="outlined"
            size="small"
          />
        </Box>
      )}

      {isMaster && !selectedCompanyId && companies.length > 0 && (
        <Typography variant="caption" color="warning.main" sx={{ mt: 1, display: 'block' }}>
          ⚠️ Selecione uma empresa para acessar os dados
        </Typography>
      )}
    </Box>
  )
}
