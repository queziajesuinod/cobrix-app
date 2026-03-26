import { api } from '@/lib/api-client';

export const systemHealthService = {
  getHealth: async () => (await api.get('/system/health')).data,
};

export default systemHealthService;
