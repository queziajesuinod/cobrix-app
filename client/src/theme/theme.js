import { createTheme, alpha } from '@mui/material/styles'
import { ptBR } from '@mui/material/locale'

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
    typography: {
      fontSize: 14,
      h4: { fontWeight: 700, letterSpacing: -0.3 },
      h5: { fontWeight: 700, letterSpacing: -0.2 },
      h6: { fontWeight: 700 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      body1: { lineHeight: 1.55 },
      body2: { lineHeight: 1.55 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none', borderRadius: 10, fontWeight: 600, minHeight: 38, paddingLeft: 16, paddingRight: 16 },
          sizeSmall: { borderRadius: 8, minHeight: 32 },
          contained: {
            boxShadow: 'none',
            '&:hover': { boxShadow: `0 6px 16px ${alpha('#000', 0.18)}` },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiChip: {
        styleOverrides: { root: { fontWeight: 600, borderRadius: 8 } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: t.divider,
            padding: '10px 16px',
            fontVariantNumeric: 'tabular-nums',
          },
          head: {
            fontWeight: 700,
            fontSize: 11.5,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            whiteSpace: 'nowrap',
            color: mode === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(15,23,42,0.6)',
            backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.02)',
            borderBottom: `1px solid ${t.divider}`,
          },
          // Cabeçalho fixo (stickyHeader): precisa de fundo OPACO, senão as linhas
          // passam "através" dele ao rolar. Cor sólida equivalente ao tom do header.
          stickyHeader: {
            backgroundColor: mode === 'dark' ? '#1d2228' : '#fafafb',
            zIndex: 3,
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: { '&:last-of-type td': { borderBottom: 0 } },
        },
      },
      MuiTableBody: {
        styleOverrides: {
          root: {
            '& .MuiTableRow-root:hover': {
              backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.025)',
            },
          },
        },
      },
      // Formulários: campos consistentes e legíveis (§8 Forms)
      MuiTextField: {
        defaultProps: { size: 'small' },
      },
      MuiOutlinedInput: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiInputLabel: {
        styleOverrides: {
          asterisk: { color: mode === 'dark' ? '#ff6b6b' : '#d32f2f' },
        },
      },
      MuiFormHelperText: {
        styleOverrides: { root: { marginLeft: 2 } },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 16 } },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { fontSize: 12, borderRadius: 8, padding: '6px 10px' },
        },
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
  }, ptBR)
}

// Tema padrão (light) — mantido para imports diretos existentes.
export const theme = createAppTheme('light')
