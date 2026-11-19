import { EngineError } from './money.js';
import type { Transfer } from './balances.js';

/**
 * DEBT SIMPLIFICATION
 * -------------------
 * Input : net balance per person (paise). Positive = is owed money, negative = owes money. Must sum to 0.
 * Output: a short list of transfers that settles everybody.
 *
 * Idea: the group's internal "who paid whom" history does not matter, only each person's net position.
 *
 * greedy  : repeatedly match the largest debtor with the largest creditor (two heaps).
 *           Transfers <= (nonzero people - 1).  Time O(n log n), space O(n).
 * optimal : minimum possible transfers. Finding it is NP-hard (it is the zero-sum subset partition
 *           problem): a group of k people whose nets sum to 0 can be settled in k-1 transfers, so we
 *           maximise the number of disjoint zero-sum groups with bitmask DP, then run greedy inside each.
 *           Time O(2^n * n), so it is used only when nonzero people <= OPTIMAL_LIMIT (default 16).
 */
export const OPTIMAL_LIMIT = 16;

class MaxHeap {
  private a: { id: string; v: number }[] = [];
  get size() { return this.a.length; }
  push(x: { id: string; v: number }) {
    this.a.push(x);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(this.a[p], this.a[i])) { [this.a[p], this.a[i]] = [this.a[i], this.a[p]]; i = p; } else break;
    }
  }
  pop() {
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && this.less(this.a[m], this.a[l])) m = l;
        if (r < this.a.length && this.less(this.a[m], this.a[r])) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top;
  }
  // larger value first; ties by id for determinism
  private less(x: { id: string; v: number }, y: { id: string; v: number }) {
    return x.v === y.v ? x.id > y.id : x.v < y.v;
  }
}

export function validateNets(nets: Map<string, number>) {
  let sum = 0;
  for (const [id, v] of nets) {
    if (!Number.isSafeInteger(v)) throw new EngineError(`Balance of ${id} is not an integer`, 'INVALID_BALANCE');
    sum += v;
  }
  if (sum !== 0) throw new EngineError(`Balances must sum to zero (got ${sum})`, 'UNBALANCED');
}

export function simplifyGreedy(nets: Map<string, number>): Transfer[] {
  validateNets(nets);
  const debtors = new MaxHeap();
  const creditors = new MaxHeap();
  for (const [id, v] of nets) {
    if (v > 0) creditors.push({ id, v });
    else if (v < 0) debtors.push({ id, v: -v });
  }
  const out: Transfer[] = [];
  while (debtors.size && creditors.size) {
    const d = debtors.pop();
    const c = creditors.pop();
    const amt = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amountPaise: amt });
    if (d.v > amt) debtors.push({ id: d.id, v: d.v - amt });
    if (c.v > amt) creditors.push({ id: c.id, v: c.v - amt });
  }
  return out;
}

export function simplifyOptimal(nets: Map<string, number>): Transfer[] {
  validateNets(nets);
  const people = [...nets.entries()].filter(([, v]) => v !== 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const n = people.length;
  if (n === 0) return [];
  if (n > OPTIMAL_LIMIT) return simplifyGreedy(nets);
  const full = (1 << n) - 1;
  const sums = new Float64Array(full + 1);
  for (let m = 1; m <= full; m++) {
    const low = m & -m;
    const idx = 31 - Math.clz32(low);
    sums[m] = sums[m ^ low] + people[idx][1];
  }
  const dp = new Int32Array(full + 1);
  const choice = new Int8Array(full + 1);
  for (let m = 1; m <= full; m++) {
    let best = -1;
    let pick = 0;
    for (let i = 0; i < n; i++) {
      if (m & (1 << i)) {
        const v = dp[m ^ (1 << i)];
        if (v > best) { best = v; pick = i; }
      }
    }
    dp[m] = best + (sums[m] === 0 ? 1 : 0);
    choice[m] = pick;
  }
  // Rebuild an ordering; zero-sum prefixes delimit the groups.
  const order: number[] = [];
  for (let m = full; m > 0; m ^= 1 << choice[m]) order.push(choice[m]);
  order.reverse();
  const groups: number[][] = [];
  let cur: number[] = [];
  let running = 0;
  for (const i of order) {
    cur.push(i);
    running += people[i][1];
    if (running === 0) { groups.push(cur); cur = []; }
  }
  const out: Transfer[] = [];
  for (const g of groups) {
    out.push(...simplifyGreedy(new Map(g.map((i) => [people[i][0], people[i][1]] as [string, number]))));
  }
  return out;
}

export function simplifyDebts(nets: Map<string, number>, mode: 'auto' | 'greedy' | 'optimal' = 'auto'): Transfer[] {
  if (mode === 'greedy') return simplifyGreedy(nets);
  if (mode === 'optimal') return simplifyOptimal(nets);
  return simplifyOptimal(nets); // falls back to greedy automatically for big groups
}

/** Re-derive net balances from a transfer list (used by tests to prove positions are preserved). */
export function netFromTransfers(ts: Transfer[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of ts) {
    m.set(t.from, (m.get(t.from) ?? 0) - t.amountPaise);
    m.set(t.to, (m.get(t.to) ?? 0) + t.amountPaise);
  }
  return m;
}
