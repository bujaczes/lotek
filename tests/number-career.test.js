import { describe, expect, it } from 'vitest';
import { zScoreCheckpoints, numberGapHistogram } from '../src/server/lib/number-career.js';

// Hand-built 250-draw synthetic history where number 7 occurs in every draw whose
// drawNumber is a multiple of 3 (draws 3,6,9,...,249 -> 83 occurrences total). This gives
// clean, hand-computable checkpoint counts at k=100 (occurrences = floor(100/3)=33) and
// k=200 (floor(200/3)=66).
function buildDraws(n) {
  const draws = [];
  for (let i = 1; i <= n; i++) {
    const numbers = i % 3 === 0 ? [7, 10, 20, 30, 40, 49] : [1, 10, 20, 30, 40, 49];
    draws.push({ drawNumber: i, drawnAt: `2020-01-${String(((i - 1) % 28) + 1).padStart(2, '0')}`, numbers });
  }
  return draws;
}

function zScoreFormula(c, k) {
  return (c - (k * 6) / 49) / Math.sqrt(k * 6 * (1 / 49) * (48 / 49));
}

describe('zScoreCheckpoints(draws, number, step=100)', () => {
  const draws = buildDraws(250);
  const series = zScoreCheckpoints(draws, 7);

  it('emits one checkpoint per complete multiple of `step` (2 checkpoints for 250 draws, step=100)', () => {
    expect(series).toHaveLength(2);
    expect(series.map((r) => r.k)).toEqual([100, 200]);
  });

  it('count at k=100 is floor(100/3)=33, at k=200 is floor(200/3)=66', () => {
    expect(series[0].count).toBe(33);
    expect(series[1].count).toBe(66);
  });

  it('zScore matches the standard z-score formula at each checkpoint', () => {
    expect(series[0].zScore).toBeCloseTo(zScoreFormula(33, 100), 10);
    expect(series[1].zScore).toBeCloseTo(zScoreFormula(66, 200), 10);
  });

  it('drawNumber/drawnAt at each checkpoint match the draw at that index', () => {
    expect(series[0].drawNumber).toBe(100);
    expect(series[1].drawNumber).toBe(200);
  });

  it('custom step is honored (step=50 on a 120-draw history -> checkpoints at 50 and 100)', () => {
    const shortSeries = zScoreCheckpoints(buildDraws(120), 7, 50);
    expect(shortSeries.map((r) => r.k)).toEqual([50, 100]);
  });

  it('fewer draws than `step` yields an empty series, not an error', () => {
    expect(zScoreCheckpoints(buildDraws(50), 7)).toEqual([]);
  });
});

describe('numberGapHistogram(draws, number)', () => {
  // number 1 occurs at draws 1,2,4,7 -> completed gaps 0,1,2 (same derivation as
  // tests/gaps.test.js, but scoped to a single number instead of pooled across all 49).
  const draws = [
    { drawNumber: 1, numbers: [1, 2, 3, 4, 5, 6] },
    { drawNumber: 2, numbers: [1, 7, 8, 9, 10, 11] },
    { drawNumber: 3, numbers: [12, 13, 14, 15, 16, 17] },
    { drawNumber: 4, numbers: [1, 18, 19, 20, 21, 22] },
    { drawNumber: 5, numbers: [23, 24, 25, 26, 27, 28] },
    { drawNumber: 6, numbers: [23, 29, 30, 31, 32, 33] },
    { drawNumber: 7, numbers: [1, 34, 35, 36, 37, 38] },
  ];

  it('number 1: gaps [0,1,2], total=3, maxGap=2', () => {
    const { histogram, total, maxGap } = numberGapHistogram(draws, 1);
    expect(total).toBe(3);
    expect(maxGap).toBe(2);
    expect(histogram).toEqual([
      { gap: 0, count: 1 },
      { gap: 1, count: 1 },
      { gap: 2, count: 1 },
    ]);
  });

  it('number 23: single completed gap of 0', () => {
    const { histogram, total, maxGap } = numberGapHistogram(draws, 23);
    expect(total).toBe(1);
    expect(maxGap).toBe(0);
    expect(histogram).toEqual([{ gap: 0, count: 1 }]);
  });

  it('a number occurring 0 or 1 times has total=0, maxGap=0, single zero bucket', () => {
    const zero = numberGapHistogram(draws, 49);
    expect(zero.total).toBe(0);
    expect(zero.histogram).toEqual([{ gap: 0, count: 0 }]);

    const once = numberGapHistogram(draws, 12);
    expect(once.total).toBe(0);
    expect(once.histogram).toEqual([{ gap: 0, count: 0 }]);
  });
});
