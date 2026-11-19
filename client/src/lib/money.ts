/** Money is integer paise everywhere. These helpers are display/parse only - the server does all split maths. */
export const formatINR = (paise: number, opts: { sign?: boolean; compact?: boolean } = {}) => {
  const abs = Math.abs(paise) / 100;
  const body = opts.compact && abs >= 100000
    ? `${(abs / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}L`
    : abs.toLocaleString('en-IN', { minimumFractionDigits: abs % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  const sign = paise < 0 ? '-' : opts.sign && paise > 0 ? '+' : '';
  return `${sign}₹${body}`;
};

/** "12.5" -> 1250. Returns null for anything that is not a valid rupee amount with at most 2 decimals. */
export function rupeesToPaise(input: string): number | null {
  const s = input.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [w, f = ''] = s.replace('-', '').split('.');
  const p = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return neg ? -p : p;
}
export const paiseToInput = (p: number) => (p / 100).toFixed(2).replace(/\.00$/, '');

export const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const timeAgo = (d: string | Date) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
};
