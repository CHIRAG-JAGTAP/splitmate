import { Activity, Flag, Shield, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { errMsg, patch } from '../lib/api';
import { formatINR, fmtDate, timeAgo } from '../lib/money';
import { useDebounced, useFetch } from '../lib/hooks';
import { toast } from '../store';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Input, PageHeader, PageSkeleton, Tabs } from '../ui';
import { axis } from '../ui/charts';

interface Stats { users: number; suspended: number; groups: number; expenses: number; completedSettlements: number; pendingSettlements: number; openReports: number; newUsersLast7Days: number; totalVolumePaise: number; signupsByDay: { date: string; count: number }[] }
interface AdminUser { id: string; name: string; email: string; role: string; status: string; suspendedReason: string | null; groups: number; lastLoginAt: string | null; createdAt: string }
type T = 'overview' | 'users' | 'groups' | 'reports' | 'activity';

export default function Admin() {
  const [tab, setTab] = useState<T>('overview');
  return (
    <div className="space-y-6">
      <PageHeader title="Admin console" sub="Platform health, accounts and abuse reports." action={<Badge tone="brand"><Shield className="mr-1 inline h-3.5 w-3.5" />Admin</Badge>} />
      <Tabs<T> value={tab} onChange={setTab} items={[{ id: 'overview', label: 'Overview' }, { id: 'users', label: 'Users' }, { id: 'groups', label: 'Groups' }, { id: 'reports', label: 'Reports' }, { id: 'activity', label: 'Activity' }]} />
      {tab === 'overview' && <Overview />}{tab === 'users' && <Users />}{tab === 'groups' && <Groups />}{tab === 'reports' && <Reports />}{tab === 'activity' && <ActivityLog />}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return <Card><div className="flex items-center gap-3 text-muted">{icon}<span className="text-sm">{label}</span></div><p className="mt-2 text-2xl font-bold tabular-nums">{value}</p></Card>;
}
function Overview() {
  const { data, error, reload } = useFetch<Stats>('/admin/stats');
  if (error) return <ErrorState message={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  return (<div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Users" value={data.users} icon={<UsersIcon className="h-5 w-5" />} /><Stat label="Groups" value={data.groups} icon={<UsersIcon className="h-5 w-5" />} />
      <Stat label="Expenses" value={data.expenses} icon={<Activity className="h-5 w-5" />} /><Stat label="Volume tracked" value={formatINR(data.totalVolumePaise, { compact: true })} icon={<Activity className="h-5 w-5" />} />
      <Stat label="New users (7 days)" value={data.newUsersLast7Days} icon={<UsersIcon className="h-5 w-5" />} /><Stat label="Suspended" value={data.suspended} icon={<Shield className="h-5 w-5" />} />
      <Stat label="Pending settlements" value={data.pendingSettlements} icon={<Activity className="h-5 w-5" />} /><Stat label="Open reports" value={data.openReports} icon={<Flag className="h-5 w-5" />} />
    </div>
    <Card><CardHeader title="Sign-ups" sub="Last 14 days" /><div className="h-56"><ResponsiveContainer><BarChart data={data.signupsByDay.map((d) => ({ ...d, label: d.date.slice(5) }))}><CartesianGrid vertical={false} stroke="rgb(var(--line))" /><XAxis dataKey="label" {...axis} /><YAxis {...axis} allowDecimals={false} width={32} /><Tooltip cursor={{ fill: 'rgb(var(--raised))' }} contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 12 }} /><Bar dataKey="count" name="Sign-ups" fill="rgb(var(--brand))" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
  </div>);
}

