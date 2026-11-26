import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export type Role = 'admin' | 'finance' | 'manager' | 'employee';
export type User = { id: string; email: string; role: Role; companyId: string; employeeId: string | null };

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'HR Admin', finance: 'Finance', manager: 'Manager', employee: 'Employee',
};

export const homeFor = (role: Role) =>
  role === 'employee' ? '/my-day' : role === 'manager' ? '/leave' : '/dashboard';

type AuthValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Role>;
  demoLogin: (role: Role) => Promise<Role>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const d = await api<{ user: User }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    setUser(d.user);
    return d.user.role;
  };

  const demoLogin = async (role: Role) => {
    const d = await api<{ user: User }>('/auth/demo', {
      method: 'POST', body: JSON.stringify({ role }),
    });
    setUser(d.user);
    return d.user.role;
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, demoLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}