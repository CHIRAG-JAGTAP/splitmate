import { Camera, Loader2, ScanText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { errMsg, post, upload } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { formatINR, paiseToInput, rupeesToPaise } from '../../lib/money';
import { CATEGORIES, type Category, type Expense, type Member, type SplitMethod } from '../../lib/types';
import { toast } from '../../store';
import { Avatar, Button, Field, Input, Modal, Select, Textarea, cx } from '../../ui';
import { CAT_LABEL } from '../../ui/charts';

const METHODS: { id: SplitMethod; label: string; hint: string; unit: string }[] = [
  { id: 'equal', label: 'Equally', hint: 'Everyone selected pays the same.', unit: '' },
  { id: 'exact', label: 'Exact', hint: 'Enter each person\'s amount. They must add up to the total.', unit: '₹' },
  { id: 'percentage', label: 'Percent', hint: 'Enter each person\'s percentage. They must add up to 100.', unit: '%' },
  { id: 'shares', label: 'Shares', hint: 'Split in proportion, e.g. 2 shares vs 1 share.', unit: 'sh' },
  { id: 'unequal', label: 'Adjust', hint: 'Split equally after adding or removing an amount for some people.', unit: '±₹' },
];

interface Row { selected: boolean; value: string }
interface Props { open: boolean; onClose: () => void; groupId: string; members: Member[]; meId: string; expense?: Expense | null; onSaved: () => void }
interface Ocr { merchant: string | null; date: string | null; totalPaise: number | null; rawText: string; confidence: string }

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ExpenseForm({ open, onClose, groupId, members, meId, expense, onSaved }: Props) {
  const [desc, setDesc] = useState(''); const [amount, setAmount] = useState(''); const [category, setCategory] = useState<Category>('food');
  const [date, setDate] = useState(todayStr()); const [paidBy, setPaidBy] = useState(meId); const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<SplitMethod>('equal'); const [rows, setRows] = useState<Record<string, Row>>({});
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ userId: string; owedPaise: number }[] | null>(null); const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [scan, setScan] = useState<Ocr | null>(null); const [scanning, setScanning] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  // (re)initialise whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setErr(null); setScan(null); setReceipt(null); setPreview(null); setPreviewErr(null);
    if (expense) {
      setDesc(expense.description); setAmount(paiseToInput(expense.amountPaise)); setCategory(expense.category); setDate(expense.expenseDate.slice(0, 10));
      setPaidBy(expense.paidBy.id); setNotes(expense.notes ?? ''); setMethod(expense.splitMethod);
      const r: Record<string, Row> = {};
      for (const m of members) r[m.id] = { selected: false, value: defaultValue(expense.splitMethod) };
      for (const s of expense.splits) {
        const iv = s.inputValue;
        r[s.user.id] = { selected: true, value: iv === undefined ? defaultValue(expense.splitMethod) : expense.splitMethod === 'exact' || expense.splitMethod === 'unequal' ? paiseToInput(iv) : String(iv) };
      }
      setRows(r);
    } else {
      setDesc(''); setAmount(''); setCategory('food'); setDate(todayStr()); setPaidBy(meId); setNotes(''); setMethod('equal');
      setRows(Object.fromEntries(members.map((m) => [m.id, { selected: true, value: defaultValue('equal') }])));
    }
  }, [open, expense, members, meId]);

  const totalPaise = rupeesToPaise(amount);
  const participants = useMemo(() => {
    const out: { userId: string; value?: number }[] = [];
    for (const m of members) {
      const r = rows[m.id]; if (!r?.selected) continue;
      if (method === 'equal') out.push({ userId: m.id });
      else if (method === 'exact' || method === 'unequal') { const p = rupeesToPaise(r.value || '0'); out.push({ userId: m.id, value: p ?? NaN }); }
      else { const n = Number(r.value); out.push({ userId: m.id, value: r.value.trim() === '' ? NaN : n }); }
    }
    return out;
  }, [rows, members, method]);
  const validInputs = participants.length > 0 && participants.every((p) => method === 'equal' || Number.isFinite(p.value));
  const key = useDebounced(JSON.stringify({ totalPaise, method, participants }), 250);

  // Live preview comes from the SERVER engine - the browser never does the split maths.
  useEffect(() => {
    if (!open) return;
    if (!totalPaise || totalPaise <= 0 || !validInputs) { setPreview(null); setPreviewErr(null); return; }
    let live = true;
    post<{ splits: { userId: string; owedPaise: number }[] }>('/splits/calculate', { amountPaise: totalPaise, splitMethod: method, participants })
      .then((r) => { if (live) { setPreview(r.splits); setPreviewErr(null); } })
      .catch((e) => { if (live) { setPreview(null); setPreviewErr(errMsg(e)); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  const owed = (id: string) => preview?.find((p) => p.userId === id)?.owedPaise;
  const setRow = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const switchMethod = (m: SplitMethod) => { setMethod(m); setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, value: defaultValue(m) }]))); };

  async function runScan(file: File) {
    setScanning(true);
    try {
      const r = await upload<Ocr>('/ocr/scan', 'receipt', file); setScan(r); setReceipt(file);
      if (r.merchant && !desc) setDesc(r.merchant);
      if (r.totalPaise) setAmount(paiseToInput(r.totalPaise));
      if (r.date) setDate(r.date);
      toast.info('Receipt read. Please check the details before saving.');
    } catch (e) { toast.error(errMsg(e)); } finally { setScanning(false); if (scanRef.current) scanRef.current.value = ''; }
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!totalPaise || totalPaise <= 0) return setErr('Enter a valid amount, like 450 or 450.50');
    if (previewErr) return setErr(previewErr);
    if (!validInputs) return setErr('Select at least one person and fill in their values');
    setBusy(true);
    try {
      const body = { description: desc, category, amountPaise: totalPaise, paidBy, splitMethod: method, participants, expenseDate: new Date(`${date}T12:00:00Z`).toISOString(), notes: notes || undefined };
      let id = expense?.id;
      if (expense) await (await import('../../lib/api')).patch(`/expenses/${expense.id}`, { ...body, version: expense.version });
      else id = (await post<{ expense: Expense }>(`/groups/${groupId}/expenses`, body)).expense.id;
      if (receipt && id) await upload(`/expenses/${id}/receipt`, 'receipt', receipt).catch((x) => toast.error(`Expense saved, but the receipt failed: ${errMsg(x)}`));
      toast.success(expense ? 'Expense updated' : 'Expense added'); onSaved(); onClose();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }

  const m = METHODS.find((x) => x.id === method)!;
  const sumInputs = participants.reduce((a, p) => a + (Number.isFinite(p.value) ? (p.value as number) : 0), 0);
  const running = method === 'exact' ? `${formatINR(sumInputs)} of ${formatINR(totalPaise ?? 0)}` : method === 'percentage' ? `${sumInputs.toFixed(2).replace(/\.00$/, '')}% of 100%` : null;

  return (
    <Modal open={open} onClose={onClose} wide title={expense ? 'Edit expense' : 'Add an expense'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="expense-form" loading={busy}>{expense ? 'Save changes' : 'Add expense'}</Button></>}>
      <form id="expense-form" onSubmit={submit} className="space-y-5" noValidate>
        {err && <p role="alert" className="rounded-ctl bg-neg-soft px-3 py-2 text-sm text-neg">{err}</p>}

        <div className="flex items-center justify-between gap-3 rounded-ctl border border-dashed border-line bg-raised/60 px-3 py-2.5">
          <p className="text-sm text-muted">Have a paper bill? Scan it and we'll fill in the details. Your photo is read on this server only.</p>
          <input ref={scanRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => e.target.files?.[0] && runScan(e.target.files[0])} />
          <Button type="button" variant="secondary" size="sm" onClick={() => scanRef.current?.click()} disabled={scanning} icon={scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}>{scanning ? 'Reading...' : 'Scan receipt'}</Button>
        </div>
        {scan && (
          <details className="rounded-ctl bg-gold-soft px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold">Receipt read ({scan.confidence} confidence). Check the fields below.</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted">{scan.rawText || '(no text found)'}</pre>
          </details>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="What was it for?">{(id) => <Input id={id} required maxLength={200} placeholder="Dinner at Toit" value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field></div>
          <Field label="Amount (₹)">{(id) => <Input id={id} inputMode="decimal" required placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="num font-display text-lg font-bold" />}</Field>
          <Field label="Date">{(id) => <Input id={id} type="date" required max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Category">{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</Select>}</Field>
          <Field label="Paid by">{(id) => <Select id={id} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>{members.map((x) => <option key={x.id} value={x.id}>{x.id === meId ? 'You' : x.name}</option>)}</Select>}</Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">Split</p>
          <div role="tablist" className="grid grid-cols-5 gap-1 rounded-ctl bg-raised p-1">
            {METHODS.map((x) => <button key={x.id} type="button" role="tab" aria-selected={method === x.id} onClick={() => switchMethod(x.id)} className={cx('rounded-lg px-1 py-2 text-xs font-semibold transition sm:text-sm', method === x.id ? 'bg-surface text-brand shadow-sm' : 'text-muted hover:text-ink')}>{x.label}</button>)}
          </div>
          <p className="mt-2 text-xs text-muted">{m.hint}</p>
          <ul className="mt-3 divide-y divide-line rounded-ctl border border-line">
            {members.map((mem) => {
              const r = rows[mem.id] ?? { selected: false, value: '' };
              return (
                <li key={mem.id} className="flex items-center gap-3 px-3 py-2">
                  <input type="checkbox" aria-label={`Include ${mem.name}`} checked={r.selected} onChange={(e) => setRow(mem.id, { selected: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--brand))]" />
                  <Avatar name={mem.name} src={mem.avatarUrl} size={28} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{mem.id === meId ? 'You' : mem.name}</span>
                  {method !== 'equal' && r.selected && (
                    <div className="relative w-28"><Input aria-label={`${mem.name} ${m.label}`} inputMode="decimal" className="num h-9 pr-8 text-right" value={r.value} onChange={(e) => setRow(mem.id, { value: e.target.value })} /><span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">{m.unit}</span></div>
                  )}
                  <span className="num w-20 text-right text-sm font-bold">{r.selected && owed(mem.id) !== undefined ? formatINR(owed(mem.id)!) : <span className="text-muted">-</span>}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className={previewErr ? 'text-neg' : 'text-muted'} role={previewErr ? 'alert' : undefined}>{previewErr ?? (preview ? `Adds up to ${formatINR(preview.reduce((a, p) => a + p.owedPaise, 0))}` : 'Enter an amount to preview the split')}</span>
            {running && <span className="num text-muted">{running}</span>}
          </div>
        </div>

        <Field label="Notes (optional)">{(id) => <Textarea id={id} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <Field label="Receipt photo (optional)" hint={receipt ? `Attached: ${receipt.name}` : expense?.receiptUrl ? 'A receipt is already attached. Choosing a file replaces it.' : 'JPEG, PNG or WebP up to 5 MB'}>
          {(id) => <label htmlFor={id} className="flex h-10 cursor-pointer items-center gap-2 rounded-ctl border border-line bg-surface px-3 text-sm text-muted hover:bg-raised"><Camera className="h-4 w-4" />{receipt ? receipt.name : 'Choose image'}<input id={id} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} /></label>}
        </Field>
      </form>
    </Modal>
  );
}
const defaultValue = (m: SplitMethod) => (m === 'shares' ? '1' : m === 'unequal' ? '0' : '');
