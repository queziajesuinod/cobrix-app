import { createTheme } from '@mui/material/styles'

// Tokens de cor por modo. Ajuste aqui para reafinar a identidade visual.
const tokens = {
  light: {
    primary: '#2065D1',
    secondary: '#3366FF',
    bgDefault: '#f4f6fb',
    bgPaper: '#ffffff',
    divider: 'rgba(15,23,42,0.08)',
    cardShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
  },
  dark: {
    primary: '#5b8def',
    secondary: '#6b8dff',
    bgDefault: '#0d1117',
    bgPaper: '#161b22',
    divider: 'rgba(255,255,255,0.09)',
    cardShadow: '0 1px 2px rgba(0,0,0,0.5)',
  },
}

export function createAppTheme(mode = 'light') {
  const t = tokens[mode] || tokens.light

  return createTheme({
    palette: {
      mode,
      primary: { main: t.primary },
      secondary: { main: t.secondary },
      background: { default: t.bgDefault, paper: t.bgPaper },
      divider: t.divider,
    },
    shape: { borderRadius: 12 },
    components: {
      MuiButton: {
        styleOverrides: { root: { textTransform: 'none', borderRadius: 10 } },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderRadius: 16,
            border: '1px solid',
            borderColor: t.divider,
            backgroundImage: 'none',
            boxShadow: t.cardShadow,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiDrawer: {
        styleOverrides: { paper: { backgroundImage: 'none' } },
      },
    },
  })
}

// Tema padrão (light) — mantido para imports diretos existentes.
export const theme = createAppTheme('light')
