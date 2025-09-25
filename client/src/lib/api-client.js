// client/src/lib/api-client.js
import axios from 'axios';

export const api = axios.create({ baseURL: '/api', withCredentials: true });

const isDev = import.meta?.env?.DEV ?? false;

function readAuth() {
  try {
    const raw = localStorage.getItem('auth');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function readSelectedCompanyId() {
  try {
    const raw = localStorage.getItem('selectedCompanyId');
    return raw ? Number(raw) : null;
  } catch { return null; }
}

export function writeAuth(data) {
  localStorage.setItem('auth', JSON.stringify(data));
}
export function clearAuth() {
  localStorage.removeItem('auth');
}

api.interceptors.request.use((config) => {
  const auth = readAuth();
  config.headers = config.headers || {};

  // Não injeta token nas rotas de auth
  const url = config.url || '';
  const isAuthRoute = url.startsWith('/auth/');

  if (!isAuthRoute && auth?.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }

  // X-Company-Id: se master e tiver escolhido uma empresa, priorize-a
  const selected = readSelectedCompanyId();
  const fromAuth = auth?.user?.company_id ?? null;
  const companyId = config.companyId ?? selected ?? fromAuth;
  if (companyId && !config.headers['X-Company-Id']) {
    config.headers['X-Company-Id'] = companyId;
  }

  return config;
});

// Redireciona só quando realmente é perda de sessão
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    const status = err?.response?.status;
    const reqUrl = err?.config?.url || '';

    // Se o server caiu / conexão recusada, não limpe auth
    const net = err?.code || '';
    const isNetworkDown = ['ECONNABORTED', 'ECONNREFUSED', 'ERR_NETWORK'].includes(net);

    // Só limpa o auth se foi 401 explícito e não é problema de rede
    if (status === 401 && !isNetworkDown) {
      // evite “derrubar” por 401 de rotas que só falharam por falta de X-Company-Id,
      // concentre a checagem no /auth/verify
      if (reqUrl.startsWith('/auth/verify') || reqUrl.startsWith('/auth/login')) {
        clearAuth();
        if (!location.pathname.startsWith('/login')) {
          window.location.assign('/login');
        }
      }
    }
    return Promise.reject(err);
  }
);
