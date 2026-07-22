import { describe, expect, it } from 'vitest';
import {
  C,
  C_49_6,
  P_CONSECUTIVE,
  P_REPEAT_PREV,
  P_SPECIFIC_TRIPLE,
  P_BIRTHDAY_SHARE,
  hypergeomPmf,
  sumDistribution,
  evenOddDist,
  lowHighDist,
} from '../src/server/lib/theory.js';

// Every expected value below was cross-checked independently with a throwaway BigInt
// script (see this conversation's transcript), not hand-derived from theory.js itself —
// avoids the "test just restates the implementation" trap.

describe('C(n,k) — exact binomial coefficient in doubles', () => {
  it('C(49,6) === 13983816 EXACTLY (toBe, not toBeCloseTo)', () => {
    expect(C(49, 6)).toBe(13983816);
    expect(C_49_6).toBe(13983816);
  });

  it('matches known exact values used elsewhere in the app', () => {
    expect(C(44, 6)).toBe(7059052);
    expect(C(43, 6)).toBe(6096454);
    expect(C(46, 3)).toBe(15180);
    expect(C(47, 4)).toBe(178365);
    expect(C(43, 3)).toBe(12341);
  });

  it('boundary cases: C(n,0)=1, C(n,n)=1, C(n,k)=0 for k<0 or k>n', () => {
    expect(C(49, 0)).toBe(1);
    expect(C(49, 49)).toBe(1);
    expect(C(49, -1)).toBe(0);
    expect(C(49, 50)).toBe(0);
  });

  it('symmetry: C(n,k) === C(n,n-k)', () => {
    expect(C(49, 6)).toBe(C(49, 43));
  });
});

describe('CONVENTIONS anchors — combinatorial constants', () => {
  it('P_CONSECUTIVE = 1 - C(44,6)/C(49,6) ≈ 0.4952', () => {
    expect(P_CONSECUTIVE).toBeCloseTo(0.4951984494075151, 12);
    expect(P_CONSECUTIVE).toBeCloseTo(0.4952, 4);
  });

  it('P_REPEAT_PREV = 1 - C(43,6)/C(49,6) ≈ 0.5638', () => {
    expect(P_REPEAT_PREV).toBeCloseTo(0.5640350244883086, 12);
    expect(P_REPEAT_PREV).toBeCloseTo(0.5638, 3);
  });

  it('P_SPECIFIC_TRIPLE = C(46,3)/C(49,6) = 120/110544', () => {
    expect(P_SPECIFIC_TRIPLE).toBeCloseTo(120 / 110544, 15);
  });

  it('P_BIRTHDAY_SHARE = 31/49 ≈ 0.6327 (theoretical share of numbers <=31 in a draw)', () => {
    expect(P_BIRTHDAY_SHARE).toBeCloseTo(31 / 49, 15);
    expect(P_BIRTHDAY_SHARE).toBeCloseTo(0.6327, 4);
  });
});

describe('hypergeomPmf(k) — N=49,K=6,n=6 default (coupon hits distribution)', () => {
  it('matches the exact CONVENTIONS anchors for k=3,4,5,6', () => {
    expect(hypergeomPmf(3)).toBeCloseTo(246820 / 13983816, 15);
    expect(hypergeomPmf(4)).toBeCloseTo(13545 / 13983816, 15);
    expect(hypergeomPmf(5)).toBeCloseTo(258 / 13983816, 15);
    expect(hypergeomPmf(6)).toBeCloseTo(1 / 13983816, 15);
  });

  it('sums to 1 over k=0..6', () => {
    let sum = 0;
    for (let k = 0; k <= 6; k++) sum += hypergeomPmf(k);
    expect(sum).toBeCloseTo(1, 12);
  });

  it('E[hits] = sum(k * P(k)) = 36/49 ≈ 0.7347 (CONVENTIONS anchor)', () => {
    let expected = 0;
    for (let k = 0; k <= 6; k++) expected += k * hypergeomPmf(k);
    expect(expected).toBeCloseTo(36 / 49, 10);
  });

  it('accepts custom N/K/n (generic hypergeometric, used by evenOddDist/lowHighDist)', () => {
    // P(0 successes) drawing 6 from a population where K=0 successes exist -> always 0
    expect(hypergeomPmf(0, { N: 49, K: 0, n: 6 })).toBe(1);
    expect(hypergeomPmf(1, { N: 49, K: 0, n: 6 })).toBe(0);
  });
});

describe('sumDistribution() — DP over 6-element subsets of 1..49', () => {
  const dist = sumDistribution();

  it('sums to C(49,6) EXACTLY — the beautiful exactness check', () => {
    const total = dist.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(13983816);
  });

  it('only covers achievable sums 21..279 (min = 1+2+..+6, max = 44+..+49)', () => {
    const sums = dist.map((r) => r.sum);
    expect(Math.min(...sums)).toBe(21);
    expect(Math.max(...sums)).toBe(279);
  });

  it('sum=21 (only {1,2,3,4,5,6}) and sum=279 (only {44,45,46,47,48,49}) have count 1', () => {
    expect(dist.find((r) => r.sum === 21).count).toBe(1);
    expect(dist.find((r) => r.sum === 279).count).toBe(1);
  });

  it('is symmetric around the mean sum 150 (count(150-d) === count(150+d))', () => {
    // sum s and sum (21+279-s) = (300-s) are symmetric under n -> 50-n substitution
    for (const d of [1, 10, 50, 100]) {
      const lo = dist.find((r) => r.sum === 150 - d);
      const hi = dist.find((r) => r.sum === 150 + d);
      expect(lo.count).toBe(hi.count);
    }
  });

  it('the mean sum weighted by count is exactly 150 (CONVENTIONS anchor)', () => {
    const total = dist.reduce((s, r) => s + r.count, 0);
    const weightedSum = dist.reduce((s, r) => s + r.sum * r.count, 0);
    expect(weightedSum / total).toBeCloseTo(150, 9);
  });
});

describe('evenOddDist() — hypergeometric, 24 even / 25 odd numbers in 1..49', () => {
  const dist = evenOddDist();

  it('has 7 rows (evens=0..6), probabilities sum to 1', () => {
    expect(dist).toHaveLength(7);
    const sum = dist.reduce((s, r) => s + r.probability, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it('evens + odds === 6 for every row', () => {
    for (const row of dist) expect(row.evens + row.odds).toBe(6);
  });

  it('matches hypergeomPmf(k, {K: 24}) directly', () => {
    for (const row of dist) {
      expect(row.probability).toBeCloseTo(hypergeomPmf(row.evens, { N: 49, K: 24, n: 6 }), 15);
    }
  });
});

describe('lowHighDist() — hypergeometric, 24 low (1-24) / 25 high (25-49) numbers', () => {
  const dist = lowHighDist();

  it('has 7 rows (low=0..6), probabilities sum to 1', () => {
    expect(dist).toHaveLength(7);
    const sum = dist.reduce((s, r) => s + r.probability, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it('low + high === 6 for every row', () => {
    for (const row of dist) expect(row.low + row.high).toBe(6);
  });

  it('matches hypergeomPmf(k, {K: 24}) directly (same K as evenOddDist by coincidence of range sizes)', () => {
    for (const row of dist) {
      expect(row.probability).toBeCloseTo(hypergeomPmf(row.low, { N: 49, K: 24, n: 6 }), 15);
    }
  });
});
