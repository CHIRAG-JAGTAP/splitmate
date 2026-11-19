/**
 * Money helpers. ALL money in SplitMate is an integer number of paise (1 INR = 100 paise).
 * We never use floating point for stored or computed money.
 */
export class EngineError extends Error {
  constructor(message: string, public code = 'ENGINE_ERROR') {
    super(message);
    this.name = 'EngineError';
  }
}

export const isPaise = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

export function assertPositivePaise(n: unknown, label = 'amount'): asserts n is number {
  if (!isPaise(n) || n <= 0) throw new EngineError(`${label} must be a positive integer number of paise`, 'INVALID_AMOUNT');
}

/** Convert a rupee decimal string/number (e.g. "12.5") to paise using string maths (no float drift). */
export function rupeesToPaise(input: string | number): number {
  const s = String(input).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new EngineError(`Invalid rupee amount "${s}"`, 'INVALID_AMOUNT');
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return neg ? -paise : paise;
}

export function paiseToRupees(p: number): string {
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Largest-remainder allocation.
 * Splits `total` paise across `weights` (non-negative integers) so that:
 *   1. every share is an integer,
 *   2. the shares sum EXACTLY to `total`,
 *   3. each share differs from the ideal real-valued share by less than 1 paisa.
 * Ties on remainders are broken by index so the result is deterministic.
 * Uses BigInt internally so total*weight can never overflow 2^53.
 */
export function allocateByWeights(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new EngineError('total must be a non-negative integer', 'INVALID_AMOUNT');
  if (weights.length === 0) throw new EngineError('At least one participant is required', 'NO_PARTICIPANTS');
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) throw new EngineError('weights must be non-negative integers', 'INVALID_WEIGHT');
  const sumW = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (sumW === 0n) throw new EngineError('At least one weight must be positive', 'INVALID_WEIGHT');
  const T = BigInt(total);
  const base: number[] = [];
  const rem: { i: number; r: bigint }[] = [];
  let assigned = 0n;
  weights.forEach((w, i) => {
    const num = T * BigInt(w);
    const q = num / sumW;
    base.push(Number(q));
    assigned += q;
    rem.push({ i, r: num % sumW });
  });
  let leftover = Number(T - assigned);
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; k < leftover; k++) base[rem[k].i] += 1;
  return base;
}
