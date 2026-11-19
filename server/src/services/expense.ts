import { z } from 'zod';
import { runTx } from '../config/db.js';
import { CATEGORIES } from '../constants.js';
import { calculateSplit, SPLIT_METHODS } from '../engine/splitters/index.js';
import { Expense, ExpenseSplit, Group } from '../models/index.js';
import { badRequest, forbidden, notFound } from '../utils/http.js';
import { checkBudgets } from './budget.js';
import { activeMemberIds, audit, notify, requireGroupAdmin, requireMember, userCards, type Actor } from './core.js';

const id = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const expenseBody = z.object({
  description: z.string().trim().min(1).max(200),
  category: z.enum(CATEGORIES).default('other'),
  amountPaise: z.number().int().positive().max(100_000_000_00),
  paidBy: id,
  splitMethod: z.enum(SPLIT_METHODS),
  participants: z.array(z.object({ userId: id, value: z.number().finite().optional() })).min(1).max(100),
  expenseDate: z.coerce.date().refine((d) => d.getTime() < Date.now() + 86_400_000 * 2, 'Date cannot be in the future'),
  notes: z.string().trim().max(1000).optional(),
});
export const previewBody = z.object({ amountPaise: expenseBody.shape.amountPaise, splitMethod: expenseBody.shape.splitMethod, participants: expenseBody.shape.participants });
export type ExpenseInput = z.infer<typeof expenseBody>;

async function validateAndSplit(groupId: string, input: ExpenseInput) {
  const members = new Set(await activeMemberIds(groupId));
  if (!members.has(input.paidBy)) throw badRequest('The payer must be an active group member');
  for (const p of input.participants) if (!members.has(p.userId)) throw badRequest('Every participant must be an active group member');
  return calculateSplit(input.splitMethod, input.amountPaise, input.participants); // ALL maths on the server
}

export async function fmtExpense(e: any, splits?: any[]) {
  const sp = splits ?? (await ExpenseSplit.find({ expenseId: e._id }));
  const cards = await userCards([e.paidBy, e.createdBy, ...sp.map((s) => s.userId)]);
  return {
    id: String(e._id), groupId: String(e.groupId), description: e.description, category: e.category, amountPaise: e.amountPaise,
    paidBy: cards.get(String(e.paidBy)) ?? { id: String(e.paidBy), name: 'Unknown' }, createdBy: String(e.createdBy), splitMethod: e.splitMethod,
    expenseDate: e.expenseDate, notes: e.notes, receiptUrl: e.receiptUrl ?? null, version: e.version, createdAt: e.createdAt,
    splits: sp.map((s) => ({ user: cards.get(String(s.userId)) ?? { id: String(s.userId), name: 'Unknown' }, owedPaise: s.owedPaise, inputValue: s.inputValue })),
  };
}

export async function previewSplit(groupId: string | null, input: z.infer<typeof previewBody>) {
  return calculateSplit(input.splitMethod, input.amountPaise, input.participants);
}

export async function createExpense(actor: Actor, groupId: string, input: ExpenseInput) {
  await requireMember(groupId, actor.id);
  const split = await validateAndSplit(groupId, input);
  const g = await Group.findById(groupId);
  const exp = await runTx(async (session) => {
    const [e] = await Expense.create([{ groupId, description: input.description, category: input.category, amountPaise: input.amountPaise, paidBy: input.paidBy, splitMethod: input.splitMethod, expenseDate: input.expenseDate, notes: input.notes ?? '', createdBy: actor.id, updatedBy: actor.id }], { session });
    await ExpenseSplit.insertMany(split.map((s) => ({ expenseId: e._id, groupId, userId: s.userId, owedPaise: s.owedPaise, inputValue: s.inputValue })), { session });
    await audit(actor, 'expense.create', 'Expense', e._id, { groupId, after: { description: e.description, amountPaise: e.amountPaise } }, session);
    await notify(split.map((s) => s.userId).concat(input.paidBy).filter((u) => u !== actor.id), { type: 'expense_new', title: `New expense in ${g?.name}`, body: `${input.description} · ₹${(input.amountPaise / 100).toFixed(2)}`, link: `/groups/${groupId}` }, session);
    return e;
  });
  await checkBudgets(split.map((s) => s.userId), input.expenseDate).catch((e) => console.error('[budget]', e));
  return fmtExpense(exp);
}

