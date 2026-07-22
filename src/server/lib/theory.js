const MAX_NUMBER = 49;
const NUMBERS_PER_DRAW = 6;
const EVEN_COUNT = 24; // 2,4,...,48 in 1..49
const LOW_COUNT = 24; // 1..24 (the "low half" of 1..49)
const BIRTHDAY_COUNT = 31; // 1..31, the "birthday" range (day-of-month/month coupons)

/**
 * Pure combinatorics/probability module — no DB, no I/O. Every constant/function here is
 * one of the "kotwice matematyczne" from docs/CONVENTIONS.md; asserted to high precision
 * (or exact equality where the math guarantees it) in tests/theory.test.js.
 */

/**
 * Exact binomial coefficient C(n,k), computed in doubles via the standard multiplicative
 * recurrence C(n,k) = prod_{i=1..k} (n-k+i)/i. Each partial product is the (integral)
 * value C(n-k+i, i), and for our ranges (n<=49) every such value stays far below 2^53 —
 * so both the multiply and the divide at each step round to the exact mathematical
 * integer, not an approximation. Verified in tests/theory.test.js via `toBe` (not
 * `toBeCloseTo`) against independently-computed BigInt values.
 */
export function C(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

export const C_49_6 = C(MAX_NUMBER, NUMBERS_PER_DRAW);

/** P(>=1 pair of consecutive numbers in a draw) = 1 - C(44,6)/C(49,6) ≈ 0.4952. */
export const P_CONSECUTIVE = 1 - C(44, 6) / C_49_6;

/** P(>=1 number shared with the immediately preceding draw) = 1 - C(43,6)/C(49,6) ≈ 0.5638. */
export const P_REPEAT_PREV = 1 - C(43, 6) / C_49_6;

/**
 * P(a specific 3-number subset is fully contained in a random draw) = C(46,3)/C(49,6),
 * which simplifies to 6*5*4 / (49*48*47) = 120/110544 — used as the "expected" baseline
 * for the top-15 triples endpoint (expected = drawsCount * P_SPECIFIC_TRIPLE).
 */
export const P_SPECIFIC_TRIPLE = C(46, 3) / C_49_6;

/**
 * Theoretical "urodzinowość" (birthday-ness) share: E[# of the 6 drawn numbers that are
 * <=31] / 6 = (6*31/49)/6 = 31/49 ≈ 0.6327.
 */
export const P_BIRTHDAY_SHARE = BIRTHDAY_COUNT / MAX_NUMBER;

/**
 * Hypergeometric pmf: P(exactly k successes) drawing n items from a population of N that
 * contains K successes. Defaults to N=49,K=6,n=6 — "how many of my 6 chosen numbers hit"
 * — which reproduces the CONVENTIONS anchors P(3)=246820/13983816, P(4)=13545/13983816,
 * P(5)=258/13983816, P(6)=1/13983816. Also reused (with a different K) by evenOddDist()
 * and lowHighDist() below.
 */
export function hypergeomPmf(k, { N = MAX_NUMBER, K = NUMBERS_PER_DRAW, n = NUMBERS_PER_DRAW } = {}) {
  return (C(K, k) * C(N - K, n - k)) / C(N, n);
}

const MIN_SUM = 1 + 2 + 3 + 4 + 5 + 6; // 21
const MAX_SUM = 44 + 45 + 46 + 47 + 48 + 49; // 279

/**
 * DP over subsets: dp[j][s] = number of j-element subsets of {1..49} summing to s.
 * Standard 0/1-knapsack-style counting DP (iterate numbers outermost, k and s descending
 * so each number is used at most once). Returns one row per achievable sum (21..279)
 * with its EXACT count (every dp value here is a plain integer well under 2^53, so no
 * floating error accumulates through the additions). Σcount === C(49,6) exactly — the
 * "beautiful exactness check" the brief calls for, asserted with `toBe` in
 * tests/theory.test.js.
 */
export function sumDistribution() {
  const K = NUMBERS_PER_DRAW;
  const dp = Array.from({ length: K + 1 }, () => new Array(MAX_SUM + 1).fill(0));
  dp[0][0] = 1;
  for (let num = 1; num <= MAX_NUMBER; num++) {
    for (let k = Math.min(K, num); k >= 1; k--) {
      for (let s = MAX_SUM; s >= num; s--) {
        if (dp[k - 1][s - num] !== 0) dp[k][s] += dp[k - 1][s - num];
      }
    }
  }
  const rows = [];
  for (let s = MIN_SUM; s <= MAX_SUM; s++) {
    if (dp[K][s] !== 0) rows.push({ sum: s, count: dp[K][s] });
  }
  return rows;
}

/**
 * Hypergeometric pmf of "how many of the 6 drawn numbers are even" — 24 even numbers
 * (2,4,...,48) among 49. Rows for evens=0..6 (odds = 6-evens implied).
 */
export function evenOddDist() {
  const rows = [];
  for (let k = 0; k <= NUMBERS_PER_DRAW; k++) {
    rows.push({ evens: k, odds: NUMBERS_PER_DRAW - k, probability: hypergeomPmf(k, { K: EVEN_COUNT }) });
  }
  return rows;
}

/**
 * Hypergeometric pmf of "how many of the 6 drawn numbers are low (1-24)" — 24 low numbers
 * among 49 (high = 25-49, 25 numbers). Rows for low=0..6 (high = 6-low implied).
 */
export function lowHighDist() {
  const rows = [];
  for (let k = 0; k <= NUMBERS_PER_DRAW; k++) {
    rows.push({ low: k, high: NUMBERS_PER_DRAW - k, probability: hypergeomPmf(k, { K: LOW_COUNT }) });
  }
  return rows;
}
