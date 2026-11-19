import { ArrowRight, HandCoins, Lightbulb, Plus, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { fmtDate, formatINR, monthLabel, timeAgo } from '../lib/money';
import { useFetch } from '../lib/hooks';
import type { Category, Group, Insight, Settlement } from '../lib/types';
import { useAuth } from '../store';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Money, PageSkeleton, cx } from '../ui';
import { CAT_COLOR, CAT_LABEL, axis } from '../ui/charts';
import { CategoryIcon } from '../ui/category';

interface Dash {
  summary: { owePaise: number; owedPaise: number; netPaise: number };
  groups: Group[]; activeGroupCount: number;
  recentExpenses: { id: string; groupId: string; groupName: string; description: string; category: Category; amountPaise: number; paidBy: string; date: string }[];
  recentSettlements: Settlement[];
  activity: { id: string; actor: string; action: string; groupName?: string; at: string }[];
  monthly: { month: string; totalPaise: number }[]; categories: { category: Category; totalPaise: number }[]; thisMonthPaise: number;
}
const ACTION: Record<string, string> = { 'expense.create': 'added an expense', 'expense.update': 'edited an expense', 'expense.delete': 'deleted an expense', 'settlement.create': 'recorded a payment', 'settlement.confirm': 'confirmed a payment', 'settlement.reject': 'rejected a payment', 'group.create': 'created the group', 'group.member_add': 'added a member', 'group.member_leave': 'left the group' };

/** The "tape": one bar, split by how much you owe vs. are owed. It is the first thing you see. */
function BalanceTape({ owe, owed }: { owe: number; owed: number }) {
  const total = owe + owed;
  const owePct = total === 0 ? 50 : (owe / total) * 100;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-raised" role="img" aria-label={`You owe ${formatINR(owe)} and are owed ${formatINR(owed)}`}>
        {total > 0 && <>
          <div className="origin-left animate-tape bg-neg" style={{ width: `${owePct}%` }} />
          <div className="origin-right animate-tape bg-pos" style={{ width: `${100 - owePct}%` }} />
        </>}
      </div>
      <div className="mt-3 flex justify-between gap-4 text-sm">
        <div><p className="text-muted">You owe</p><Money paise={owe} size="lg" className="text-neg" /></div>
        <div className="text-right"><p className="text-muted">You are owed</p><Money paise={owed} size="lg" className="text-pos" /></div>
      </div>
    </div>
  );
}

