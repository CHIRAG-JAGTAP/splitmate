export interface LedgerExpense {
  paidBy: string;
  amountPaise: number;
  splits: { userId: string; owedPaise: number }[];
}
export interface LedgerSettlement {
  fromUser: string; // paid money
  toUser: string; // received money
  amountPaise: number;
}
export interface Transfer {
  from: string; // debtor
  to: string; // creditor
  amountPaise: number;
}

/**
 * Net balance per user:
 *   net = paid - owed + settlementsPaid - settlementsReceived
 * net > 0  -> the group owes this user;  net < 0 -> this user owes the group.
 * Sum of all nets is always 0.
 */
export function computeNetBalances(expenses: LedgerExpense[], settlements: LedgerSettlement[] = []): Map<string, number> {
  const net = new Map<string, number>();
  const add = (u: string, d: number) => net.set(u, (net.get(u) ?? 0) + d);
  for (const e of expenses) {
    add(e.paidBy, e.amountPaise);
    for (const s of e.splits) add(s.userId, -s.owedPaise);
  }
  for (const s of settlements) {
    add(s.fromUser, s.amountPaise);
    add(s.toUser, -s.amountPaise);
  }
  return net;
}

/**
 * Pairwise "who owes whom" (NOT simplified). Each pair is netted in one direction only.
 */
export function computePairwiseDebts(expenses: LedgerExpense[], settlements: LedgerSettlement[] = []): Transfer[] {
  const m = new Map<string, number>(); // key "a|b" with a<b  => positive means a owes b
  const bump = (debtor: string, creditor: string, amt: number) => {
    if (debtor === creditor || amt === 0) return;
    const flip = debtor > creditor;
    const key = flip ? `${creditor}|${debtor}` : `${debtor}|${creditor}`;
    m.set(key, (m.get(key) ?? 0) + (flip ? -amt : amt));
  };
  for (const e of expenses) for (const s of e.splits) bump(s.userId, e.paidBy, s.owedPaise);
  for (const s of settlements) bump(s.toUser, s.fromUser, s.amountPaise); // paying reduces what from owes to
  const out: Transfer[] = [];
  for (const [key, v] of m) {
    if (v === 0) continue;
    const [a, b] = key.split('|');
    out.push(v > 0 ? { from: a, to: b, amountPaise: v } : { from: b, to: a, amountPaise: -v });
  }
  return out.sort((x, y) => y.amountPaise - x.amountPaise);
}

/** Debt of `from` to `to` after netting (0 if none or reversed). Used to cap settlements. */
export function pairwiseDebt(expenses: LedgerExpense[], settlements: LedgerSettlement[], from: string, to: string): number {
  const t = computePairwiseDebts(expenses, settlements).find((x) => x.from === from && x.to === to);
  return t ? t.amountPaise : 0;
}
