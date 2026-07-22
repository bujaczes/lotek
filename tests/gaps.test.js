import { describe, expect, it } from 'vitest';
import { computeGapDistribution, geometricGapCurve, P_NUMBER_DRAWN } from '../src/server/lib/gaps.js';

// Hand-computed 7-draw synthetic set. Number 1 occurs at draws 1,2,4,7 -> completed gaps
// (2-1-1)=0, (4-2-1)=1, (7-4-1)=2. Number 23 occurs at draws 5,6 -> gap (6-5-1)=0. Every
// other number occurs exactly once (no completed gap). Total completed gaps = 4.
const DRAWS = [
  { drawNumber: 1, numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 2, numbers: [1, 7, 8, 9, 10, 11] },
  { drawNumber: 3, numbers: [12, 13, 14, 15, 16, 17] },
  { drawNumber: 4, numbers: [1, 18, 19, 20, 21, 22] },
  { drawNumber: 5, numbers: [23, 24, 25, 26, 27, 28] },
  { drawNumber: 6, numbers: [23, 29, 30, 31, 32, 33] },
  { drawNumber: 7, numbers: [1, 34, 35, 36, 37, 38] },
];

describe('computeGapDistribution (pure) — hand-computed synthetic set', () => {
  const result = computeGapDistribution(DRAWS);

  it('counts exactly 4 completed gaps total (3 from number 1, 1 from number 23)', () => {
    expect(result.total).toBe(4);
  });

  it('maxGap is 2 (number 1s longest completed gap)', () => {
    expect(result.maxGap).toBe(2);
  });

  it('histogram: gap 0 -> 2 occurrences, gap 1 -> 1, gap 2 -> 1, covering every integer 0..maxGap', () => {
    expect(result.histogram).toEqual([
      { gap: 0, count: 2 },
      { gap: 1, count: 1 },
      { gap: 2, count: 1 },
    ]);
  });

  it('histogram counts sum to `total`', () => {
    const sum = result.histogram.reduce((s, r) => s + r.count, 0);
    expect(sum).toBe(result.total);
  });
});

describe('computeGapDistribution — no completed gaps (every number appears at most once)', () => {
  it('total=0, maxGap=0, histogram is a single all-zero gap-0 bucket', () => {
    const draws = [
      { drawNumber: 1, numbers: [1, 2, 3, 4, 5, 6] },
      { drawNumber: 2, numbers: [7, 8, 9, 10, 11, 12] },
    ];
    const result = computeGapDistribution(draws);
    expect(result.total).toBe(0);
    expect(result.maxGap).toBe(0);
    expect(result.histogram).toEqual([{ gap: 0, count: 0 }]);
  });

  it('empty history: total=0, maxGap=0', () => {
    const result = computeGapDistribution([]);
    expect(result.total).toBe(0);
    expect(result.maxGap).toBe(0);
  });
});

describe('geometricGapCurve — P(gap=g) = p(1-p)^g scaled to totalObservations', () => {
  it('P_NUMBER_DRAWN constant is 6/49 (one number among 6 drawn out of 49)', () => {
    expect(P_NUMBER_DRAWN).toBeCloseTo(6 / 49, 15);
  });

  it('g=0 term equals total*p exactly (curve is not shifted)', () => {
    const curve = geometricGapCurve(2, 4);
    expect(curve[0]).toEqual({ gap: 0, expected: 4 * P_NUMBER_DRAWN });
  });

  it('matches the exact hand-computed values for total=4, maxGap=2, p=6/49', () => {
    const curve = geometricGapCurve(2, 4);
    const p = 6 / 49;
    expect(curve).toHaveLength(3);
    expect(curve[0].expected).toBeCloseTo(4 * p, 12);
    expect(curve[1].expected).toBeCloseTo(4 * p * (1 - p), 12);
    expect(curve[2].expected).toBeCloseTo(4 * p * (1 - p) ** 2, 12);
  });

  it('partial sum over 0..maxGap matches the closed-form geometric partial-sum identity', () => {
    const total = 4;
    const maxGap = 2;
    const p = 6 / 49;
    const curve = geometricGapCurve(maxGap, total);
    const sum = curve.reduce((s, r) => s + r.expected, 0);
    expect(sum).toBeCloseTo(total * (1 - (1 - p) ** (maxGap + 1)), 10);
  });

  it('over a large maxGap the partial sum approaches totalObservations (geometric series sums to 1)', () => {
    const total = 1000;
    const curve = geometricGapCurve(200, total);
    const sum = curve.reduce((s, r) => s + r.expected, 0);
    expect(sum).toBeCloseTo(total, 6);
  });

  it('totalObservations=0 yields an all-zero curve, not NaN', () => {
    const curve = geometricGapCurve(3, 0);
    expect(curve.every((r) => r.expected === 0)).toBe(true);
  });
});
