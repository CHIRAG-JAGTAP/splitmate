export function Logo({ size = 32, text = true }: { size?: number; text?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="9" fill="rgb(var(--brand))" /><path d="M8 20.5c0-3.6 8-2.4 8-5.6 0-2.6-5-2.4-6.6-.7M24 11.5c0 3.6-8 2.4-8 5.6 0 2.6 5 2.4 6.6.7" fill="none" stroke="rgb(var(--brand-ink))" strokeWidth="2.4" strokeLinecap="round" /><circle cx="24.5" cy="23.5" r="2.6" fill="rgb(var(--gold))" /></svg>
      {text && <span className="font-display text-xl font-extrabold tracking-tight">SplitMate</span>}
    </span>
  );
}
