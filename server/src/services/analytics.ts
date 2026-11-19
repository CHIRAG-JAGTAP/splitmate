import { CATEGORIES } from '../constants.js';
import { Expense, Group, GroupMember, Settlement } from '../models/index.js';
import { monthKey, monthRange, prevMonthKey } from '../utils/http.js';
import { userSpendRows } from './budget.js';
import { groupBalances, userSummary } from './balance.js';
import { userCards } from './core.js';

const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const sum = (rows: { owedPaise: number }[]) => rows.reduce((a, r) => a + r.owedPaise, 0);

export async function monthly(userId: string, months = 12) {
  const now = new Date();
  const start = addMonths(now, -(months - 1));
  const rows = await userSpendRows(userId, start, addMonths(now, 1));
  return Array.from({ length: months }, (_, i) => {
    const key = monthKey(addMonths(start, i));
    return { month: key, totalPaise: sum(rows.filter((r) => monthKey(new Date(r.date)) === key)) };
  });
}

const startOfWeek = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
export async function weekly(userId: string, weeks = 12) {
  const thisWeek = startOfWeek(new Date());
  const start = new Date(thisWeek.getTime() - (weeks - 1) * 7 * 86_400_000);
  const rows = await userSpendRows(userId, start, new Date(thisWeek.getTime() + 7 * 86_400_000));
  return Array.from({ length: weeks }, (_, i) => {
    const ws = new Date(start.getTime() + i * 7 * 86_400_000), we = new Date(ws.getTime() + 7 * 86_400_000);
    return { weekStart: ws.toISOString().slice(0, 10), totalPaise: sum(rows.filter((r) => +new Date(r.date) >= +ws && +new Date(r.date) < +we)) };
  });
}

export async function categories(userId: string, month?: string) {
  const { start, end } = month ? monthRange(month) : { start: new Date(0), end: new Date(Date.UTC(3000, 0, 1)) };
  const rows = await userSpendRows(userId, start, end);
  return CATEGORIES.map((c) => ({ category: c, totalPaise: sum(rows.filter((r) => r.category === c)) })).filter((x) => x.totalPaise > 0).sort((a, b) => b.totalPaise - a.totalPaise);
}

export async function byGroup(userId: string, month?: string) {
  const { start, end } = month ? monthRange(month) : { start: new Date(0), end: new Date(Date.UTC(3000, 0, 1)) };
  const rows = await userSpendRows(userId, start, end);
  const ids = [...new Set(rows.map((r) => String(r.groupId)))];
  const groups = await Group.find({ _id: { $in: ids } }).select('name');
  return groups.map((g) => ({ groupId: String(g._id), name: g.name, totalPaise: sum(rows.filter((r) => String(r.groupId) === String(g._id))) })).sort((a, b) => b.totalPaise - a.totalPaise);
}

/** Who actually paid out of pocket (contribution) vs consumed, within the user's groups. */
export async function contributions(userId: string, groupId?: string) {
  const mems = await GroupMember.find({ userId, status: 'active', ...(groupId && { groupId }) });
  const gids = mems.map((m) => m.groupId);
  const agg = await Expense.aggregate([{ $match: { groupId: { $in: gids }, deletedAt: { $exists: false } } }, { $group: { _id: '$paidBy', paidPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } }, { $sort: { paidPaise: -1 } }]);
  const cards = await userCards(agg.map((a) => a._id));
  return agg.map((a) => ({ user: cards.get(String(a._id)), paidPaise: a.paidPaise, count: a.count }));
}

export async function trends(userId: string, days = 30) {
  const end = new Date(Date.now() + 86_400_000);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - days));
  const rows = await userSpendRows(userId, start, end);
  const map = new Map<string, number>();
  for (const r of rows) { const k = new Date(r.date).toISOString().slice(0, 10); map.set(k, (map.get(k) ?? 0) + r.owedPaise); }
  let running = 0;
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start.getTime() + (i + 1) * 86_400_000).toISOString().slice(0, 10);
    const v = map.get(day) ?? 0; running += v;
    return { date: day, totalPaise: v, cumulativePaise: running };
  });
}

export async function compare(userId: string, month = monthKey()) {
  const [cur, prev] = await Promise.all([categories(userId, month), categories(userId, prevMonthKey(month))]);
  const all = new Set([...cur, ...prev].map((c) => c.category));
  const rows = [...all].map((category) => {
    const c = cur.find((x) => x.category === category)?.totalPaise ?? 0, p = prev.find((x) => x.category === category)?.totalPaise ?? 0;
    return { category, currentPaise: c, previousPaise: p, changePct: p === 0 ? (c === 0 ? 0 : null) : Math.round(((c - p) / p) * 1000) / 10 };
  });
  return { month, previousMonth: prevMonthKey(month), categories: rows, currentTotalPaise: rows.reduce((a, r) => a + r.currentPaise, 0), previousTotalPaise: rows.reduce((a, r) => a + r.previousPaise, 0) };
}

export async function topCategories(userId: string, limit = 5) { return (await categories(userId)).slice(0, limit); }

