import { AlertTriangle, Check, Info, Loader2, X } from 'lucide-react';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useToasts } from '../store';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ---------- Button ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode };
export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...p }: BtnProps) {
  const v = {
    primary: 'bg-brand text-brand-ink hover:brightness-110 shadow-sm',
    secondary: 'bg-surface text-ink border border-line hover:bg-raised',
    ghost: 'text-muted hover:bg-raised hover:text-ink',
    danger: 'bg-neg text-white hover:brightness-110',
    gold: 'bg-gold text-[#2b2100] hover:brightness-105 shadow-sm',
  }[variant];
  return (
    <button {...p} disabled={disabled || loading} className={cx('inline-flex items-center justify-center gap-2 rounded-ctl font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-55', size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm', v, className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}{children}
    </button>
  );
}

/* ---------- Card ---------- */
export const Card = ({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...p} className={cx('rounded-card border border-line bg-surface shadow-card', className)}>{children}</div>
);
export const CardHeader = ({ title, action, sub }: { title: ReactNode; action?: ReactNode; sub?: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
    <div><h3 className="text-base font-bold">{title}</h3>{sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}</div>{action}
  </div>
);

/* ---------- Form fields ---------- */
const ctl = 'w-full rounded-ctl border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-60';
export function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
      {children(id)}
      {error ? <p role="alert" className="mt-1 text-sm text-neg">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(ctl, 'h-10', className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(ctl, 'h-10 pr-8', className)}>{children}</select>;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(ctl, 'min-h-[84px] py-2', className)} />;

/* ---------- Avatar (colour derived from name so people are recognisable at a glance) ---------- */
const AV = ['#0E5E6F', '#B4560F', '#5B4B9A', '#2F7D4F', '#A8325E', '#1F6FB2', '#8A6A00', '#7A3E2E'];
export function Avatar({ name, src, size = 36, className }: { name?: string; src?: string | null; size?: number; className?: string }) {
  const n = name?.trim() || '?';
  const h = [...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length;
  const initials = n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return src
    ? <img src={src} alt={n} width={size} height={size} className={cx('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
    : <span aria-label={n} className={cx('inline-flex shrink-0 select-none items-center justify-center rounded-full font-display font-bold text-white', className)} style={{ width: size, height: size, background: AV[h], fontSize: size * 0.38 }}>{initials}</span>;
}

/* ---------- Badge ---------- */
const tones = { neutral: 'bg-raised text-muted', brand: 'bg-brand-soft text-brand', pos: 'bg-pos-soft text-pos', neg: 'bg-neg-soft text-neg', gold: 'bg-gold-soft text-[#8a6100] dark:text-gold' };
export const Badge = ({ tone = 'neutral', children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) => (
  <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>
);

/* ---------- Skeleton / Empty / Spinner ---------- */
export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cx('skeleton h-4 w-full', className)} />;
export const PageSkeleton = () => (
  <div className="space-y-4" role="status" aria-label="Loading">
    <Skeleton className="h-9 w-56" />
    <div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
    <Skeleton className="h-64" />
  </div>
);
export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">{icon}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export const ErrorState = ({ message, retry }: { message: string; retry?: () => void }) => (
  <Card className="p-6"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-neg" /><div className="flex-1"><p className="font-semibold">Couldn't load this page</p><p className="text-sm text-muted">{message}</p></div>{retry && <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>}</div></Card>
);

/* ---------- Modal (focus trap, Esc, scroll lock) ---------- */
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#04141a]/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('flex max-h-[92vh] w-full animate-pop flex-col rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-lg font-bold">{title}</h2>
          <button data-close aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, loading, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p className="text-sm text-muted">{body}</p>
    </Modal>
  );
}

/* ---------- Toasts ---------- */
export function Toaster() {
  const { items, dismiss } = useToasts();
  const icon = { success: <Check className="h-4 w-4" />, error: <AlertTriangle className="h-4 w-4" />, info: <Info className="h-4 w-4" /> };
  const tone = { success: 'bg-pos text-white', error: 'bg-neg text-white', info: 'bg-brand text-brand-ink' };
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
      {items.map((t) => (
        <div key={t.id} role="status" className="pointer-events-auto flex w-full max-w-sm animate-pop items-start gap-3 rounded-xl border border-line bg-surface p-3 shadow-pop">
          <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', tone[t.kind])}>{icon[t.kind]}</span>
          <p className="flex-1 text-sm font-medium">{t.text}</p>
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Money ---------- */
import { formatINR } from '../lib/money';
export function Money({ paise, tone, className, size }: { paise: number; tone?: boolean; className?: string; size?: 'lg' | 'xl' }) {
  const color = tone ? (paise > 0 ? 'text-pos' : paise < 0 ? 'text-neg' : 'text-muted') : '';
  return <span className={cx('num font-display font-bold', size === 'xl' ? 'text-4xl' : size === 'lg' ? 'text-2xl' : '', color, className)}>{formatINR(paise, { sign: tone })}</span>;
}

export function PageHeader({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>{sub && <p className="mt-1 text-sm text-muted">{sub}</p>}</div>{action}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; badge?: number }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('relative flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-semibold transition', value === t.id ? 'text-brand' : 'text-muted hover:text-ink')}>
          {t.label}{!!t.badge && <span className="rounded-full bg-gold px-1.5 text-xs text-[#2b2100]">{t.badge}</span>}
          {value === t.id && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded bg-brand" />}
        </button>
      ))}
    </div>
  );
}
