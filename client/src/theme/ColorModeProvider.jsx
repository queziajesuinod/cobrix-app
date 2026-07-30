import React from 'react'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { createAppTheme } from './theme'

const STORAGE_KEY = 'colorMode'

export const ColorModeContext = React.createContext({ mode: 'light', toggle: () => {}, setMode: () => {} })
export const useColorMode = () => React.useContext(ColorModeContext)

function getInitialMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* ignore */ }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  } catch { /* ignore */ }
  return 'light'
}

export function ColorModeProvider({ children }) {
  const [mode, setModeState] = React.useState(getInitialMode)

  const setMode = React.useCallback((next) => {
    setModeState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  }, [])

  const toggle = React.useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
      return next
    })
  }, [])

  const theme = React.useMemo(() => createAppTheme(mode), [mode])
  const value = React.useMemo(() => ({ mode, toggle, setMode }), [mode, toggle, setMode])

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}
