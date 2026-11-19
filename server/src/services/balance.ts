import mongoose from 'mongoose';
import { computeNetBalances, computePairwiseDebts, type LedgerExpense, type LedgerSettlement } from '../engine/balances.js';
import { simplifyDebts } from '../engine/simplify.js';
import { Expense, ExpenseSplit, Settlement } from '../models/index.js';
import { userCards } from './core.js';

/** Load the ledger for one group (live expenses + COMPLETED settlements only). Balances are derived, never stored. */
export async function loadLedger(groupId: string): Promise<{ expenses: LedgerExpense[]; settlements: LedgerSettlement[] }> {
  const exps = await Expense.find({ groupId, deletedAt: { $exists: false } }).select('paidBy amountPaise');
  const splits = await ExpenseSplit.find({ groupId, expenseId: { $in: exps.map((e) => e._id) } }).select('expenseId userId owedPaise');
  const byExp = new Map<string, { userId: string; owedPaise: number }[]>();
  for (const s of splits) {
    const k = String(s.expenseId);
    if (!byExp.has(k)) byExp.set(k, []);
    byExp.get(k)!.push({ userId: String(s.userId), owedPaise: s.owedPaise });
  }
  const sets = await Settlement.find({ groupId, status: 'completed' }).select('fromUser toUser amountPaise');
  return {
    expenses: exps.map((e) => ({ paidBy: String(e.paidBy), amountPaise: e.amountPaise, splits: byExp.get(String(e._id)) ?? [] })),
    settlements: sets.map((s) => ({ fromUser: String(s.fromUser), toUser: String(s.toUser), amountPaise: s.amountPaise })),
  };
}

export async function groupBalances(groupId: string, memberIds: string[], simplify = true) {
  const { expenses, settlements } = await loadLedger(groupId);
  const net = computeNetBalances(expenses, settlements);
  for (const m of memberIds) if (!net.has(m)) net.set(m, 0);
  const pairwise = computePairwiseDebts(expenses, settlements);
  const simplified = simplifyDebts(net);
  const cards = await userCards([...net.keys()]);
  const named = (ts: { from: string; to: string; amountPaise: number }[]) => ts.map((t) => ({ ...t, fromUser: cards.get(t.from), toUser: cards.get(t.to) }));
  return {
    balances: [...net.entries()].map(([userId, netPaise]) => ({ userId, user: cards.get(userId), netPaise })).sort((a, b) => b.netPaise - a.netPaise),
    pairwise: named(pairwise),
    simplified: named(simplified),
    savedTransfers: Math.max(0, pairwise.length - simplified.length),
    useSimplified: simplify,
  };
}

/** Dashboard totals for one user across all their groups. */
export async function userSummary(userId: string, groupIds: string[]) {
  let owe = 0, owed = 0;
  const perGroup: { groupId: string; netPaise: number }[] = [];
  for (const g of groupIds) {
    const { expenses, settlements } = await loadLedger(g);
    const net = computeNetBalances(expenses, settlements).get(userId) ?? 0;
    perGroup.push({ groupId: g, netPaise: net });
    if (net < 0) owe += -net; else owed += net;
  }
  return { owePaise: owe, owedPaise: owed, netPaise: owed - owe, perGroup };
}

export async function groupLedger(groupId: string, limit = 100) {
  const [exps, sets] = await Promise.all([
    Expense.find({ groupId, deletedAt: { $exists: false } }).sort({ expenseDate: -1 }).limit(limit),
    Settlement.find({ groupId, status: 'completed' }).sort({ createdAt: -1 }).limit(limit),
  ]);
  const cards = await userCards([...exps.map((e) => e.paidBy), ...sets.flatMap((s) => [s.fromUser, s.toUser])]);
  const rows = [
    ...exps.map((e) => ({ kind: 'expense' as const, id: String(e._id), date: e.expenseDate, title: e.description, amountPaise: e.amountPaise, by: cards.get(String(e.paidBy)), category: e.category })),
    ...sets.map((s) => ({ kind: 'settlement' as const, id: String(s._id), date: s.updatedAt, title: `${cards.get(String(s.fromUser))?.name} paid ${cards.get(String(s.toUser))?.name}`, amountPaise: s.amountPaise, by: cards.get(String(s.fromUser)), category: null })),
  ];
  return rows.sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, limit);
}
export const toOid = (s: string) => new mongoose.Types.ObjectId(s);
