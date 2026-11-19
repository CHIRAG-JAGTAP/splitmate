import { BarChart3, Bell, ChevronsLeft, ChevronsRight, HandCoins, LayoutDashboard, LogOut, Menu, Monitor, Moon, PiggyBank, Shield, Sun, UserRound, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { get } from '../lib/api';
import { Avatar, cx } from '../ui';
import { Logo } from '../ui/Logo';
import { toast, useAuth, useSidebar, useTheme } from '../store';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/groups', label: 'Groups', icon: Users },
  { to: '/settlements', label: 'Settlements', icon: HandCoins },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
];

function ThemeToggle() {
  const { theme, set } = useTheme();
  const next = { light: 'dark', dark: 'system', system: 'light' } as const;
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return <button onClick={() => set(next[theme])} aria-label={`Theme: ${theme}. Click to change`} title={`Theme: ${theme}`} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-ink"><Icon className="h-5 w-5" /></button>;
}

function Bell_() {
  const [n, setN] = useState(0);
  const loc = useLocation();
  useEffect(() => {
    let live = true;
    const load = () => get<{ count: number }>('/notifications/unread-count').then((r) => live && setN(r.count)).catch(() => undefined);
    load(); const t = setInterval(load, 30000);
    return () => { live = false; clearInterval(t); };
  }, [loc.pathname]);
  return (
    <Link to="/notifications" aria-label={`Notifications${n ? `, ${n} unread` : ''}`} className="relative rounded-lg p-2 text-muted hover:bg-raised hover:text-ink">
      <Bell className="h-5 w-5" />
      {n > 0 && <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-[#2b2100]">{n > 9 ? '9+' : n}</span>}
    </Link>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-full p-1 hover:bg-raised"><Avatar name={user.name} src={user.avatarUrl} size={34} /></button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-60 animate-pop rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          <div className="px-3 py-2"><p className="truncate font-semibold">{user.name}</p><p className="truncate text-xs text-muted">{user.email}</p></div>
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-raised"><UserRound className="h-4 w-4" />Profile and security</Link>
          {user.role === 'admin' && <Link role="menuitem" to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-raised"><Shield className="h-4 w-4" />Admin console</Link>}
          <button role="menuitem" onClick={async () => { await logout(); toast.info('Logged out'); nav('/login'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-neg hover:bg-neg-soft"><LogOut className="h-4 w-4" />Log out</button>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { collapsed, toggle, mobileOpen, setMobile } = useSidebar();
  const { user } = useAuth();
  const loc = useLocation();
  useEffect(() => setMobile(false), [loc.pathname, setMobile]);
  const items = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Admin', icon: Shield }] : NAV;

  const links = (compact: boolean) => (
    <nav aria-label="Main" className="flex flex-col gap-1 px-3">
      {items.map(({ to, label, icon: I, end }) => (
        <NavLink key={to} to={to} end={end} title={compact ? label : undefined}
          className={({ isActive }) => cx('group flex items-center gap-3 rounded-ctl px-3 py-2.5 text-sm font-semibold transition', compact && 'justify-center px-0', isActive ? 'bg-brand text-brand-ink shadow-sm' : 'text-muted hover:bg-raised hover:text-ink')}>
          <I className="h-5 w-5 shrink-0" />{!compact && label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-ink">Skip to content</a>
      <aside className={cx('fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-[72px]' : 'w-64')}>
        <div className={cx('flex h-16 items-center', collapsed ? 'justify-center' : 'px-6')}><Link to="/" aria-label="SplitMate home"><Logo text={!collapsed} /></Link></div>
        <div className="mt-2 flex-1">{links(collapsed)}</div>
        <button onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="m-3 flex items-center justify-center gap-2 rounded-ctl py-2 text-sm text-muted hover:bg-raised hover:text-ink">
          {collapsed ? <ChevronsRight className="h-5 w-5" /> : <><ChevronsLeft className="h-5 w-5" />Collapse</>}
        </button>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-[#04141a]/60" onClick={() => setMobile(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-pop bg-surface pt-3 shadow-pop">
            <div className="flex h-12 items-center justify-between px-5"><Logo /><button aria-label="Close menu" onClick={() => setMobile(false)} className="rounded-lg p-1.5 text-muted hover:bg-raised"><X className="h-5 w-5" /></button></div>
            <div className="mt-3">{links(false)}</div>
          </aside>
        </div>
      )}

      <div className={cx('transition-[padding] duration-200', collapsed ? 'lg:pl-[72px]' : 'lg:pl-64')}>
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2 lg:hidden"><button aria-label="Open menu" onClick={() => setMobile(true)} className="rounded-lg p-2 text-muted hover:bg-raised"><Menu className="h-5 w-5" /></button><Logo size={28} /></div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1"><ThemeToggle /><Bell_ /><UserMenu /></div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><Outlet /></main>
      </div>
    </div>
  );
}
