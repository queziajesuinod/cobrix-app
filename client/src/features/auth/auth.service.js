// client/src/features/auth/auth.service.js

const AUTH_KEY = 'auth';
const BASE = import.meta.env.VITE_API_URL+'/api' || 'http://localhost:3002';



/** Lê o objeto { token, user } do storage */
function getAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persiste { token, user } no storage */
function setAuth(data) {
  if (!data || !data.token || !data.user) return;
  try {
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ token: data.token, user: data.user })
    );
  } catch {}
}

/** Retorna o token atual (ou null) */
function getToken() {
  return getAuth()?.token ?? null;
}

/** Limpa sessão */
function clearToken() {
  try { localStorage.removeItem(AUTH_KEY); } catch {}
}

/** Faz login e persiste { token, user } */
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!data?.token || !data?.user) {
    throw new Error('Resposta inválida do servidor');
  }

  setAuth(data);
  return data; // { token, user }
}

/** Valida o token atual no backend */
async function verify() {
  const token = getToken();
  if (!token) throw new Error('Sem token');

  const res = await fetch(`${BASE}/auth/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data; // ex.: { ok: true, user }
}

export const authService = {
  getAuth,
  setAuth,
  getToken,
  clearToken,
  login,
  verify,
};

export default authService;
