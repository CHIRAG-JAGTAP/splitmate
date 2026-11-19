import { create } from 'zustand';
import { get, patch, post, setAuthLostHandler } from '../lib/api';
import type { User } from '../lib/types';

/* ---------- theme ---------- */
type Theme = 'light' | 'dark' | 'system';
const readTheme = (): Theme => { try { return JSON.parse(localStorage.getItem('sm-theme') || '"system"'); } catch { return 'system'; } };
const resolve = (t: Theme) => (t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t);
export const useTheme = create<{ theme: Theme; resolved: 'light' | 'dark'; set: (t: Theme) => void }>((set) => ({
  theme: readTheme(), resolved: resolve(readTheme()),
  set: (theme) => {
    try { localStorage.setItem('sm-theme', JSON.stringify(theme)); } catch { /* storage blocked */ }
    const resolved = resolve(theme); document.documentElement.dataset.theme = resolved; set({ theme, resolved });
  },
}));
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (useTheme.getState().theme === 'system') useTheme.getState().set('system'); });

/* ---------- toasts ---------- */
export interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }
let tid = 0;
export const useToasts = create<{ items: Toast[]; push: (kind: Toast['kind'], text: string) => void; dismiss: (id: number) => void }>((set, getS) => ({
  items: [],
  push: (kind, text) => { const id = ++tid; set({ items: [...getS().items.slice(-3), { id, kind, text }] }); setTimeout(() => getS().dismiss(id), kind === 'error' ? 6000 : 3500); },
  dismiss: (id) => set({ items: getS().items.filter((t) => t.id !== id) }),
}));
export const toast = { success: (t: string) => useToasts.getState().push('success', t), error: (t: string) => useToasts.getState().push('error', t), info: (t: string) => useToasts.getState().push('info', t) };

/* ---------- auth ---------- */
interface AuthState {
  user: User | null; ready: boolean;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
  updateProfile: (p: Partial<Pick<User, 'name' | 'upiId' | 'theme'>>) => Promise<void>;
}
export const useAuth = create<AuthState>((set, getS) => ({
  user: null, ready: false,
  bootstrap: async () => { try { set({ user: (await get<{ user: User }>('/auth/me')).user }); } catch { set({ user: null }); } finally { set({ ready: true }); } },
  login: async (email, password) => { set({ user: (await post<{ user: User }>('/auth/login', { email, password })).user }); },
  register: async (name, email, password) => { set({ user: (await post<{ user: User }>('/auth/register', { name, email, password })).user }); },
  logout: async () => { try { await post('/auth/logout'); } finally { set({ user: null }); } },
  setUser: (user) => set({ user }),
  updateProfile: async (p) => { set({ user: (await patch<{ user: User }>('/users/me', p)).user }); },
}));
setAuthLostHandler(() => { if (useAuth.getState().user) { useAuth.setState({ user: null }); } });

/* ---------- sidebar ---------- */
export const useSidebar = create<{ collapsed: boolean; mobileOpen: boolean; toggle: () => void; setMobile: (v: boolean) => void }>((set, g) => ({
  collapsed: (() => { try { return localStorage.getItem('sm-collapsed') === '1'; } catch { return false; } })(), mobileOpen: false,
  toggle: () => { const c = !g().collapsed; try { localStorage.setItem('sm-collapsed', c ? '1' : '0'); } catch { /* ignore */ } set({ collapsed: c }); },
  setMobile: (mobileOpen) => set({ mobileOpen }),
}));