function Users() {
  const [q, setQ] = useState(''); const [page, setPage] = useState(1); const dq = useDebounced(q);
  const { data, error, reload } = useFetch<{ items: AdminUser[]; pages: number; total: number }>('/admin/users', { q: dq || undefined, page }, [dq, page]);
  const [target, setTarget] = useState<AdminUser | null>(null); const [busy, setBusy] = useState(false);
  const toggle = async () => { if (!target) return; setBusy(true); try { await patch(`/admin/users/${target.id}/${target.status === 'active' ? 'suspend' : 'reinstate'}`, target.status === 'active' ? { reason: 'Suspended by admin' } : {}); toast.success(target.status === 'active' ? 'Account suspended' : 'Account reinstated'); setTarget(null); reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  return (<Card>
    <div className="mb-4 flex items-center justify-between gap-3"><Input aria-label="Search users" className="max-w-xs" placeholder="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /><span className="text-sm text-muted">{data?.total ?? 0} users</span></div>
    {error ? <ErrorState message={error} retry={reload} /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4 font-medium">User</th><th className="pr-4 font-medium">Role</th><th className="pr-4 font-medium">Groups</th><th className="pr-4 font-medium">Last login</th><th className="pr-4 font-medium">Status</th><th /></tr></thead>
      <tbody className="divide-y divide-line">{data?.items.map((u) => <tr key={u.id}><td className="py-3 pr-4"><p className="font-medium">{u.name}</p><p className="text-xs text-muted">{u.email}</p></td><td className="pr-4 capitalize">{u.role}</td><td className="pr-4">{u.groups}</td><td className="pr-4 text-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</td><td className="pr-4"><Badge tone={u.status === 'active' ? 'pos' : 'neg'}>{u.status}</Badge></td>
        <td className="text-right">{u.role !== 'admin' && <Button size="sm" variant={u.status === 'active' ? 'danger' : 'secondary'} onClick={() => setTarget(u)}>{u.status === 'active' ? 'Suspend' : 'Reinstate'}</Button>}</td></tr>)}</tbody></table></div>}
    <div className="mt-4 flex items-center justify-end gap-2 text-sm"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-muted">Page {page} of {data?.pages ?? 1}</span><Button size="sm" variant="ghost" disabled={page >= (data?.pages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button></div>
    <ConfirmDialog open={!!target} title={target?.status === 'active' ? `Suspend ${target?.name}?` : `Reinstate ${target?.name}?`} body={target?.status === 'active' ? 'They will be signed out and unable to log in until reinstated. Their data is kept.' : 'They will be able to log in again.'} confirmLabel={target?.status === 'active' ? 'Suspend' : 'Reinstate'} danger={target?.status === 'active'} loading={busy} onConfirm={toggle} onClose={() => setTarget(null)} />
  </Card>);
}

function Groups() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useFetch<{ items: { id: string; name: string; type: string; owner: string; members: number; expenses: number; volumePaise: number; createdAt: string }[]; pages: number }>('/admin/groups', { page }, [page]);
  if (error) return <ErrorState message={error} retry={reload} />;
  return (<Card><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4 font-medium">Group</th><th className="pr-4 font-medium">Owner</th><th className="pr-4 text-right font-medium">Members</th><th className="pr-4 text-right font-medium">Expenses</th><th className="pr-4 text-right font-medium">Volume</th><th className="font-medium">Created</th></tr></thead>
    <tbody className="divide-y divide-line">{data?.items.map((g) => <tr key={g.id}><td className="py-3 pr-4 font-medium">{g.name} <Badge>{g.type}</Badge></td><td className="pr-4">{g.owner}</td><td className="pr-4 text-right tabular-nums">{g.members}</td><td className="pr-4 text-right tabular-nums">{g.expenses}</td><td className="pr-4 text-right tabular-nums">{formatINR(g.volumePaise)}</td><td className="text-muted">{fmtDate(g.createdAt)}</td></tr>)}</tbody></table></div>
    <div className="mt-4 flex items-center justify-end gap-2 text-sm"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-muted">Page {page} of {data?.pages ?? 1}</span><Button size="sm" variant="ghost" disabled={page >= (data?.pages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button></div></Card>);
}

function Reports() {
  const { data, error, reload } = useFetch<{ items: { id: string; reporter: string; targetType: string; targetId: string; reason: string; status: string; adminNote: string | null; createdAt: string }[] }>('/admin/reports');
  const act = async (id: string, status: 'reviewed' | 'dismissed') => { try { await patch(`/admin/reports/${id}`, { status }); reload(); } catch (e) { toast.error(errMsg(e)); } };
  if (error) return <ErrorState message={error} retry={reload} />;
  if (data && !data.items.length) return <EmptyState icon={<Flag className="h-6 w-6" />} title="No abuse reports" body="Reports submitted by users will appear here." />;
  return (<Card className="p-0"><ul className="divide-y divide-line">{data?.items.map((r) => (
    <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-4"><div className="min-w-0 flex-1"><p className="text-sm"><b>{r.reporter}</b> reported a <b>{r.targetType}</b> <code className="text-xs text-muted">{r.targetId}</code></p><p className="mt-1 text-sm text-muted">{r.reason}</p><p className="mt-1 text-xs text-muted">{timeAgo(r.createdAt)}</p></div>
      <Badge tone={r.status === 'open' ? 'gold' : r.status === 'reviewed' ? 'pos' : 'neutral'}>{r.status}</Badge>
      {r.status === 'open' && <div className="flex gap-2"><Button size="sm" onClick={() => act(r.id, 'reviewed')}>Mark reviewed</Button><Button size="sm" variant="ghost" onClick={() => act(r.id, 'dismissed')}>Dismiss</Button></div>}</li>))}</ul></Card>);
}

function ActivityLog() {
  const { data, error, reload } = useFetch<{ items: { id: string; action: string; entityType: string; actor: string; ip?: string; at: string }[] }>('/admin/activity');
  if (error) return <ErrorState message={error} retry={reload} />;
  return (<Card className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="px-4 py-3 font-medium">When</th><th className="pr-4 font-medium">Actor</th><th className="pr-4 font-medium">Action</th><th className="pr-4 font-medium">Entity</th><th className="pr-4 font-medium">IP</th></tr></thead>
    <tbody className="divide-y divide-line">{data?.items.map((a) => <tr key={a.id}><td className="whitespace-nowrap px-4 py-2.5 text-muted">{timeAgo(a.at)}</td><td className="pr-4">{a.actor}</td><td className="pr-4"><code className="text-xs">{a.action}</code></td><td className="pr-4 text-muted">{a.entityType}</td><td className="pr-4 text-muted">{a.ip}</td></tr>)}</tbody></table></div></Card>);
}
