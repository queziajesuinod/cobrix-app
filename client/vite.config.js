import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 🚀 Configuração universal (dev + produção)
export default defineConfig({
  // 🔧 Caminho base relativo — garante que o app funcione em IP, domínio e HTTPS
  base: './',

  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },

  // 🌐 Servidor de desenvolvimento local (não afeta build de produção)
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
