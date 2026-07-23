import { describe, expect, it } from 'vitest';
import {
  buildScorecard,
  sigmaBand,
  HITS_VARIANCE,
  EXPECTED_HITS_PER_COUPON,
} from '../src/server/lib/scorecard.js';
import { hypergeomPmf } from '../src/server/lib/theory.js';

const PRIZES = { '3': 24, '4': 200, '5': 6000, '6': 2000000, betPrice: 3.0 };

// Three evaluated predictions, one with numbers >= 33 (high mask bits) to prove the
// aggregation carries the SQL-computed hits through untouched:
//   P1 nr 100: 3 hits (IV stopień) -> 24 zł
//   P2 nr 101: 5 hits (II stopień) -> 6000 zł, all numbers in {33..49}
//   P3 nr 102: 0 hits -> 0 zł
const PREDICTIONS = [
  { forDrawNumber: 100, date: '2026-07-01', numbers: [1, 2, 3, 4, 5, 6], hits: 3, prizeTier: 4 },
  { forDrawNumber: 101, date: '2026-07-04', numbers: [33, 34, 35, 44, 45, 49], hits: 5, prizeTier: 2 },
  { forDrawNumber: 102, date: '2026-07-08', numbers: [1, 2, 3, 4, 5, 6], hits: 0, prizeTier: null },
];

describe('single-coupon hit variance (from the exact hypergeometric pmf)', () => {
  it('equals the value derivable from theory.js (frozen anchor)', () => {
    // Recompute independently from theory.js: Var = Σ_{h=0..6} (h − 36/49)²·P(h).
    let v = 0;
    for (let h = 0; h <= 6; h++) v += (h - 36 / 49) ** 2 * hypergeomPmf(h);
    expect(HITS_VARIANCE).toBeCloseTo(v, 15);
    // Documented, frozen decimal.
    expect(HITS_VARIANCE).toBeCloseTo(0.5775718450645565, 15);
  });

  it('equals the hypergeometric closed form n·(K/N)·((N−K)/N)·((N−n)/(N−1))', () => {
    const closed = 6 * (6 / 49) * (43 / 49) * (43 / 48);
    expect(HITS_VARIANCE).toBeCloseTo(closed, 15);
  });

  it('E[hits] per coupon is exactly 36/49', () => {
    expect(EXPECTED_HITS_PER_COUPON).toBe(36 / 49);
  });
});

describe('sigmaBand(k) = 2·√(k·Var)', () => {
  it('widens with √k', () => {
    expect(sigmaBand(1)).toBeCloseTo(2 * Math.sqrt(HITS_VARIANCE), 15);
    expect(sigmaBand(3)).toBeCloseTo(2 * Math.sqrt(3 * HITS_VARIANCE), 15);
    // √4 = 2·√1, so band(4) is exactly twice band(1)
    expect(sigmaBand(4)).toBeCloseTo(2 * sigmaBand(1), 12);
  });
  it('is 0 at k=0', () => {
    expect(sigmaBand(0)).toBe(0);
  });
});

describe('buildScorecard(predictions, prizes)', () => {
  const card = buildScorecard(PREDICTIONS, PRIZES);

  it('perPrediction echoes each evaluated pick', () => {
    expect(card.perPrediction).toEqual([
      { forDrawNumber: 100, date: '2026-07-01', numbers: [1, 2, 3, 4, 5, 6], hits: 3, prizeTier: 4 },
      { forDrawNumber: 101, date: '2026-07-04', numbers: [33, 34, 35, 44, 45, 49], hits: 5, prizeTier: 2 },
      { forDrawNumber: 102, date: '2026-07-08', numbers: [1, 2, 3, 4, 5, 6], hits: 0, prizeTier: null },
    ]);
  });

  it('cumulative: hand-computed cumHits, expected=k·36/49, band=±2√(kVar)', () => {
    expect(card.cumulative.map((c) => c.k)).toEqual([1, 2, 3]);
    expect(card.cumulative.map((c) => c.cumHits)).toEqual([3, 8, 8]);
    expect(card.cumulative[0].expected).toBeCloseTo(1 * (36 / 49), 12);
    expect(card.cumulative[1].expected).toBeCloseTo(2 * (36 / 49), 12);
    expect(card.cumulative[2].expected).toBeCloseTo(3 * (36 / 49), 12);
    expect(card.cumulative[0].sigmaBand).toBeCloseTo(2 * Math.sqrt(1 * HITS_VARIANCE), 12);
    expect(card.cumulative[2].sigmaBand).toBeCloseTo(2 * Math.sqrt(3 * HITS_VARIANCE), 12);
    // carries the draw number for the x-axis
    expect(card.cumulative[1].forDrawNumber).toBe(101);
  });

  it('distribution: observed counts 0..6 and expected = pmf·k that sums to k', () => {
    expect(card.distribution.observed).toEqual({ 0: 1, 1: 0, 2: 0, 3: 1, 4: 0, 5: 1, 6: 0 });
    for (let h = 0; h <= 6; h++) {
      expect(card.distribution.expected[h]).toBeCloseTo(hypergeomPmf(h) * 3, 12);
    }
    const total = Object.values(card.distribution.expected).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(3, 10);
    const obsTotal = Object.values(card.distribution.observed).reduce((a, b) => a + b, 0);
    expect(obsTotal).toBe(3);
  });

  it('balance: cost=k·betPrice, winnings from prize config by hits, net', () => {
    expect(card.balance.cost).toBeCloseTo(3 * 3.0, 12); // 9
    expect(card.balance.winnings).toBe(24 + 6000 + 0); // 6024
    expect(card.balance.net).toBeCloseTo(6024 - 9, 12); // 6015
  });

  it('exposes the frozen variance + expected-per-coupon + evaluated count', () => {
    expect(card.variance).toBeCloseTo(0.5775718450645565, 15);
    expect(card.expectedPerCoupon).toBe(36 / 49);
    expect(card.evaluatedCount).toBe(3);
  });
});

describe('buildScorecard — empty (k=0) shape', () => {
  const card = buildScorecard([], PRIZES);

  it('returns empty arrays and zeroed aggregates, no crashing nulls', () => {
    expect(card.perPrediction).toEqual([]);
    expect(card.cumulative).toEqual([]);
    expect(card.evaluatedCount).toBe(0);
    for (let h = 0; h <= 6; h++) {
      expect(card.distribution.observed[h]).toBe(0);
      expect(card.distribution.expected[h]).toBe(0); // pmf·0
    }
    expect(card.balance).toEqual({ cost: 0, winnings: 0, net: 0 });
  });
});
