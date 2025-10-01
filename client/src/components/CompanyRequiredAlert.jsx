import React from 'react'
import { Alert, AlertTitle, Box, Button } from '@mui/material'
import { useAuth } from '@/features/auth/AuthContext'
import BusinessIcon from '@mui/icons-material/Business'
import WarningIcon from '@mui/icons-material/Warning'

export default function CompanyRequiredAlert() {
  const { user, selectedCompanyId } = useAuth()

  // Só mostrar para usuários master sem empresa selecionada
  if (user?.role !== 'master' || selectedCompanyId) {
    return null
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Alert 
        severity="warning" 
        icon={<WarningIcon />}
        sx={{ 
          '& .MuiAlert-message': { width: '100%' },
          border: '1px solid',
          borderColor: 'warning.main'
        }}
      >
        <AlertTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BusinessIcon />
          Empresa não selecionada
        </AlertTitle>
        
        <Box sx={{ mt: 1 }}>
          Para acessar os dados do sistema, você precisa selecionar uma empresa no menu lateral.
        </Box>
        
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            color="warning"
            size="small"
            startIcon={<BusinessIcon />}
            onClick={() => {
              // Scroll para o seletor de empresa no sidebar
              const companySelector = document.querySelector('[data-testid="company-selector"]')
              if (companySelector) {
                companySelector.scrollIntoView({ behavior: 'smooth', block: 'center' })
                // Destacar temporariamente o seletor
                companySelector.style.animation = 'pulse 2s ease-in-out'
                setTimeout(() => {
                  companySelector.style.animation = ''
                }, 2000)
              }
            }}
          >
            Ir para seletor de empresa
          </Button>
        </Box>
      </Alert>
    </Box>
  )
}
