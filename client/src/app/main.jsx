import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ColorModeProvider } from '@/theme/ColorModeProvider'
import { queryClient } from '@/lib/queryClient'
import { AuthProvider } from '@/features/auth/AuthContext'
import { PermissionsProvider } from '@/features/permissions/PermissionsContext'
import { ConfirmProvider } from '@/components/ConfirmDialog'
import AppRouter from '@/routes'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ColorModeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PermissionsProvider>
            <HashRouter>
              <ConfirmProvider>
                <AppRouter />
              </ConfirmProvider>
            </HashRouter>
          </PermissionsProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ColorModeProvider>
  </React.StrictMode>
)
