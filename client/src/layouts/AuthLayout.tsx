import { Outlet } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { formatINR } from '../lib/money';

/* The auth side-panel shows a worked example of what the app does, rendered as a ledger "tape". */
const ROWS = [{ who: 'Aarav', note: 'paid for Goa villa', amt: 1800000 }, { who: 'Meera', note: 'paid for cab + fuel', amt: 420000 }, { who: 'Kabir', note: 'paid for dinner', amt: 650000 }];
export default function AuthLayout() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-brand p-12 text-brand-ink lg:flex lg:flex-col lg:justify-between" aria-hidden>
        <div className="[&_*]:!text-inherit"><Logo size={36} /></div>
        <div>
          <h2 className="max-w-md text-5xl font-extrabold leading-[1.05]">Everyone paid something. Nobody has to do the maths.</h2>
          <div className="mt-10 max-w-md rounded-2xl bg-white/10 p-5 ring-1 ring-white/20">
            {ROWS.map((r) => (
              <div key={r.who} className="flex items-baseline justify-between border-b border-dashed border-white/25 py-2.5 text-sm last:border-0">
                <span><b>{r.who}</b> <span className="opacity-75">{r.note}</span></span><span className="num font-display font-bold">{formatINR(r.amt)}</span>
              </div>
            ))}
            <div className="mt-3 flex items-center justify-between rounded-xl bg-gold px-4 py-3 text-[#2b2100]">
              <span className="text-sm font-semibold">3 friends, 2 payments to settle</span><span className="num font-display text-lg font-extrabold">{formatINR(1010000)}</span>
            </div>
          </div>
        </div>
        <p className="text-sm opacity-70">Free, open-source and runs on your own machine. SplitMate never moves your money; it just keeps the record straight.</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border-[28px] border-white/10" />
      </section>
      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm"><div className="mb-8 lg:hidden"><Logo /></div><Outlet /></div>
      </section>
    </div>
  );
}
