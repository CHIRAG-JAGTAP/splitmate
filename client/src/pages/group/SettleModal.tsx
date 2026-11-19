import { Copy, ExternalLink } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { errMsg, get, post } from '../../lib/api';
import { formatINR, paiseToInput, rupeesToPaise } from '../../lib/money';
import type { Member } from '../../lib/types';
import { toast } from '../../store';
import { Button, Field, Input, Modal, Select, Textarea, cx } from '../../ui';

interface Instr { payee: { id: string; name: string }; upiId: string | null; upiLink: string | null; instructions: string }
export default function SettleModal({ open, onClose, groupId, members, meId, payeeId, suggestedPaise, onDone }: { open: boolean; onClose: () => void; groupId: string; members: Member[]; meId: string; payeeId?: string; suggestedPaise?: number; onDone: () => void }) {
  const [to, setTo] = useState(payeeId ?? ''); const [amount, setAmount] = useState(''); const [method, setMethod] = useState<'cash' | 'upi_manual'>('cash');
  const [ref, setRef] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(''); const [instr, setInstr] = useState<Instr | null>(null);

  useEffect(() => {
    if (!open) return;
    setTo(payeeId ?? members.find((m) => m.id !== meId)?.id ?? ''); setAmount(suggestedPaise ? paiseToInput(suggestedPaise) : ''); setMethod('cash'); setRef(''); setNote(''); setErr(null);
    setKey(crypto.randomUUID()); // one key per dialog => double-clicks can never create two payments
  }, [open, payeeId, suggestedPaise, members, meId]);

  const paise = rupeesToPaise(amount);
  useEffect(() => {
    if (!open || !to || method !== 'upi_manual') { setInstr(null); return; }
    get<Instr>(`/users/${to}/payment-instructions`, { groupId, ...(paise && paise > 0 ? { amountPaise: paise } : {}) }).then(setInstr).catch(() => setInstr(null));
  }, [open, to, method, groupId, paise]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!paise || paise <= 0) return setErr('Enter a valid amount');
    setBusy(true);
    try { await post(`/groups/${groupId}/settlements`, { toUser: to, amountPaise: paise, method, upiRef: method === 'upi_manual' && ref ? ref : undefined, note: note || undefined, idempotencyKey: key }); toast.success('Payment recorded. Waiting for them to confirm.'); onDone(); onClose(); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Record a payment" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="settle-form" loading={busy}>Record payment</Button></>}>
      <form id="settle-form" onSubmit={submit} className="space-y-4" noValidate>
        <p className="rounded-ctl bg-brand-soft px-3 py-2 text-sm text-brand">SplitMate doesn't move money. Pay them yourself, then record it here. The balance changes once they confirm.</p>
        {err && <p role="alert" className="rounded-ctl bg-neg-soft px-3 py-2 text-sm text-neg">{err}</p>}
        <Field label="You paid">{(id) => <Select id={id} value={to} onChange={(e) => setTo(e.target.value)}>{members.filter((m) => m.id !== meId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        <Field label="Amount (₹)" hint={suggestedPaise ? `You owe ${formatINR(suggestedPaise)}. Part payments are fine.` : undefined}>{(id) => <Input id={id} inputMode="decimal" className="num font-display text-lg font-bold" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-2">
          {([['cash', 'Cash'], ['upi_manual', 'UPI (I paid in my app)']] as const).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={method === v} onClick={() => setMethod(v)} className={cx('rounded-ctl border px-3 py-2.5 text-sm font-semibold transition', method === v ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:bg-raised')}>{l}</button>
          ))}
        </div>
        {method === 'upi_manual' && (
          <div className="space-y-3">
            {instr && (
              <div className="rounded-ctl border border-line bg-raised/60 p-3 text-sm">
                <p>{instr.instructions}</p>
                {instr.upiId && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="rounded bg-surface px-2 py-1 font-semibold">{instr.upiId}</code>
                    <Button type="button" size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => { void navigator.clipboard?.writeText(instr.upiId!); toast.success('UPI ID copied'); }}>Copy</Button>
                    {instr.upiLink && <a href={instr.upiLink} className="inline-flex h-8 items-center gap-1.5 rounded-ctl bg-brand px-3 text-sm font-semibold text-brand-ink"><ExternalLink className="h-3.5 w-3.5" />Open UPI app</a>}
                  </div>
                )}
              </div>
            )}
            <Field label="UPI reference (optional)">{(id) => <Input id={id} maxLength={60} placeholder="Transaction ID from your UPI app" value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
          </div>
        )}
        <Field label="Note (optional)">{(id) => <Textarea id={id} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[60px]" />}</Field>
      </form>
    </Modal>
  );
}