export async function exportCsv(userId: string, from?: Date, to?: Date) {
  const rows = (await userSpendRows(userId, from ?? new Date(0), to ?? new Date(Date.UTC(3000, 0, 1)))).sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const groups = new Map((await Group.find({ _id: { $in: rows.map((r) => r.groupId) } }).select('name')).map((g) => [String(g._id), g.name]));
  const cell = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; }; // blocks CSV/Excel formula injection
  const lines = [['Date', 'Group', 'Description', 'Category', 'My share (INR)'].map(cell).join(',')];
  for (const r of rows) lines.push([new Date(r.date).toISOString().slice(0, 10), groups.get(String(r.groupId)), r.description, r.category, (r.owedPaise / 100).toFixed(2)].map(cell).join(','));
  return lines.join('\r\n');
}

/* ---------------- rule-based insights ---------------- */
export interface Insight { id: string; level: 'info' | 'good' | 'warning'; title: string; detail: string; link?: string }
const inr = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export async function insights(userId: string): Promise<Insight[]> {
  const out: Insight[] = [];
  const month = monthKey();
  const cmp = await compare(userId, month);
  const cats = cmp.categories.filter((c) => c.currentPaise > 0).sort((a, b) => b.currentPaise - a.currentPaise);
  if (cats[0]) out.push({ id: 'top-cat', level: 'info', title: `${cap(cats[0].category)} is your top category this month`, detail: `You've spent ${inr(cats[0].currentPaise)} on ${cats[0].category} (${Math.round((cats[0].currentPaise / cmp.currentTotalPaise) * 100)}% of your share).`, link: '/analytics' });
  for (const c of cmp.categories) {
    if (c.changePct !== null && c.changePct >= 20 && c.currentPaise - c.previousPaise >= 10000) out.push({ id: `up-${c.category}`, level: 'warning', title: `Your ${c.category} spending is up ${Math.round(c.changePct)}%`, detail: `${inr(c.currentPaise)} this month vs ${inr(c.previousPaise)} last month.`, link: '/analytics' });
    if (c.changePct !== null && c.changePct <= -20 && c.previousPaise - c.currentPaise >= 10000) out.push({ id: `down-${c.category}`, level: 'good', title: `You spent ${Math.abs(Math.round(c.changePct))}% less on ${c.category}`, detail: `${inr(c.currentPaise)} vs ${inr(c.previousPaise)} last month.` });
  }
  if (cmp.previousTotalPaise > 0 && cmp.currentTotalPaise > cmp.previousTotalPaise * 1.1) out.push({ id: 'total-up', level: 'info', title: 'Spending is higher than last month', detail: `${inr(cmp.currentTotalPaise)} so far vs ${inr(cmp.previousTotalPaise)} for all of last month.` });
  const { budgetProgress } = await import('./budget.js');
  for (const b of await budgetProgress(userId, month)) {
    const name = b.scope === 'category' ? `${b.category} budget` : b.scope === 'group' ? `${b.groupName ?? 'group'} budget` : 'monthly budget';
    if (b.status === 'over') out.push({ id: `bud-${b.id}`, level: 'warning', title: `You are over your ${name}`, detail: `${inr(b.spentPaise)} spent of ${inr(b.limitPaise)}.`, link: '/budgets' });
    else if (b.status === 'warning') out.push({ id: `bud-${b.id}`, level: 'warning', title: `You are approaching your ${name}`, detail: `${b.pct}% used (${inr(b.spentPaise)} of ${inr(b.limitPaise)}).`, link: '/budgets' });
  }
  const mems = await GroupMember.find({ userId, status: 'active' });
  const gids = mems.map((m) => String(m.groupId));
  const pending = await Settlement.countDocuments({ groupId: { $in: gids }, status: 'pending', $or: [{ fromUser: userId }, { toUser: userId }] });
  if (pending >= 1) out.push({ id: 'pending', level: pending >= 3 ? 'warning' : 'info', title: pending >= 3 ? 'You have several pending settlements' : 'You have a pending settlement', detail: `${pending} payment${pending > 1 ? 's' : ''} waiting for confirmation.`, link: '/settlements' });
  const groups = await Group.find({ _id: { $in: gids } }).select('name');
  for (const g of groups) {
    const b = await groupBalances(String(g._id), []);
    if (b.savedTransfers >= 1) out.push({ id: `simp-${g._id}`, level: 'good', title: `Simplify debts in ${g.name}`, detail: `Debt simplification cuts ${b.pairwise.length} payments to ${b.simplified.length}.`, link: `/groups/${g._id}` });
  }
  const s = await userSummary(userId, gids);
  if (s.owePaise > 0) out.push({ id: 'owe', level: 'info', title: `You owe ${inr(s.owePaise)} in total`, detail: 'Settle up to keep your groups tidy.', link: '/settlements' });
  if (s.owedPaise > 0) out.push({ id: 'owed', level: 'good', title: `Others owe you ${inr(s.owedPaise)}`, detail: 'Send a reminder from the group page.' });
  return out;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