const levelTone = { info: 'brand', good: 'pos', warning: 'gold' } as const;

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch<Dash>('/dashboard');
  const ins = useFetch<{ items: Insight[] }>('/analytics/insights');
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} retry={reload} />;
  const { summary: s } = data;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const catTotal = data.categories.reduce((a, c) => a + c.totalPaise, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold sm:text-3xl">{hello}, {user?.name.split(' ')[0]}</h1><p className="mt-1 text-sm text-muted">Here's where your shared money stands.</p></div>
        <Link to="/groups"><Button icon={<Plus className="h-4 w-4" />}>New expense</Button></Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <div><p className="text-sm font-semibold text-muted">Net balance</p><Money paise={s.netPaise} tone size="xl" /></div>
            <Badge tone={s.netPaise === 0 ? 'neutral' : s.netPaise > 0 ? 'pos' : 'neg'}>{s.netPaise === 0 ? 'All square' : s.netPaise > 0 ? 'You are ahead' : 'You owe overall'}</Badge>
          </div>
          <BalanceTape owe={s.owePaise} owed={s.owedPaise} />
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <Card className="p-5"><p className="text-sm font-semibold text-muted">Spent this month</p><Money paise={data.thisMonthPaise} size="lg" /><p className="mt-1 text-xs text-muted">Your share across all groups</p></Card>
          <Card className="p-5"><p className="text-sm font-semibold text-muted">Active groups</p><p className="num font-display text-2xl font-bold">{data.activeGroupCount}</p><Link to="/groups" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">Manage groups <ArrowRight className="h-3 w-3" /></Link></Card>
        </div>
      </div>

      {ins.data && ins.data.items.length > 0 && (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-gold" />Insights</span>} action={<Link to="/analytics" className="text-sm font-semibold text-brand hover:underline">See analytics</Link>} />
          <ul className="grid gap-px p-3 sm:grid-cols-2">
            {ins.data.items.slice(0, 4).map((i) => (
              <li key={i.id} className="flex gap-3 rounded-ctl p-3 hover:bg-raised">
                <Badge tone={levelTone[i.level]} className="h-fit shrink-0">{i.level === 'warning' ? 'Heads up' : i.level === 'good' ? 'Nice' : 'Note'}</Badge>
                <div className="min-w-0"><p className="text-sm font-semibold">{i.link ? <Link to={i.link} className="hover:underline">{i.title}</Link> : i.title}</p><p className="text-sm text-muted">{i.detail}</p></div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Monthly spending" sub="Your share, last 6 months" />
          <div className="h-60 px-2 pb-3 pt-2">
            {data.monthly.every((m) => m.totalPaise === 0) ? <EmptyState icon={<HandCoins />} title="No spending yet" body="Add an expense in a group and your monthly trend appears here." /> : (
              <ResponsiveContainer>
                <BarChart data={data.monthly} margin={{ left: 0, right: 12, top: 10 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
                  <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} />
                  <YAxis tickFormatter={(v) => formatINR(v, { compact: true })} width={56} {...axis} />
                  <Tooltip cursor={{ fill: 'rgb(var(--raised))' }} formatter={(v: number) => [formatINR(v), 'Spent']} labelFormatter={monthLabel} contentStyle={{ borderRadius: 10, border: '1px solid rgb(var(--line))', background: 'rgb(var(--surface))' }} />
                  <Bar dataKey="totalPaise" fill="rgb(var(--brand))" radius={[6, 6, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="This month by category" />
          {data.categories.length === 0 ? <EmptyState icon={<HandCoins />} title="Nothing this month" /> : (
            <div className="flex items-center gap-4 px-5 pb-5 pt-2">
              <div className="h-36 w-36 shrink-0"><ResponsiveContainer><PieChart><Pie data={data.categories} dataKey="totalPaise" nameKey="category" innerRadius={42} outerRadius={66} paddingAngle={2} stroke="none">{data.categories.map((c) => <Cell key={c.category} fill={CAT_COLOR[c.category]} />)}</Pie><Tooltip formatter={(v: number, n: Category) => [formatINR(v), CAT_LABEL[n]]} /></PieChart></ResponsiveContainer></div>
              <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
                {data.categories.slice(0, 5).map((c) => (
                  <li key={c.category} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 truncate"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLOR[c.category] }} />{CAT_LABEL[c.category]}</span><span className="num text-muted">{Math.round((c.totalPaise / catTotal) * 100)}%</span></li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent expenses" />
          {data.recentExpenses.length === 0 ? <EmptyState icon={<Users />} title="No expenses yet" body="Create a group, add your friends and log the first bill." action={<Link to="/groups"><Button>Go to groups</Button></Link>} /> : (
            <ul className="divide-y divide-line px-2 pb-2">
              {data.recentExpenses.map((e) => (
                <li key={e.id}><Link to={`/groups/${e.groupId}`} className="flex items-center gap-3 rounded-ctl px-3 py-3 hover:bg-raised">
                  <CategoryIcon category={e.category} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{e.description}</p><p className="truncate text-xs text-muted">{e.groupName} · paid by {e.paidBy} · {fmtDate(e.date)}</p></div><Money paise={e.amountPaise} />
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent settlements" action={<Link to="/settlements" className="text-sm font-semibold text-brand hover:underline">View all</Link>} />
          {data.recentSettlements.length === 0 ? <EmptyState icon={<HandCoins />} title="No settlements yet" body="When you pay someone back it will show up here." /> : (
            <ul className="divide-y divide-line px-2 pb-2">
              {data.recentSettlements.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-3 py-3"><Avatar name={x.fromUser?.name} src={x.fromUser?.avatarUrl} size={34} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm"><b>{x.fromUser?.name}</b> paid <b>{x.toUser?.name}</b></p><p className="text-xs text-muted">{x.groupName} · {timeAgo(x.createdAt)}</p></div>
                  <div className="text-right"><Money paise={x.amountPaise} className="block" /><Badge tone={x.status === 'completed' ? 'pos' : x.status === 'pending' ? 'gold' : 'neutral'}>{x.status}</Badge></div></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your groups" action={<Link to="/groups" className="text-sm font-semibold text-brand hover:underline">All groups</Link>} />
          {data.groups.length === 0 ? <EmptyState icon={<Users />} title="No groups yet" action={<Link to="/groups"><Button>Create a group</Button></Link>} /> : (
            <ul className="divide-y divide-line px-2 pb-2">
              {data.groups.map((g) => (
                <li key={g.id}><Link to={`/groups/${g.id}`} className="flex items-center justify-between gap-3 rounded-ctl px-3 py-3 hover:bg-raised"><div className="min-w-0"><p className="truncate font-semibold">{g.name}</p><p className="text-xs capitalize text-muted">{g.type} · {g.memberCount} members</p></div>
                  <span className={cx('num text-sm font-bold', (g.myNetPaise ?? 0) > 0 ? 'text-pos' : (g.myNetPaise ?? 0) < 0 ? 'text-neg' : 'text-muted')}>{(g.myNetPaise ?? 0) === 0 ? 'settled' : formatINR(g.myNetPaise ?? 0, { sign: true })}</span></Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Group activity" />
          {data.activity.length === 0 ? <EmptyState icon={<Users />} title="Quiet so far" /> : (
            <ul className="space-y-3 p-5 pt-3">
              {data.activity.map((a) => <li key={a.id} className="flex gap-3 text-sm"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" /><p><b>{a.actor}</b> {ACTION[a.action] ?? a.action.replace('.', ' ')}{a.groupName && <> in <span className="font-semibold">{a.groupName}</span></>} <span className="text-muted">· {timeAgo(a.at)}</span></p></li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
