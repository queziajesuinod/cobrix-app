import { QueryClient } from '@tanstack/react-query'

// Defaults sensatos: evita refetch agressivo a cada foco de janela e define
// um staleTime/retry padrão (antes tudo era staleTime:0 + refetch on focus).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
