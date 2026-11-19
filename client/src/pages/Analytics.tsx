import { BarChart3, Download, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errMsg } from '../lib/api';
import { formatINR, monthLabel } from '../lib/money';
import { useFetch } from '../lib/hooks';
import type { Category, Insight } from '../lib/types';
import { toast } from '../store';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageSkeleton, Select, cx } from '../ui';
import { CAT_COLOR, CAT_LABEL, axis } from '../ui/charts';

const rupee = (p: number) => formatINR(p, { compact: true });
const tip = { contentStyle: { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 12, fontSize: 13 }, labelStyle: { color: 'rgb(var(--ink))', fontWeight: 600 } };
const grid = <CartesianGrid vertical={false} stroke="rgb(var(--line))" />;

interface Compare { month: string; previousMonth: string; categories: { category: Category; currentPaise: number; previousPaise: number; changePct: number | null }[]; currentTotalPaise: number; previousTotalPaise: number }

export default function Analytics() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const monthly = useFetch<{ items: { month: string; totalPaise: number }[] }>('/analytics/monthly');
  const weekly = useFetch<{ items: { weekStart: string; totalPaise: number }[] }>('/analytics/weekly');
  const cats = useFetch<{ items: { category: Category; totalPaise: number }[] }>('/analytics/categories', { month }, [month]);
  const groups = useFetch<{ items: { groupId: string; name: string; totalPaise: number }[] }>('/analytics/groups', { month }, [month]);
  const contrib = useFetch<{ items: { user?: { name: string; avatarUrl: string | null }; paidPaise: number; count: number }[] }>('/analytics/contributions');
  const trends = useFetch<{ items: { date: string; totalPaise: number; cumulativePaise: number }[] }>('/analytics/trends');
  const cmp = useFetch<Compare>('/analytics/compare', { month }, [month]);
  const top = useFetch<{ items: { category: Category; totalPaise: number }[] }>('/analytics/top-categories');
  const insights = useFetch<{ items: Insight[] }>('/analytics/insights');
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await api.get('/analytics/export.csv', { responseType: 'blob' });
      const url = URL.createObjectURL(r.data as Blob); const a = document.createElement('a'); a.href = url; a.download = 'splitmate-report.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(errMsg(e)); } finally { setExporting(false); }
  };

  const anyError = monthly.error || cats.error;
  if (monthly.loading && !monthly.data) return <PageSkeleton />;
  if (anyError) return <ErrorState message={anyError} retry={() => { monthly.reload(); cats.reload(); }} />;
  const totalMonth = cats.data?.items.reduce((a, c) => a + c.totalPaise, 0) ?? 0;
  const noData = !monthly.data?.items.some((m) => m.totalPaise > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" sub="Your share of spending, calculated from your recorded expenses."
        action={<div className="flex gap-2"><input type="month" aria-label="Month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm" /><Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={exportCsv}>Export CSV</Button></div>} />
      {noData ? <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No spending to analyse yet" body="Add an expense in one of your groups and charts will appear here." /> : <>
        {!!insights.data?.items.length && (
          <Card><CardHeader title="Insights" sub="Rule-based, from your own history" />
            <ul className="grid gap-3 md:grid-cols-2">{insights.data.items.map((i) => (
              <li key={i.id} className="flex gap-3 rounded-ctl border border-line p-3"><Lightbulb className={cx('mt-0.5 h-5 w-5 shrink-0', i.level === 'warning' ? 'text-gold' : i.level === 'good' ? 'text-pos' : 'text-brand')} />
                <div><p className="text-sm font-semibold">{i.title}</p><p className="text-sm text-muted">{i.detail}</p></div></li>))}</ul></Card>)}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader title="Monthly spending" sub="Last 12 months" />
            <div className="h-64"><ResponsiveContainer><BarChart data={monthly.data?.items.map((m) => ({ ...m, label: monthLabel(m.month) }))}>{grid}<XAxis dataKey="label" {...axis} /><YAxis {...axis} tickFormatter={rupee} width={52} /><Tooltip {...tip} formatter={(v: number) => formatINR(v)} cursor={{ fill: 'rgb(var(--raised))' }} /><Bar dataKey="totalPaise" name="Spent" fill="rgb(var(--brand))" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
          <Card><CardHeader title="Weekly spending" sub="Last 12 weeks" />
            <div className="h-64"><ResponsiveContainer><LineChart data={weekly.data?.items.map((w) => ({ ...w, label: w.weekStart.slice(5) }))}>{grid}<XAxis dataKey="label" {...axis} /><YAxis {...axis} tickFormatter={rupee} width={52} /><Tooltip {...tip} formatter={(v: number) => formatINR(v)} /><Line type="monotone" dataKey="totalPaise" name="Spent" stroke="rgb(var(--brand))" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></div></Card>
          <Card><CardHeader title="Spending by category" sub={`${monthLabel(month)} · ${formatINR(totalMonth)}`} />
            {!cats.data?.items.length ? <p className="py-10 text-center text-sm text-muted">No spending this month.</p> : (
              <div className="flex flex-col items-center gap-4 sm:flex-row"><div className="h-56 w-56 shrink-0"><ResponsiveContainer><PieChart><Pie data={cats.data.items} dataKey="totalPaise" nameKey="category" innerRadius="60%" outerRadius="95%" paddingAngle={2} stroke="none">{cats.data.items.map((c) => <Cell key={c.category} fill={CAT_COLOR[c.category]} />)}</Pie><Tooltip {...tip} formatter={(v: number, n: string) => [formatINR(v), CAT_LABEL[n as Category]]} /></PieChart></ResponsiveContainer></div>
                <ul className="w-full space-y-2 text-sm">{cats.data.items.map((c) => <li key={c.category} className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: CAT_COLOR[c.category] }} /><span className="flex-1">{CAT_LABEL[c.category]}</span><span className="tabular-nums text-muted">{Math.round((c.totalPaise / totalMonth) * 100)}%</span><b className="w-24 text-right tabular-nums">{formatINR(c.totalPaise)}</b></li>)}</ul></div>)}</Card>
          <Card><CardHeader title="Group-wise spending" sub={monthLabel(month)} />
            {!groups.data?.items.some((g) => g.totalPaise) ? <p className="py-10 text-center text-sm text-muted">No group spending this month.</p> : <div className="h-64"><ResponsiveContainer><BarChart layout="vertical" data={groups.data.items.filter((g) => g.totalPaise)}>{<CartesianGrid horizontal={false} stroke="rgb(var(--line))" />}<XAxis type="number" {...axis} tickFormatter={rupee} /><YAxis type="category" dataKey="name" {...axis} width={96} /><Tooltip {...tip} formatter={(v: number) => formatINR(v)} cursor={{ fill: 'rgb(var(--raised))' }} /><Bar dataKey="totalPaise" name="Your share" fill="rgb(var(--brand))" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div>}</Card>
          <Card><CardHeader title="Spending trend" sub="Last 30 days, cumulative" />
            <div className="h-64"><ResponsiveContainer><AreaChart data={trends.data?.items.map((t) => ({ ...t, label: t.date.slice(5) }))}><defs><linearGradient id="trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity={0.35} /><stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity={0} /></linearGradient></defs>{grid}<XAxis dataKey="label" {...axis} interval={4} /><YAxis {...axis} tickFormatter={rupee} width={52} /><Tooltip {...tip} formatter={(v: number) => formatINR(v)} /><Area type="monotone" dataKey="cumulativePaise" name="Total so far" stroke="rgb(var(--brand))" strokeWidth={2.5} fill="url(#trend)" /></AreaChart></ResponsiveContainer></div></Card>
          <Card><CardHeader title="Who pays" sub="Amounts paid upfront across your groups" />
            {!contrib.data?.items.length ? <p className="py-10 text-center text-sm text-muted">No data yet.</p> : <ul className="space-y-3">{contrib.data.items.map((c, i) => { const max = contrib.data!.items[0].paidPaise || 1; return (
              <li key={i} className="flex items-center gap-3"><Avatar name={c.user?.name} src={c.user?.avatarUrl} size={32} /><div className="min-w-0 flex-1"><div className="flex justify-between text-sm"><span className="truncate font-medium">{c.user?.name}</span><span className="tabular-nums">{formatINR(c.paidPaise)}</span></div><div className="mt-1 h-2 rounded-full bg-raised"><div className="h-2 rounded-full bg-brand" style={{ width: `${(c.paidPaise / max) * 100}%` }} /></div></div></li>); })}</ul>}</Card>
        </div>
        <Card><CardHeader title={`${monthLabel(month)} vs ${cmp.data ? monthLabel(cmp.data.previousMonth) : 'previous month'}`} sub="Category comparison" />
          {cmp.data && (<div className="h-72"><ResponsiveContainer><BarChart data={cmp.data.categories.map((c) => ({ name: CAT_LABEL[c.category], current: c.currentPaise, previous: c.previousPaise }))}>{grid}<XAxis dataKey="name" {...axis} /><YAxis {...axis} tickFormatter={rupee} width={52} /><Tooltip {...tip} formatter={(v: number) => formatINR(v)} cursor={{ fill: 'rgb(var(--raised))' }} /><Legend /><Bar dataKey="previous" name={monthLabel(cmp.data.previousMonth)} fill="rgb(var(--muted))" fillOpacity={0.45} radius={[6, 6, 0, 0]} /><Bar dataKey="current" name={monthLabel(cmp.data.month)} fill="rgb(var(--brand))" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>)}</Card>
        <Card><CardHeader title="Highest spending categories" sub="All time" />
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{top.data?.items.map((c, i) => <li key={c.category} className="rounded-ctl border border-line p-3"><Badge tone="neutral">#{i + 1}</Badge><p className="mt-2 text-sm font-semibold" style={{ color: CAT_COLOR[c.category] }}>{CAT_LABEL[c.category]}</p><p className="text-lg font-bold tabular-nums">{formatINR(c.totalPaise)}</p></li>)}</ol></Card>
      </>}
    </div>
  );
}
