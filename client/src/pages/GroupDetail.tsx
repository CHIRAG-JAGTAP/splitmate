import { ArrowRight, Bell, Copy, Gauge, HandCoins, Pencil, Plus, Receipt, Search, Settings, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, errMsg, patch, post } from '../lib/api';
import { useDebounced, useFetch } from '../lib/hooks';
import { fmtDate, formatINR, timeAgo } from '../lib/money';
import { CATEGORIES, GROUP_TYPES, type Balances, type Expense, type Group, type Member, type Settlement } from '../lib/types';
import { toast, useAuth } from '../store';
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, Money, PageHeader, PageSkeleton, Select, Tabs, Textarea, cx } from '../ui';
import { CAT_LABEL } from '../ui/charts';
import { CategoryIcon } from '../ui/category';
import ExpenseForm from './group/ExpenseForm';
import SettleModal from './group/SettleModal';

type Tab = 'expenses' | 'balances' | 'settlements' | 'members' | 'activity';
interface ExpPage { items: Expense[]; total: number; page: number; pages: number }

export default function GroupDetail() {
  const { id = '' } = useParams(); const nav = useNavigate(); const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('expenses');
  const g = useFetch<{ group: Group }>(`/groups/${id}`);
  const mem = useFetch<{ items: Member[] }>(`/groups/${id}/members`);
  const bal = useFetch<Balances>(`/groups/${id}/balances`);
  const [editing, setEditing] = useState<Expense | null>(null); const [formOpen, setFormOpen] = useState(false);
  const [settle, setSettle] = useState<{ payeeId?: string; amount?: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false); const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null);
  const [expVersion, setExpVersion] = useState(0);
  const pendingSet = useFetch<{ items: Settlement[] }>(`/groups/${id}/settlements`, undefined, [expVersion]);
  const reloadAll = () => { bal.reload(); setExpVersion((v) => v + 1); pendingSet.reload(); };

  if ((g.loading && !g.data) || (mem.loading && !mem.data)) return <PageSkeleton />;
  if (g.error || !g.data) return <ErrorState message={g.error ?? 'Group not found'} retry={g.reload} />;
  const group = g.data.group; const members = mem.data?.items ?? []; const me = user!.id;
  const isAdmin = group.myRole === 'owner' || group.myRole === 'admin';
  const myNet = bal.data?.balances.find((b) => b.userId === me)?.netPaise ?? 0;
  const pendingCount = (pendingSet.data?.items ?? []).filter((s) => s.status === 'pending' && s.toUser.id === me).length;
  const youOwe = (bal.data?.pairwise ?? []).filter((t) => t.from === me);

  return (
    <div>
      <PageHeader title={group.name} sub={<span className="flex flex-wrap items-center gap-2"><Badge tone="brand" className="capitalize">{group.type}</Badge><span>{members.length} members</span>{group.description && <span className="text-muted">· {group.description}</span>}</span>}
        action={<div className="flex gap-2">
          {isAdmin && <Button variant="secondary" icon={<Settings className="h-4 w-4" />} onClick={() => setSettingsOpen(true)} aria-label="Group settings">Settings</Button>}
          <Button variant="secondary" icon={<HandCoins className="h-4 w-4" />} onClick={() => setSettle({})}>Settle up</Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add expense</Button></div>} />

      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div><p className="text-sm font-semibold text-muted">Your position in this group</p>
          {bal.data ? <div className="flex items-baseline gap-2"><Money paise={Math.abs(myNet)} size="xl" className={myNet > 0 ? 'text-pos' : myNet < 0 ? 'text-neg' : ''} /><span className="text-sm text-muted">{myNet > 0 ? 'you are owed' : myNet < 0 ? 'you owe' : 'all settled up'}</span></div> : <div className="skeleton h-10 w-40" />}</div>
        {youOwe.length > 0 && <div className="flex flex-wrap gap-2">{youOwe.map((t) => <Button key={t.to} variant="gold" size="sm" onClick={() => setSettle({ payeeId: t.to, amount: t.amountPaise })}>Pay {t.toUser?.name.split(' ')[0]} {formatINR(t.amountPaise)}</Button>)}</div>}
      </Card>

      <Tabs value={tab} onChange={setTab} items={[{ id: 'expenses', label: 'Expenses' }, { id: 'balances', label: 'Balances' }, { id: 'settlements', label: 'Payments', badge: pendingCount }, { id: 'members', label: 'Members' }, { id: 'activity', label: 'Activity' }]} />
      <div className="pt-5">
        {tab === 'expenses' && <ExpensesTab groupId={id} members={members} version={expVersion} onAdd={() => { setEditing(null); setFormOpen(true); }} onEdit={(e) => { setEditing(e); setFormOpen(true); }} onChanged={reloadAll} meId={me} isAdmin={isAdmin} />}
        {tab === 'balances' && <BalancesTab data={bal.data} loading={bal.loading} meId={me} groupId={id} onSettle={(payeeId, amount) => setSettle({ payeeId, amount })} />}
        {tab === 'settlements' && <PaymentsTab items={pendingSet.data?.items ?? []} meId={me} onChanged={reloadAll} />}
        {tab === 'members' && <MembersTab group={group} members={members} meId={me} isAdmin={isAdmin} isOwner={group.myRole === 'owner'} onChanged={() => { mem.reload(); g.reload(); bal.reload(); }} />}
        {tab === 'activity' && <ActivityTab groupId={id} version={expVersion} />}
      </div>

      <ExpenseForm open={formOpen} onClose={() => setFormOpen(false)} groupId={id} members={members} meId={me} expense={editing} onSaved={reloadAll} />
      <SettleModal open={!!settle} onClose={() => setSettle(null)} groupId={id} members={members} meId={me} payeeId={settle?.payeeId} suggestedPaise={settle?.amount} onDone={reloadAll} />
      <GroupSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} group={group} isOwner={group.myRole === 'owner'} onSaved={g.reload} onDelete={() => { setSettingsOpen(false); setConfirm('delete'); }} />
      <ConfirmDialog open={confirm === 'delete'} danger title="Delete this group?" confirmLabel="Delete group" body="This permanently removes the group and all of its expenses. It only works when every balance is settled." onClose={() => setConfirm(null)}
        onConfirm={async () => { try { await del(`/groups/${id}`); toast.success('Group deleted'); nav('/groups'); } catch (e) { toast.error(errMsg(e)); setConfirm(null); } }} />
      <ConfirmDialog open={confirm === 'leave'} danger title="Leave this group?" confirmLabel="Leave group" body="You can only leave when your balance is settled." onClose={() => setConfirm(null)}
        onConfirm={async () => { try { await post(`/groups/${id}/leave`); toast.success('You left the group'); nav('/groups'); } catch (e) { toast.error(errMsg(e)); setConfirm(null); } }} />
      {group.myRole !== 'owner' && <div className="mt-8 text-center"><button onClick={() => setConfirm('leave')} className="text-sm text-muted underline hover:text-neg">Leave this group</button></div>}
    </div>
  );
}

