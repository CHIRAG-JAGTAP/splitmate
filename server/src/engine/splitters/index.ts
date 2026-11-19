import { EngineError, allocateByWeights, assertPositivePaise, isPaise } from '../money.js';

export const SPLIT_METHODS = ['equal', 'exact', 'percentage', 'shares', 'unequal'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export interface SplitParticipant {
  userId: string;
  /** equal: ignored | exact: paise | percentage: percent (max 2 decimals) | shares: positive number (max 2 decimals) | unequal: +/- adjustment in paise */
  value?: number;
}
export interface SplitResult {
  userId: string;
  owedPaise: number;
  inputValue?: number;
}

function checkParticipants(ps: SplitParticipant[]) {
  if (!Array.isArray(ps) || ps.length === 0) throw new EngineError('Select at least one participant', 'NO_PARTICIPANTS');
  const seen = new Set<string>();
  for (const p of ps) {
    if (!p.userId) throw new EngineError('Participant is missing userId', 'INVALID_PARTICIPANT');
    if (seen.has(p.userId)) throw new EngineError('Duplicate participant', 'DUPLICATE_PARTICIPANT');
    seen.add(p.userId);
  }
}

/** Convert a decimal with <=2 places to an integer by x100 without float drift. */
function toHundredths(v: number, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EngineError(`${label} must be a number`, 'INVALID_VALUE');
  const scaled = Math.round(v * 100);
  if (Math.abs(scaled - v * 100) > 1e-6) throw new EngineError(`${label} supports at most 2 decimal places`, 'INVALID_VALUE');
  return scaled;
}

export function equalSplit(total: number, ps: SplitParticipant[]): SplitResult[] {
  const alloc = allocateByWeights(total, ps.map(() => 1));
  return ps.map((p, i) => ({ userId: p.userId, owedPaise: alloc[i] }));
}

export function exactSplit(total: number, ps: SplitParticipant[]): SplitResult[] {
  let sum = 0;
  const out = ps.map((p) => {
    if (!isPaise(p.value) || p.value < 0) throw new EngineError('Exact amounts must be non-negative integers (paise)', 'INVALID_VALUE');
    sum += p.value;
    return { userId: p.userId, owedPaise: p.value, inputValue: p.value };
  });
  if (sum !== total) throw new EngineError(`Exact amounts add up to ${sum} paise but the expense is ${total} paise`, 'SUM_MISMATCH');
  return out;
}

export function percentageSplit(total: number, ps: SplitParticipant[]): SplitResult[] {
  const bps = ps.map((p) => {
    const h = toHundredths(p.value as number, 'Percentage');
    if (h < 0) throw new EngineError('Percentage cannot be negative', 'INVALID_VALUE');
    return h;
  });
  const sum = bps.reduce((a, b) => a + b, 0);
  if (sum !== 10000) throw new EngineError(`Percentages must add up to 100 (got ${sum / 100})`, 'SUM_MISMATCH');
  const alloc = allocateByWeights(total, bps);
  return ps.map((p, i) => ({ userId: p.userId, owedPaise: alloc[i], inputValue: p.value }));
}

export function sharesSplit(total: number, ps: SplitParticipant[]): SplitResult[] {
  const w = ps.map((p) => {
    const h = toHundredths(p.value as number, 'Shares');
    if (h < 0) throw new EngineError('Shares cannot be negative', 'INVALID_VALUE');
    return h;
  });
  if (w.every((x) => x === 0)) throw new EngineError('At least one participant needs a positive share', 'INVALID_VALUE');
  const alloc = allocateByWeights(total, w);
  return ps.map((p, i) => ({ userId: p.userId, owedPaise: alloc[i], inputValue: p.value }));
}

/**
 * "Unequal" = equal split with per-person adjustments (like Splitwise "adjustment").
 * Each person's adjustment (+/- paise) is added to their share; the REMAINDER
 * (total - sum of adjustments) is divided equally. Example: 1000 total, A +100 -> A pays 100 extra,
 * the remaining 900 is split equally.
 */
export function unequalSplit(total: number, ps: SplitParticipant[]): SplitResult[] {
  let adjSum = 0;
  const adj = ps.map((p) => {
    const v = p.value ?? 0;
    if (!Number.isSafeInteger(v)) throw new EngineError('Adjustments must be integers (paise)', 'INVALID_VALUE');
    adjSum += v;
    return v;
  });
  const remainder = total - adjSum;
  if (remainder < 0) throw new EngineError('Adjustments exceed the expense total', 'SUM_MISMATCH');
  const alloc = allocateByWeights(remainder, ps.map(() => 1));
  const out = ps.map((p, i) => ({ userId: p.userId, owedPaise: alloc[i] + adj[i], inputValue: p.value ?? 0 }));
  if (out.some((o) => o.owedPaise < 0)) throw new EngineError('An adjustment makes a participant owe a negative amount', 'INVALID_VALUE');
  return out;
}

/** Single entry point. Always verifies that allocations sum to the total (defence in depth). */
export function calculateSplit(method: SplitMethod, totalPaise: number, participants: SplitParticipant[]): SplitResult[] {
  assertPositivePaise(totalPaise, 'Expense amount');
  checkParticipants(participants);
  let out: SplitResult[];
  switch (method) {
    case 'equal': out = equalSplit(totalPaise, participants); break;
    case 'exact': out = exactSplit(totalPaise, participants); break;
    case 'percentage': out = percentageSplit(totalPaise, participants); break;
    case 'shares': out = sharesSplit(totalPaise, participants); break;
    case 'unequal': out = unequalSplit(totalPaise, participants); break;
    default: throw new EngineError(`Unknown split method "${method as string}"`, 'INVALID_METHOD');
  }
  const sum = out.reduce((a, b) => a + b.owedPaise, 0);
  if (sum !== totalPaise) throw new EngineError('Internal error: split does not equal expense total', 'INVARIANT');
  return out;
}
