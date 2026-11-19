import { KeyRound, Plane, Plus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errMsg, post } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { GROUP_TYPES, type Group } from '../lib/types';
import { toast } from '../store';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, Money, PageHeader, PageSkeleton, Select, Textarea } from '../ui';

const TYPE_LABEL: Record<string, string> = { friends: 'Friends', trips: 'Trip', flatmates: 'Flatmates', family: 'Family', office: 'Office', custom: 'Custom' };
const TYPE_TINT: Record<string, string> = { friends: '#0E5E6F', trips: '#E2711D', flatmates: '#6C5CE7', family: '#D6336C', office: '#3B82C4', custom: '#7A8B3A' };

export default function Groups() {
  const { data, loading, error, reload } = useFetch<{ items: Group[] }>('/groups');
  const [creating, setCreating] = useState(false); const [joining, setJoining] = useState(false);
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? ''} retry={reload} />;
  return (
    <div>
      <PageHeader title="Groups" sub="Every shared pot of money lives in a group." action={
        <div className="flex gap-2"><Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} onClick={() => setJoining(true)}>Join with code</Button><Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New group</Button></div>} />
      {data.items.length === 0 ? (
        <Card><EmptyState icon={<Plane />} title="Start your first group" body="A trip, a flat, a dinner crew. Add the people, log what everyone paid and SplitMate keeps the balance." action={<Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>Create a group</Button>} /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((g) => (
            <Link key={g.id} to={`/groups/${g.id}`} className="group block">
              <Card className="h-full overflow-hidden transition group-hover:-translate-y-0.5 group-hover:shadow-pop">
                <div className="h-1.5" style={{ background: TYPE_TINT[g.type] }} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2"><h3 className="text-lg font-bold leading-tight">{g.name}</h3><Badge>{TYPE_LABEL[g.type]}</Badge></div>
                  <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted">{g.description || 'No description'}</p>
                  <div className="mt-4 flex items-end justify-between">
                    <span className="flex items-center gap-1.5 text-sm text-muted"><Users className="h-4 w-4" />{g.memberCount}</span>
                    <div className="text-right"><p className="text-xs text-muted">{(g.myNetPaise ?? 0) > 0 ? 'you are owed' : (g.myNetPaise ?? 0) < 0 ? 'you owe' : 'settled up'}</p>{(g.myNetPaise ?? 0) !== 0 && <Money paise={Math.abs(g.myNetPaise ?? 0)} className={(g.myNetPaise ?? 0) > 0 ? 'text-pos' : 'text-neg'} />}</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <CreateGroup open={creating} onClose={() => setCreating(false)} />
      <JoinGroup open={joining} onClose={() => setJoining(false)} onDone={reload} />
    </div>
  );
}

function CreateGroup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', description: '', type: 'friends' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await post<{ group: Group }>('/groups', f); toast.success('Group created'); onClose(); nav(`/groups/${r.group.id}`); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New group" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="create-group" loading={busy}>Create group</Button></>}>
      <form id="create-group" onSubmit={submit} className="space-y-4">
        {err && <p role="alert" className="rounded-ctl bg-neg-soft px-3 py-2 text-sm text-neg">{err}</p>}
        <Field label="Group name">{(id) => <Input id={id} required minLength={2} maxLength={80} placeholder="Goa trip, Flat 4B..." value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Type">{(id) => <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{GROUP_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select>}</Field>
        <Field label="Description (optional)">{(id) => <Textarea id={id} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

function JoinGroup({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const nav = useNavigate(); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await post<{ groupId: string }>('/invitations/join', { code }); toast.success('You joined the group'); onClose(); onDone(); nav(`/groups/${r.groupId}`); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Join with a code" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="join-group" loading={busy}>Join group</Button></>}>
      <form id="join-group" onSubmit={submit} className="space-y-4">
        {err && <p role="alert" className="rounded-ctl bg-neg-soft px-3 py-2 text-sm text-neg">{err}</p>}
        <Field label="Invitation code" hint="Ask a group admin for the code on their group page.">{(id) => <Input id={id} required autoCapitalize="characters" className="font-display text-lg uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
