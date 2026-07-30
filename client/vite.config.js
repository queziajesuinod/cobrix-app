import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 🚀 Configuração universal (dev + produção)
export default defineConfig({
  base: './',

  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '/api'),
      },
    },
  },

  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['cobrix.aleftec.com.br'],
  },

  build: {
    rollupOptions: {
      output: {
        // Separa vendors em chunks cacheáveis independentemente, reduzindo o
        // chunk principal (que passava de 500 kB).
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@emotion/react', '@emotion/styled'],
          'mui-icons': ['@mui/icons-material'],
          query: ['@tanstack/react-query'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
})
