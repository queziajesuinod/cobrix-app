// client/src/features/auth/AuthContext.jsx
import React from 'react';
import api, { writeAuth, clearAuth } from '@/lib/api-client';

const AuthCtx = React.createContext(null);
export const useAuth = () => React.useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [auth, setAuth] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  // hidrata do storage
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('auth');
      if (raw) setAuth(JSON.parse(raw));
    } catch {}
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    const next = { token: data.token, user: data.user };
    writeAuth(next);
    setAuth(next);
    return next;
  };

  const logout = () => {
    clearAuth();
    setAuth(null);
  };

  const value = React.useMemo(() => ({
    user: auth?.user ?? null,
    token: auth?.token ?? null,
    setAuth,
    login,
    logout,
  }), [auth]);

  if (loading) return null; // ou um splash

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
