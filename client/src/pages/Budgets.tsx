import { PiggyBank, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { del, errMsg, post } from '../lib/api';
import { formatINR, monthLabel, rupeesToPaise } from '../lib/money';
import { useFetch } from '../lib/hooks';
import { CATEGORIES, type BudgetRow, type Group } from '../lib/types';
import { toast } from '../store';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageSkeleton, Select, cx } from '../ui';
import { CAT_LABEL } from '../ui/charts';

const TONE = { ok: 'bg-pos', warning: 'bg-gold', over: 'bg-neg' } as const;
const label = (b: { scope: string; category: string | null; groupName?: string | null }) => b.scope === 'monthly' ? 'Overall monthly' : b.scope === 'category' ? `${CAT_LABEL[b.category as keyof typeof CAT_LABEL] ?? b.category}` : b.groupName ?? 'Group';

export default function Budgets() {
  const { data, loading, error, reload } = useFetch<{ items: BudgetRow[] }>('/budgets');
  const hist = useFetch<{ items: { id: string; month: string; scope: string; category: string | null; limitPaise: number; spentPaise: number; pct: number }[] }>('/budgets/history');
  const [adding, setAdding] = useState(false);
  const [rm, setRm] = useState<BudgetRow | null>(null);
  const remove = async () => { try { await del(`/budgets/${rm!.id}`); toast.success('Budget removed'); setRm(null); reload(); hist.reload(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-6">
      <PageHeader title="Budgets" sub={`Spending limits for ${monthLabel(new Date().toISOString().slice(0, 7))}`} action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New budget</Button>} />
      {loading && !data ? <PageSkeleton /> : error ? <ErrorState message={error} retry={reload} /> : !data?.items.length ? (
        <EmptyState icon={<PiggyBank className="h-6 w-6" />} title="No budgets this month" body="Set an overall, per-category or per-group limit and SplitMate will warn you as you approach it." action={<Button onClick={() => setAdding(true)}>Create a budget</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">{data.items.map((b) => (
          <Card key={b.id}>
            <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{label(b)}</p><p className="text-xs text-muted">Alert at {b.alertThresholdPct}%</p></div>
              <div className="flex items-center gap-1"><Badge tone={b.status === 'ok' ? 'pos' : b.status === 'warning' ? 'gold' : 'neg'}>{b.status === 'ok' ? 'On track' : b.status === 'warning' ? 'Near limit' : 'Over budget'}</Badge>
                <button aria-label="Delete budget" onClick={() => setRm(b)} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-neg"><Trash2 className="h-4 w-4" /></button></div></div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={Math.min(100, Math.round(b.pct))} aria-valuemin={0} aria-valuemax={100} aria-label={`${label(b)} budget used`}>
              <div className={cx('h-full rounded-full transition-[width] duration-500', TONE[b.status])} style={{ width: `${Math.min(100, b.pct)}%` }} /></div>
            <p className="mt-2 text-sm"><b className="tabular-nums">{formatINR(b.spentPaise)}</b> <span className="text-muted">of {formatINR(b.limitPaise)} · {Math.round(b.pct)}%</span></p>
          </Card>))}</div>
      )}
      <Card>
        <CardHeader title="Budget history" sub="Recent months" />
        {!hist.data?.items.length ? <p className="text-sm text-muted">History appears once you have set budgets.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4 font-medium">Month</th><th className="pr-4 font-medium">Budget</th><th className="pr-4 text-right font-medium">Limit</th><th className="pr-4 text-right font-medium">Spent</th><th className="text-right font-medium">Used</th></tr></thead>
            <tbody className="divide-y divide-line">{hist.data.items.map((h) => <tr key={h.id}><td className="py-2.5 pr-4">{monthLabel(h.month)}</td><td className="pr-4">{label({ scope: h.scope, category: h.category })}</td><td className="pr-4 text-right tabular-nums">{formatINR(h.limitPaise)}</td><td className="pr-4 text-right tabular-nums">{formatINR(h.spentPaise)}</td><td className={cx('text-right font-semibold tabular-nums', h.pct > 100 ? 'text-neg' : 'text-ink')}>{h.pct}%</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <NewBudget open={adding} onClose={() => setAdding(false)} onDone={() => { reload(); hist.reload(); }} />
      <ConfirmDialog open={!!rm} title="Delete this budget?" body="Your expenses are not affected." confirmLabel="Delete" danger onConfirm={remove} onClose={() => setRm(null)} />
    </div>
  );
}

function NewBudget({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const groups = useFetch<{ items: Group[] }>(open ? '/groups' : null);
  const [scope, setScope] = useState<'monthly' | 'category' | 'group'>('monthly');
  const [category, setCategory] = useState<string>('food'); const [groupId, setGroupId] = useState('');
  const [amount, setAmount] = useState(''); const [pct, setPct] = useState('80'); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const limitPaise = rupeesToPaise(amount);
    if (!limitPaise || limitPaise <= 0) return setErr('Enter a valid amount');
    if (scope === 'group' && !groupId) return setErr('Choose a group');
    setBusy(true); setErr(null);
    try { await post('/budgets', { scope, limitPaise, alertThresholdPct: Number(pct), ...(scope === 'category' && { category }), ...(scope === 'group' && { groupId }) }); toast.success('Budget created'); setAmount(''); onClose(); onDone(); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New budget">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Type">{(id) => <Select id={id} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}><option value="monthly">Overall monthly</option><option value="category">Category</option><option value="group">Group</option></Select>}</Field>
        {scope === 'category' && <Field label="Category">{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</Select>}</Field>}
        {scope === 'group' && <Field label="Group">{(id) => <Select id={id} value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">Choose…</option>{groups.data?.items.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>}</Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Limit (₹)">{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" required />}</Field>
          <Field label="Alert at (%)">{(id) => <Input id={id} type="number" min={1} max={100} value={pct} onChange={(e) => setPct(e.target.value)} />}</Field>
        </div>
        {err && <p role="alert" className="text-sm text-neg">{err}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Create budget</Button></div>
      </form>
    </Modal>
  );
}
