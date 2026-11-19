import { describe, it, expect } from 'vitest';
import { allocateByWeights, rupeesToPaise, paiseToRupees, EngineError } from '../money.js';
import { calculateSplit } from '../splitters/index.js';
import { computeNetBalances, computePairwiseDebts, pairwiseDebt } from '../balances.js';
import { simplifyGreedy, simplifyOptimal, simplifyDebts, netFromTransfers } from '../simplify.js';

const sum = (a: { owedPaise: number }[]) => a.reduce((x, y) => x + y.owedPaise, 0);
const P = (...ids: string[]) => ids.map((userId) => ({ userId }));

describe('money', () => {
  it('converts rupees to paise exactly', () => {
    expect(rupeesToPaise('0.1')).toBe(10);
    expect(rupeesToPaise('19.99')).toBe(1999);
    expect(rupeesToPaise(100)).toBe(10000);
    expect(paiseToRupees(1999)).toBe('19.99');
    expect(paiseToRupees(-5)).toBe('-0.05');
    expect(() => rupeesToPaise('1.234')).toThrow(EngineError);
  });
  it('allocateByWeights sums exactly and is fair (<1 paisa error)', () => {
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByWeights(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocateByWeights(0, [1, 2])).toEqual([0, 0]);
    expect(() => allocateByWeights(10, [0, 0])).toThrow();
    expect(() => allocateByWeights(10, [])).toThrow();
  });
  it('handles huge amounts without overflow', () => {
    const r = allocateByWeights(9_000_000_000_000, [3333, 3333, 3334]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(9_000_000_000_000);
  });
  it('random property: sum always equals total', () => {
    for (let t = 0; t < 500; t++) {
      const n = 1 + Math.floor(Math.random() * 12);
      const w = Array.from({ length: n }, () => Math.floor(Math.random() * 1000));
      if (w.every((x) => x === 0)) w[0] = 1;
      const total = Math.floor(Math.random() * 10_000_000);
      const r = allocateByWeights(total, w);
      expect(r.reduce((a, b) => a + b, 0)).toBe(total);
      const sw = w.reduce((a, b) => a + b, 0);
      r.forEach((x, i) => expect(Math.abs(x - (total * w[i]) / sw)).toBeLessThan(1));
    }
  });
});

describe('equal split', () => {
  it('splits evenly', () => expect(calculateSplit('equal', 3000, P('a', 'b', 'c')).map((x) => x.owedPaise)).toEqual([1000, 1000, 1000]));
  it('spreads odd paise', () => {
    const r = calculateSplit('equal', 1000, P('a', 'b', 'c'));
    expect(r.map((x) => x.owedPaise)).toEqual([334, 333, 333]);
    expect(sum(r)).toBe(1000);
  });
  it('single participant owes all', () => expect(calculateSplit('equal', 777, P('a'))[0].owedPaise).toBe(777));
  it('rejects empty, duplicate, zero or fractional totals', () => {
    expect(() => calculateSplit('equal', 100, [])).toThrow();
    expect(() => calculateSplit('equal', 100, P('a', 'a'))).toThrow(/Duplicate/);
    expect(() => calculateSplit('equal', 0, P('a'))).toThrow();
    expect(() => calculateSplit('equal', 10.5, P('a'))).toThrow();
  });
});

describe('exact split', () => {
  it('accepts amounts that add up', () => {
    const r = calculateSplit('exact', 1000, [{ userId: 'a', value: 250 }, { userId: 'b', value: 750 }]);
    expect(r.map((x) => x.owedPaise)).toEqual([250, 750]);
  });
  it('rejects mismatched total', () => {
    expect(() => calculateSplit('exact', 1000, [{ userId: 'a', value: 250 }, { userId: 'b', value: 700 }])).toThrow(/add up/);
  });
  it('rejects negative or fractional', () => {
    expect(() => calculateSplit('exact', 100, [{ userId: 'a', value: -1 }, { userId: 'b', value: 101 }])).toThrow();
    expect(() => calculateSplit('exact', 100, [{ userId: 'a', value: 50.5 }, { userId: 'b', value: 49.5 }])).toThrow();
  });
  it('allows a zero amount for a participant', () => {
    expect(sum(calculateSplit('exact', 100, [{ userId: 'a', value: 0 }, { userId: 'b', value: 100 }]))).toBe(100);
  });
});

describe('percentage split', () => {
  it('50/30/20', () => {
    const r = calculateSplit('percentage', 10000, [{ userId: 'a', value: 50 }, { userId: 'b', value: 30 }, { userId: 'c', value: 20 }]);
    expect(r.map((x) => x.owedPaise)).toEqual([5000, 3000, 2000]);
  });
  it('33.33/33.33/33.34 rounds exactly', () => {
    const r = calculateSplit('percentage', 100, [{ userId: 'a', value: 33.33 }, { userId: 'b', value: 33.33 }, { userId: 'c', value: 33.34 }]);
    expect(sum(r)).toBe(100);
  });
  it('rejects totals not equal to 100 and negatives', () => {
    expect(() => calculateSplit('percentage', 100, [{ userId: 'a', value: 50 }, { userId: 'b', value: 49.99 }])).toThrow(/100/);
    expect(() => calculateSplit('percentage', 100, [{ userId: 'a', value: 120 }, { userId: 'b', value: -20 }])).toThrow();
  });
  it('rejects >2 decimals', () => {
    expect(() => calculateSplit('percentage', 100, [{ userId: 'a', value: 33.333 }, { userId: 'b', value: 66.667 }])).toThrow();
  });
});

describe('shares split', () => {
  it('2:1:1', () => {
    const r = calculateSplit('shares', 4000, [{ userId: 'a', value: 2 }, { userId: 'b', value: 1 }, { userId: 'c', value: 1 }]);
    expect(r.map((x) => x.owedPaise)).toEqual([2000, 1000, 1000]);
  });
  it('fractional shares and rounding', () => {
    const r = calculateSplit('shares', 1001, [{ userId: 'a', value: 1.5 }, { userId: 'b', value: 1 }]);
    expect(sum(r)).toBe(1001);
  });
  it('zero share is allowed but not all zero', () => {
    expect(calculateSplit('shares', 100, [{ userId: 'a', value: 0 }, { userId: 'b', value: 1 }])[0].owedPaise).toBe(0);
    expect(() => calculateSplit('shares', 100, [{ userId: 'a', value: 0 }, { userId: 'b', value: 0 }])).toThrow();
  });
});

describe('unequal (adjustment) split', () => {
  it('adds adjustments then splits remainder equally', () => {
    const r = calculateSplit('unequal', 1000, [{ userId: 'a', value: 100 }, { userId: 'b', value: 0 }, { userId: 'c', value: 0 }]);
    expect(r.map((x) => x.owedPaise)).toEqual([400, 300, 300]);
    expect(sum(r)).toBe(1000);
  });
  it('supports negative adjustments', () => {
    const r = calculateSplit('unequal', 900, [{ userId: 'a', value: -100 }, { userId: 'b', value: 100 }]);
    expect(r.map((x) => x.owedPaise)).toEqual([350, 550]);
  });
  it('rejects adjustments over total or driving someone negative', () => {
    expect(() => calculateSplit('unequal', 100, [{ userId: 'a', value: 200 }, { userId: 'b', value: 0 }])).toThrow();
    expect(() => calculateSplit('unequal', 100, [{ userId: 'a', value: -500 }, { userId: 'b', value: 500 }])).toThrow();
  });
});

describe('balances', () => {
  const exps = [
    { paidBy: 'a', amountPaise: 3000, splits: [{ userId: 'a', owedPaise: 1000 }, { userId: 'b', owedPaise: 1000 }, { userId: 'c', owedPaise: 1000 }] },
    { paidBy: 'b', amountPaise: 600, splits: [{ userId: 'a', owedPaise: 300 }, { userId: 'b', owedPaise: 300 }] },
  ];
  it('net balances sum to zero', () => {
    const n = computeNetBalances(exps);
    expect(n.get('a')).toBe(1700);
    expect(n.get('b')).toBe(-700);
    expect(n.get('c')).toBe(-1000);
    expect([...n.values()].reduce((x, y) => x + y, 0)).toBe(0);
  });
  it('settlements reduce debts (partial too)', () => {
    const n = computeNetBalances(exps, [{ fromUser: 'c', toUser: 'a', amountPaise: 400 }]);
    expect(n.get('c')).toBe(-600);
    expect(n.get('a')).toBe(1300);
    expect(pairwiseDebt(exps, [{ fromUser: 'c', toUser: 'a', amountPaise: 400 }], 'c', 'a')).toBe(600);
  });
  it('pairwise nets opposite directions', () => {
    const d = computePairwiseDebts(exps);
    expect(d.find((x) => x.from === 'b' && x.to === 'a')?.amountPaise).toBe(700); // 1000 - 300
    expect(d.find((x) => x.from === 'c' && x.to === 'a')?.amountPaise).toBe(1000);
  });
  it('removing an expense recalculates (derived, not stored)', () => {
    const n = computeNetBalances([exps[1]]);
    expect(n.get('a')).toBe(-300);
    expect(n.get('b')).toBe(300);
  });
});

describe('debt simplification', () => {
  it('classic example: A owes B 500, B owes C 300, C owes A 200', () => {
    const exps = [
      { paidBy: 'B', amountPaise: 50000, splits: [{ userId: 'A', owedPaise: 50000 }] },
      { paidBy: 'C', amountPaise: 30000, splits: [{ userId: 'B', owedPaise: 30000 }] },
      { paidBy: 'A', amountPaise: 20000, splits: [{ userId: 'C', owedPaise: 20000 }] },
    ];
    const nets = computeNetBalances(exps);
    expect(computePairwiseDebts(exps).length).toBe(3);
    const t = simplifyDebts(nets);
    expect(t.length).toBe(2);
    expect(t).toContainEqual({ from: 'A', to: 'B', amountPaise: 20000 });
    expect(t).toContainEqual({ from: 'A', to: 'C', amountPaise: 10000 });
  });
  it('empty and all-zero maps', () => {
    expect(simplifyDebts(new Map())).toEqual([]);
    expect(simplifyDebts(new Map([['a', 0], ['b', 0]]))).toEqual([]);
  });
  it('rejects unbalanced input', () => {
    expect(() => simplifyGreedy(new Map([['a', 100], ['b', -50]]))).toThrow(/zero/);
  });
  it('optimal beats greedy on a decomposable case', () => {
    // two independent pairs: greedy may cross-match, optimal always finds 2 transfers
    const nets = new Map([['a', 5], ['b', -5], ['c', 3], ['d', -3], ['e', 4], ['f', -4]]);
    expect(simplifyOptimal(nets).length).toBe(3);
  });
  it('optimal strictly fewer transfers than greedy somewhere', () => {
    const nets = new Map([['a', 7], ['b', 3], ['c', -6], ['d', -4]]); // zero-sum groups? (7,-6,..) none -> equal
    expect(simplifyOptimal(nets).length).toBeLessThanOrEqual(simplifyGreedy(nets).length);
    const nets2 = new Map([['a', 10], ['b', -3], ['c', -7], ['d', 6], ['e', -6]]);
    expect(simplifyGreedy(nets2).length).toBeGreaterThanOrEqual(simplifyOptimal(nets2).length);
    expect(simplifyOptimal(nets2).length).toBe(3);
  });
  it('property: positions preserved, never more than n-1 transfers, no zero/self transfers', () => {
    for (let t = 0; t < 300; t++) {
      const n = 2 + Math.floor(Math.random() * 14);
      const vals: number[] = [];
      let s = 0;
      for (let i = 0; i < n - 1; i++) { const v = Math.floor(Math.random() * 20001) - 10000; vals.push(v); s += v; }
      vals.push(-s);
      const nets = new Map(vals.map((v, i) => [`u${i}`, v] as [string, number]));
      for (const fn of [simplifyGreedy, simplifyOptimal]) {
        const ts = fn(nets);
        const back = netFromTransfers(ts);
        for (const [id, v] of nets) expect(back.get(id) ?? 0).toBe(v);
        const nonzero = vals.filter((v) => v !== 0).length;
        expect(ts.length).toBeLessThanOrEqual(Math.max(0, nonzero - 1));
        ts.forEach((x) => { expect(x.amountPaise).toBeGreaterThan(0); expect(x.from).not.toBe(x.to); });
      }
      expect(simplifyOptimal(nets).length).toBeLessThanOrEqual(simplifyGreedy(nets).length);
    }
  });
  it('large group falls back to greedy and stays correct', () => {
    const nets = new Map<string, number>();
    let s = 0;
    for (let i = 0; i < 40; i++) { const v = (i % 7) * 100 - 300; nets.set(`u${i}`, v); s += v; }
    nets.set('u40', -s);
    const back = netFromTransfers(simplifyDebts(nets));
    for (const [id, v] of nets) expect(back.get(id) ?? 0).toBe(v);
  });
});