/* ---------------- Expenses ---------------- */
function ExpensesTab({ groupId, members, version, onAdd, onEdit, onChanged, meId, isAdmin }: { groupId: string; members: Member[]; version: number; onAdd: () => void; onEdit: (e: Expense) => void; onChanged: () => void; meId: string; isAdmin: boolean }) {
  const [q, setQ] = useState(''); const [category, setCategory] = useState(''); const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useFetch<ExpPage>(`/groups/${groupId}/expenses`, { q: dq || undefined, category: category || undefined, page, limit: 15 }, [version]);
  const [open, setOpen] = useState<string | null>(null); const [toDelete, setToDelete] = useState<Expense | null>(null);
  const filtering = Boolean(dq || category);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input aria-label="Search expenses" placeholder="Search expenses" className="pl-9" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <Select aria-label="Filter by category" className="w-44" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</Select>
      </div>
      {error ? <ErrorState message={error} retry={reload} /> : loading && !data ? <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}</div> : !data || data.items.length === 0 ? (
        <Card><EmptyState icon={<Receipt />} title={filtering ? 'No matching expenses' : 'No expenses yet'} body={filtering ? 'Try a different search or category.' : 'Log the first bill and SplitMate works out who owes whom.'} action={!filtering && <Button onClick={onAdd} icon={<Plus className="h-4 w-4" />}>Add expense</Button>} /></Card>
      ) : (
        <Card><ul className="divide-y divide-line">
          {data.items.map((e) => {
            const mine = e.splits.find((s) => s.user.id === meId); const canEdit = isAdmin || e.createdBy === meId || e.paidBy.id === meId;
            return (
              <li key={e.id}>
                <button onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-raised/60">
                  <CategoryIcon category={e.category} />
                  <div className="min-w-0 flex-1"><p className="truncate font-semibold">{e.description}</p><p className="truncate text-xs text-muted">{fmtDate(e.expenseDate)} · {e.paidBy.id === meId ? 'You' : e.paidBy.name} paid</p></div>
                  <div className="text-right"><Money paise={e.amountPaise} />
                    <p className={cx('text-xs font-semibold', e.paidBy.id === meId ? 'text-pos' : mine ? 'text-neg' : 'text-muted')}>{e.paidBy.id === meId ? `you lent ${formatINR(e.amountPaise - (mine?.owedPaise ?? 0))}` : mine ? `you owe ${formatINR(mine.owedPaise)}` : 'not involved'}</p></div>
                </button>
                {open === e.id && (
                  <div className="space-y-3 bg-raised/50 px-4 py-4 text-sm">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted"><span>Split: <b className="capitalize text-ink">{e.splitMethod}</b></span><span>Category: <b className="text-ink">{CAT_LABEL[e.category]}</b></span></div>
                    <ul className="grid gap-1.5 sm:grid-cols-2">{e.splits.map((s) => <li key={s.user.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2"><span className="flex items-center gap-2"><Avatar name={s.user.name} src={s.user.avatarUrl} size={24} />{s.user.id === meId ? 'You' : s.user.name}</span><span className="num font-bold">{formatINR(s.owedPaise)}</span></li>)}</ul>
                    {e.notes && <p className="text-muted">Note: {e.notes}</p>}
                    {e.receiptUrl && <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"><Receipt className="h-4 w-4" />View receipt</a>}
                    {canEdit && <div className="flex gap-2 pt-1"><Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(e)}>Edit</Button><Button size="sm" variant="ghost" className="text-neg" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setToDelete(e)}>Delete</Button></div>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {data.pages > 1 && <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm"><span className="text-muted">Page {data.page} of {data.pages} · {data.total} expenses</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>}</Card>
      )}
      <ConfirmDialog open={!!toDelete} danger title="Delete this expense?" confirmLabel="Delete expense" body={`"${toDelete?.description}" will be removed and everyone's balance recalculated.`} onClose={() => setToDelete(null)}
        onConfirm={async () => { try { await del(`/expenses/${toDelete!.id}`); toast.success('Expense deleted'); setToDelete(null); onChanged(); reload(); } catch (e) { toast.error(errMsg(e)); } }} />
      <span hidden>{members.length}</span>
    </div>
  );
}

/* ---------------- Balances ---------------- */
function BalancesTab({ data, loading, meId, groupId, onSettle }: { data: Balances | null; loading: boolean; meId: string; groupId: string; onSettle: (payee: string, amt: number) => void }) {
  const [mode, setMode] = useState<'simplified' | 'pairwise'>('simplified');
  if (loading && !data) return <div className="skeleton h-64" />;
  if (!data) return null;
  const list = mode === 'simplified' ? data.simplified : data.pairwise;
  const max = Math.max(1, ...data.balances.map((b) => Math.abs(b.netPaise)));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Who is ahead, who is behind" sub="Net position after all expenses and confirmed payments" />
        <ul className="space-y-3 p-5 pt-3">
          {data.balances.map((b) => (
            <li key={b.userId}>
              <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><Avatar name={b.user?.name} src={b.user?.avatarUrl} size={26} />{b.userId === meId ? 'You' : b.user?.name}</span><Money paise={b.netPaise} tone /></div>
              <div className="mt-1.5 h-1.5 rounded-full bg-raised"><div className={cx('h-full rounded-full', b.netPaise >= 0 ? 'bg-pos' : 'bg-neg')} style={{ width: `${(Math.abs(b.netPaise) / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="How to settle" action={<div role="tablist" className="flex rounded-lg bg-raised p-0.5 text-xs font-semibold">{(['simplified', 'pairwise'] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx('rounded-md px-2.5 py-1', mode === m ? 'bg-surface text-brand shadow-sm' : 'text-muted')}>{m === 'simplified' ? 'Simplified' : 'Original'}</button>)}</div>} />
        {mode === 'simplified' && data.savedTransfers > 0 && <p className="mx-5 mt-2 flex items-center gap-2 rounded-ctl bg-pos-soft px-3 py-2 text-sm text-pos"><Sparkles className="h-4 w-4" />Debt simplification turns {data.pairwise.length} payments into {data.simplified.length}.</p>}
        {list.length === 0 ? <EmptyState icon={<Gauge />} title="Everyone is settled up" /> : (
          <ul className="divide-y divide-line px-2 pb-2 pt-1">
            {list.map((t, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-3">
                <Avatar name={t.fromUser?.name} src={t.fromUser?.avatarUrl} size={30} /><ArrowRight className="h-4 w-4 shrink-0 text-muted" /><Avatar name={t.toUser?.name} src={t.toUser?.avatarUrl} size={30} />
                <p className="min-w-0 flex-1 truncate text-sm"><b>{t.from === meId ? 'You' : t.fromUser?.name}</b> pay{t.from === meId ? '' : 's'} <b>{t.to === meId ? 'you' : t.toUser?.name}</b></p>
                <Money paise={t.amountPaise} />
                {t.from === meId ? <Button size="sm" variant="gold" onClick={() => onSettle(t.to, t.amountPaise)}>Pay</Button> : t.to === meId ? <Button size="sm" variant="ghost" icon={<Bell className="h-3.5 w-3.5" />} aria-label={`Remind ${t.fromUser?.name}`} onClick={async () => { try { await post(`/groups/${groupId}/remind`, { userId: t.from }); toast.success('Reminder sent'); } catch (e) { toast.error(errMsg(e)); } }}>Remind</Button> : null}
              </li>
            ))}
          </ul>
        )}
        {mode === 'simplified' && list.length > 0 && <p className="px-5 pb-4 text-xs text-muted">The simplified plan keeps everyone's net balance the same. Part payments are always allowed against the original debts.</p>}
      </Card>
    </div>
  );
}

/* ---------------- Payments ---------------- */
export function SettlementRow({ s, meId, onChanged, showGroup }: { s: Settlement; meId: string; onChanged: () => void; showGroup?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (a: 'confirm' | 'reject' | 'cancel') => { setBusy(a); try { await post(`/settlements/${s.id}/${a}`, a === 'reject' ? { reason: 'Not received' } : {}); toast.success({ confirm: 'Payment confirmed', reject: 'Payment rejected', cancel: 'Payment cancelled' }[a]); onChanged(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); } };
  const tone = { completed: 'pos', pending: 'gold', rejected: 'neg', cancelled: 'neutral' } as const;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3.5">
      <Avatar name={s.fromUser?.name} src={s.fromUser?.avatarUrl} size={34} />
      <div className="min-w-0 flex-1"><p className="text-sm"><b>{s.fromUser?.id === meId ? 'You' : s.fromUser?.name}</b> paid <b>{s.toUser?.id === meId ? 'you' : s.toUser?.name}</b> by {s.method === 'cash' ? 'cash' : 'UPI'}</p>
        <p className="text-xs text-muted">{showGroup && <>{s.groupName} · </>}{timeAgo(s.createdAt)}{s.upiRef && <> · ref {s.upiRef}</>}{s.note && <> · {s.note}</>}{s.rejectReason && <> · {s.rejectReason}</>}</p></div>
      <div className="flex items-center gap-3"><Money paise={s.amountPaise} /><Badge tone={tone[s.status]}>{s.status}</Badge></div>
      <div className="flex gap-2">
        {s.status === 'pending' && s.toUser.id === meId && <><Button size="sm" loading={busy === 'confirm'} onClick={() => act('confirm')}>Confirm received</Button><Button size="sm" variant="secondary" loading={busy === 'reject'} onClick={() => act('reject')}>Reject</Button></>}
        {s.status === 'pending' && s.requestedBy === meId && <Button size="sm" variant="ghost" loading={busy === 'cancel'} onClick={() => act('cancel')}>Cancel</Button>}
        {s.status === 'completed' && <a className="inline-flex h-8 items-center rounded-ctl px-3 text-sm font-semibold text-brand hover:bg-raised" href={`/api/v1/settlements/${s.id}/receipt`} target="_blank" rel="noreferrer">Receipt</a>}
      </div>
    </li>
  );
}
function PaymentsTab({ items, meId, onChanged }: { items: Settlement[]; meId: string; onChanged: () => void }) {
  if (!items.length) return <Card><EmptyState icon={<HandCoins />} title="No payments yet" body="When someone pays someone back, it is recorded here and confirmed by the person who received it." /></Card>;
  return <Card><ul className="divide-y divide-line">{items.map((s) => <SettlementRow key={s.id} s={s} meId={meId} onChanged={onChanged} />)}</ul></Card>;
}

/* ---------------- Members ---------------- */
function MembersTab({ group, members, meId, isAdmin, isOwner, onChanged }: { group: Group; members: Member[]; meId: string; isAdmin: boolean; isOwner: boolean; onChanged: () => void }) {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [invite, setInvite] = useState<{ code: string } | null>(null);
  const [rm, setRm] = useState<Member | null>(null);
  async function add(e: FormEvent) { e.preventDefault(); setBusy(true); try { await post(`/groups/${group.id}/members`, { email }); toast.success('Member added'); setEmail(''); onChanged(); } catch (x) { toast.error(errMsg(x)); } finally { setBusy(false); } }
  async function makeInvite() { try { const r = await post<{ invitation: { code: string } }>(`/groups/${group.id}/invitations`, {}); setInvite(r.invitation); } catch (x) { toast.error(errMsg(x)); } }
  const copy = (t: string) => { void navigator.clipboard?.writeText(t); toast.success('Copied'); };
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3"><Avatar name={m.name} src={m.avatarUrl} size={38} />
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{m.name}{m.id === meId && <span className="text-muted"> (you)</span>}</p><p className="truncate text-xs text-muted">{m.email}</p></div>
              {isOwner && m.role !== 'owner' ? <Select aria-label={`Role of ${m.name}`} className="h-8 w-28 text-xs" value={m.role} onChange={async (e) => { try { await patch(`/groups/${group.id}/members/${m.id}`, { role: e.target.value }); toast.success('Role updated'); onChanged(); } catch (x) { toast.error(errMsg(x)); } }}><option value="member">Member</option><option value="admin">Admin</option></Select> : <Badge tone={m.role === 'owner' ? 'gold' : m.role === 'admin' ? 'brand' : 'neutral'} className="capitalize">{m.role}</Badge>}
              {isAdmin && m.role !== 'owner' && m.id !== meId && (m.role === 'member' || isOwner) && <button aria-label={`Remove ${m.name}`} onClick={() => setRm(m)} className="rounded-lg p-2 text-muted hover:bg-neg-soft hover:text-neg"><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      </Card>
      {isAdmin && (
        <div className="space-y-4">
          <Card className="p-5"><h3 className="mb-3 flex items-center gap-2 font-bold"><UserPlus className="h-4 w-4" />Add someone</h3>
            <form onSubmit={add} className="space-y-3"><Field label="Their SplitMate email">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field><Button type="submit" loading={busy} className="w-full">Add to group</Button></form></Card>
          <Card className="p-5"><h3 className="mb-1 font-bold">Join code</h3><p className="mb-3 text-sm text-muted">Anyone with this code can join. Share it in your group chat.</p>
            <div className="flex items-center justify-between rounded-ctl bg-raised px-3 py-2.5"><code className="font-display text-xl font-bold tracking-widest">{group.inviteCode}</code><button aria-label="Copy code" onClick={() => copy(group.inviteCode!)} className="rounded-lg p-1.5 text-muted hover:text-ink"><Copy className="h-4 w-4" /></button></div>
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={makeInvite}>Create one-time invitation code</Button>
            {invite && <div className="mt-3 rounded-ctl bg-gold-soft p-3 text-sm"><p className="font-semibold">Shown only once. Valid for 7 days.</p><div className="mt-1 flex items-center justify-between"><code className="font-display text-lg font-bold tracking-widest">{invite.code}</code><button aria-label="Copy invitation" onClick={() => copy(invite.code)}><Copy className="h-4 w-4" /></button></div></div>}</Card>
        </div>
      )}
      <ConfirmDialog open={!!rm} danger title={`Remove ${rm?.name}?`} confirmLabel="Remove" body="They keep their past expenses in the history but can no longer see or add to this group. Their balance must be settled first." onClose={() => setRm(null)}
        onConfirm={async () => { try { await del(`/groups/${group.id}/members/${rm!.id}`); toast.success('Member removed'); setRm(null); onChanged(); } catch (x) { toast.error(errMsg(x)); setRm(null); } }} />
    </div>
  );
}

/* ---------------- Activity ---------------- */
function ActivityTab({ groupId, version }: { groupId: string; version: number }) {
  const { data, loading } = useFetch<{ items: { id: string; actor: { name: string } | null; detail: string; at: string }[] }>(`/groups/${groupId}/activity`, undefined, [version]);
  if (loading && !data) return <div className="skeleton h-48" />;
  if (!data?.items.length) return <Card><EmptyState icon={<Gauge />} title="No activity yet" /></Card>;
  return <Card><ol className="relative space-y-4 p-5 before:absolute before:bottom-6 before:left-[26px] before:top-6 before:w-px before:bg-line">{data.items.map((a) => <li key={a.id} className="relative flex gap-4"><span className="z-10 mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-brand bg-surface" /><p className="text-sm"><b>{a.actor?.name ?? 'Someone'}</b> {a.detail} <span className="text-muted">· {timeAgo(a.at)}</span></p></li>)}</ol></Card>;
}

/* ---------------- Settings ---------------- */
function GroupSettings({ open, onClose, group, isOwner, onSaved, onDelete }: { open: boolean; onClose: () => void; group: Group; isOwner: boolean; onSaved: () => void; onDelete: () => void }) {
  const [f, setF] = useState({ name: group.name, description: group.description, type: group.type, simplifyDebts: group.simplifyDebts }); const [busy, setBusy] = useState(false);
  useMemo(() => setF({ name: group.name, description: group.description, type: group.type, simplifyDebts: group.simplifyDebts }), [group, open]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); try { await patch(`/groups/${group.id}`, f); toast.success('Group updated'); onSaved(); onClose(); } catch (x) { toast.error(errMsg(x)); } finally { setBusy(false); } }
  return (
    <Modal open={open} onClose={onClose} title="Group settings" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="group-settings" loading={busy}>Save changes</Button></>}>
      <form id="group-settings" onSubmit={save} className="space-y-4">
        <Field label="Name">{(id) => <Input id={id} required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Type">{(id) => <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Group['type'] })}>{GROUP_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}</Select>}</Field>
        <Field label="Description">{(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={f.simplifyDebts} onChange={(e) => setF({ ...f, simplifyDebts: e.target.checked })} />Show simplified settle-up plan by default</label>
        {isOwner && <div className="border-t border-line pt-4"><p className="mb-2 text-sm text-muted">Deleting removes every expense in this group.</p><Button type="button" variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete}>Delete group</Button></div>}
      </form>
    </Modal>
  );
}