async function loadExpense(expenseId: string) {
  const e = await Expense.findOne({ _id: expenseId, deletedAt: { $exists: false } });
  if (!e) throw notFound('Expense not found');
  return e;
}
async function requireEditRights(actor: Actor, e: any) {
  const m = await requireMember(String(e.groupId), actor.id);
  if (m.role === 'member' && ![String(e.createdBy), String(e.paidBy)].includes(actor.id)) throw forbidden('Only the creator, the payer or a group admin can change this expense');
}

export async function getExpense(userId: string, expenseId: string) {
  const e = await loadExpense(expenseId);
  await requireMember(String(e.groupId), userId);
  return fmtExpense(e);
}

export async function updateExpense(actor: Actor, expenseId: string, input: ExpenseInput, expectedVersion?: number) {
  const e = await loadExpense(expenseId);
  await requireEditRights(actor, e);
  if (expectedVersion !== undefined && expectedVersion !== e.version) throw new (await import('../utils/http.js')).HttpError(409, 'This expense was changed by someone else. Reload and try again.', 'STALE');
  const gid = String(e.groupId);
  const split = await validateAndSplit(gid, input);
  const before = { description: e.description, amountPaise: e.amountPaise, paidBy: String(e.paidBy), category: e.category };
  const res = await runTx(async (session) => {
    Object.assign(e, { description: input.description, category: input.category, amountPaise: input.amountPaise, paidBy: input.paidBy, splitMethod: input.splitMethod, expenseDate: input.expenseDate, notes: input.notes ?? '', updatedBy: actor.id, version: e.version + 1 });
    await e.save({ session });
    await ExpenseSplit.deleteMany({ expenseId: e._id }, { session });
    await ExpenseSplit.insertMany(split.map((s) => ({ expenseId: e._id, groupId: gid, userId: s.userId, owedPaise: s.owedPaise, inputValue: s.inputValue })), { session });
    await audit(actor, 'expense.update', 'Expense', e._id, { groupId: gid, before, after: { description: input.description, amountPaise: input.amountPaise, paidBy: input.paidBy, category: input.category } }, session);
    await notify(split.map((s) => s.userId).concat(input.paidBy).filter((u) => u !== actor.id), { type: 'expense_update', title: 'An expense was updated', body: input.description, link: `/groups/${gid}` }, session);
    return e;
  });
  await checkBudgets(split.map((s) => s.userId), input.expenseDate).catch(() => undefined);
  return fmtExpense(res);
}

export async function deleteExpense(actor: Actor, expenseId: string) {
  const e = await loadExpense(expenseId);
  await requireEditRights(actor, e);
  await runTx(async (session) => {
    e.deletedAt = new Date(); e.deletedBy = actor.id as any;
    await e.save({ session });
    await audit(actor, 'expense.delete', 'Expense', e._id, { groupId: e.groupId, before: { description: e.description, amountPaise: e.amountPaise } }, session);
    const splits = await ExpenseSplit.find({ expenseId: e._id }).session(session ?? null);
    await notify(splits.map((s) => s.userId).filter((u) => String(u) !== actor.id), { type: 'expense_update', title: 'An expense was deleted', body: e.description, link: `/groups/${e.groupId}` }, session);
  });
}

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(), category: z.enum(CATEGORIES).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), paidBy: id.optional(),
});
export async function listExpenses(userId: string, groupId: string, q: z.infer<typeof listQuery>) {
  await requireMember(groupId, userId);
  const filter: any = { groupId, deletedAt: { $exists: false } };
  if (q.category) filter.category = q.category;
  if (q.paidBy) filter.paidBy = q.paidBy;
  if (q.q) filter.description = { $regex: q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (q.from || q.to) filter.expenseDate = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  const [total, rows] = await Promise.all([Expense.countDocuments(filter), Expense.find(filter).sort({ expenseDate: -1, createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit)]);
  const splits = await ExpenseSplit.find({ expenseId: { $in: rows.map((r) => r._id) } });
  const by = new Map<string, any[]>();
  for (const s of splits) { const k = String(s.expenseId); (by.get(k) ?? by.set(k, []).get(k)!).push(s); }
  const items = await Promise.all(rows.map((r) => fmtExpense(r, by.get(String(r._id)) ?? [])));
  return { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) };
}

export async function attachReceipt(actor: Actor, expenseId: string, url: string) {
  const e = await loadExpense(expenseId);
  await requireEditRights(actor, e);
  e.receiptUrl = url; await e.save();
  await audit(actor, 'expense.receipt', 'Expense', e._id, { groupId: e.groupId });
  return fmtExpense(e);
}
void requireGroupAdmin;
