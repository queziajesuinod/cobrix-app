import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: '#2065D1' },
    secondary: { main: '#3366FF' },
    background: { default: '#f7f8fb', paper: '#ffffff' }
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: { styleOverrides: { root: { textTransform: 'none', borderRadius: 10 } } },
    MuiCard: { styleOverrides: { root: { borderRadius: 16 } } },
  }
})
