import mongoose from 'mongoose';
import { z } from 'zod';
import { CATEGORIES } from '../constants.js';
import { Budget, ExpenseSplit, Group } from '../models/index.js';
import { badRequest, forbidden, monthKey, monthRange, notFound } from '../utils/http.js';
import { notify, requireMember, type Actor } from './core.js';

/** What `userId` personally consumed (their share of expenses) in a month. */
export async function userSpendRows(userId: string, start: Date, end: Date, groupId?: string) {
  const match: any = { userId: new mongoose.Types.ObjectId(userId) };
  if (groupId) match.groupId = new mongoose.Types.ObjectId(groupId);
  return ExpenseSplit.aggregate<{ owedPaise: number; groupId: mongoose.Types.ObjectId; category: string; date: Date; description: string; expenseId: mongoose.Types.ObjectId }>([
    { $match: match },
    { $lookup: { from: 'expenses', localField: 'expenseId', foreignField: '_id', as: 'e' } },
    { $unwind: '$e' },
    { $match: { 'e.deletedAt': { $exists: false }, 'e.expenseDate': { $gte: start, $lt: end } } },
    { $project: { owedPaise: 1, groupId: 1, expenseId: 1, category: '$e.category', date: '$e.expenseDate', description: '$e.description' } },
  ]);
}

export async function spentFor(userId: string, b: { scope: string; groupId?: unknown; category?: string; month: string }) {
  const { start, end } = monthRange(b.month);
  const rows = await userSpendRows(userId, start, end, b.scope === 'group' ? String(b.groupId) : undefined);
  return rows.filter((r) => b.scope !== 'category' || r.category === b.category).reduce((a, r) => a + r.owedPaise, 0);
}

export const budgetBody = z.object({
  scope: z.enum(['monthly', 'group', 'category']),
  groupId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  category: z.enum(CATEGORIES).optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default(() => monthKey()),
  limitPaise: z.number().int().positive().max(100_000_000_00),
  alertThresholdPct: z.number().int().min(1).max(100).default(80),
}).superRefine((v, ctx) => {
  if (v.scope === 'group' && !v.groupId) ctx.addIssue({ code: 'custom', message: 'groupId is required for group budgets', path: ['groupId'] });
  if (v.scope === 'category' && !v.category) ctx.addIssue({ code: 'custom', message: 'category is required for category budgets', path: ['category'] });
});

export async function createBudget(actor: Actor, input: z.infer<typeof budgetBody>) {
  if (input.scope === 'group') await requireMember(input.groupId!, actor.id);
  const doc = { userId: actor.id, scope: input.scope, groupId: input.scope === 'group' ? input.groupId : undefined, category: input.scope === 'category' ? input.category : undefined, month: input.month };
  const existing = await Budget.findOne(doc);
  if (existing) throw badRequest('A budget for that scope and month already exists. Edit it instead.');
  return Budget.create({ ...doc, limitPaise: input.limitPaise, alertThresholdPct: input.alertThresholdPct });
}

export async function budgetProgress(userId: string, month = monthKey()) {
  const bs = await Budget.find({ userId, month }).sort({ createdAt: 1 });
  const groups = new Map((await Group.find({ _id: { $in: bs.map((b) => b.groupId).filter(Boolean) } })).map((g) => [String(g._id), g.name]));
  return Promise.all(bs.map(async (b) => {
    const spent = await spentFor(userId, b as any);
    const pct = Math.round((spent / b.limitPaise) * 1000) / 10;
    return { id: String(b._id), scope: b.scope, groupId: b.groupId ? String(b.groupId) : null, groupName: b.groupId ? groups.get(String(b.groupId)) ?? null : null, category: b.category ?? null, month: b.month, limitPaise: b.limitPaise, alertThresholdPct: b.alertThresholdPct, spentPaise: spent, pct, status: pct >= 100 ? 'over' : pct >= b.alertThresholdPct ? 'warning' : 'ok' };
  }));
}

export async function budgetHistory(userId: string, months = 6) {
  const all = await Budget.find({ userId }).sort({ month: -1 }).limit(200);
  const out = await Promise.all(all.map(async (b) => {
    const spent = await spentFor(userId, b as any);
    return { id: String(b._id), month: b.month, scope: b.scope, category: b.category ?? null, groupId: b.groupId ? String(b.groupId) : null, limitPaise: b.limitPaise, spentPaise: spent, pct: Math.round((spent / b.limitPaise) * 1000) / 10 };
  }));
  const keep = [...new Set(out.map((o) => o.month))].slice(0, months);
  return out.filter((o) => keep.includes(o.month));
}

export async function updateBudget(actor: Actor, id: string, patch: { limitPaise?: number; alertThresholdPct?: number }) {
  const b = await Budget.findById(id);
  if (!b) throw notFound('Budget not found');
  if (String(b.userId) !== actor.id) throw forbidden();
  if (patch.limitPaise) b.limitPaise = patch.limitPaise;
  if (patch.alertThresholdPct) b.alertThresholdPct = patch.alertThresholdPct;
  b.lastAlertLevel = 0;
  await b.save();
  return b;
}
export async function deleteBudget(actor: Actor, id: string) {
  const b = await Budget.findById(id);
  if (!b) throw notFound('Budget not found');
  if (String(b.userId) !== actor.id) throw forbidden();
  await b.deleteOne();
}

/** After an expense changes, warn affected users once per level (threshold / 100%). */
export async function checkBudgets(userIds: string[], date: Date) {
  const month = monthKey(date);
  for (const userId of new Set(userIds.map(String))) {
    const bs = await Budget.find({ userId, month });
    for (const b of bs) {
      const spent = await spentFor(userId, b as any);
      const pct = (spent / b.limitPaise) * 100;
      const level = pct >= 100 ? 2 : pct >= b.alertThresholdPct ? 1 : 0;
      if (level > b.lastAlertLevel) {
        const label = b.scope === 'category' ? `${b.category} budget` : b.scope === 'group' ? 'group budget' : 'monthly budget';
        await notify([userId], { type: 'budget_warning', title: level === 2 ? `You went over your ${label}` : `You've used ${Math.floor(pct)}% of your ${label}`, body: `₹${(spent / 100).toFixed(2)} of ₹${(b.limitPaise / 100).toFixed(2)} for ${month}`, link: '/budgets' });
      }
      if (level !== b.lastAlertLevel) { b.lastAlertLevel = level; await b.save(); }
    }
  }
}
