# Algorithms and Complexity

## 1. Largest-remainder allocation (`engine/money.ts`)
Split T paise by integer weights w₁..wₙ (W = Σwᵢ). Give each person ⌊T·wᵢ/W⌋, then hand the leftover paise (fewer than n) one each to the largest fractional remainders (ties by index). BigInt avoids overflow.
Guarantees: Σ shares = T exactly; each share is within 1 paisa of the ideal. Time O(n log n), space O(n).

## 2. Five split methods (`engine/splitters`)
| Method | Input per person | Rule |
|---|---|---|
| Equal | none | weights all 1 |
| Exact | paise | must sum to total |
| Percentage | % (≤2 dp) | must sum to 100; weights = hundredths |
| Shares | positive number (≤2 dp) | weights = shares ×100 |
| Unequal | ± adjustment (paise) | remainder after adjustments split equally |

## 3. Balances (`engine/balances.ts`)
net(u) = Σpaid − Σowed + settlementsPaid − settlementsReceived. Σnet = 0 always. Only **completed** settlements count.

## 4. Debt simplification (`engine/simplify.ts`)
Only each person's net position matters, not who paid whom.
- **Greedy:** two max-heaps (debtors, creditors); repeatedly settle the largest debtor against the largest creditor. Every step clears at least one person → ≤ n−1 transfers. **O(n log n) time, O(n) space.**
- **Optimal:** minimum transfers = (non-zero people) − (max number of disjoint zero-sum groups). Finding the maximum partition is NP-hard (subset-sum family). Bitmask DP over subsets, **O(2ⁿ·n)**, used for n ≤ 16; larger groups fall back to greedy.
- Example: A→B 500, B→C 300, C→A 200 gives nets A −300, B +200, C +100, so 2 transfers (A→B 200, A→C 100) instead of 3.
- Tested: classic example, empty/zero maps, unbalanced input rejection, 300 random groups checking that every position is preserved and transfers ≤ n−1, and optimal ≤ greedy.
