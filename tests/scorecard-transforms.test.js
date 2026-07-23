import { describe, expect, it } from 'vitest';
import {
  bucketDistribution,
  bandSeries,
  scorecardVerdict,
} from '../src/charts/scorecard-transforms.js';

describe('bucketDistribution', () => {
  it('folds 3..6 into a single "3+" bucket for observed and expected', () => {
    const observed = { 0: 1, 1: 0, 2: 0, 3: 1, 4: 0, 5: 1, 6: 0 };
    const expected = { 0: 1.3, 1: 1.24, 2: 0.4, 3: 0.05, 4: 0.003, 5: 0.00005, 6: 0.0000002 };
    const out = bucketDistribution(observed, expected);
    expect(out.categories).toEqual(['0', '1', '2', '3+']);
    expect(out.observed).toEqual([1, 0, 0, 2]); // 1 (three-hit) + 1 (five-hit)
    expect(out.expected[3]).toBeCloseTo(0.05 + 0.003 + 0.00005 + 0.0000002, 10);
  });

  it('handles the empty (all-zero) distribution', () => {
    const zero = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const out = bucketDistribution(zero, zero);
    expect(out.observed).toEqual([0, 0, 0, 0]);
    expect(out.expected).toEqual([0, 0, 0, 0]);
  });
});

describe('bandSeries', () => {
  it('builds a stacked (lower, range) pair whose sum is the upper bound, clamped at 0', () => {
    const cumulative = [
      { k: 1, cumHits: 3, expected: 0.7347, sigmaBand: 1.52 }, // lower would be negative -> clamp 0
      { k: 2, cumHits: 8, expected: 1.4694, sigmaBand: 2.15 },
    ];
    const out = bandSeries(cumulative);
    expect(out.lower[0]).toBe(0); // max(0, 0.7347 - 1.52)
    expect(out.lower[1]).toBe(0); // max(0, 1.4694 - 2.15)
    expect(out.upper[0]).toBeCloseTo(0.7347 + 1.52, 10);
    expect(out.range[0]).toBeCloseTo(out.upper[0] - out.lower[0], 10);
    expect(out.range[1]).toBeCloseTo(out.upper[1] - out.lower[1], 10);
  });

  it('keeps a positive lower bound when the band does not reach 0', () => {
    const cumulative = [{ k: 20, cumHits: 15, expected: 14.7, sigmaBand: 6.8 }];
    const out = bandSeries(cumulative);
    expect(out.lower[0]).toBeCloseTo(14.7 - 6.8, 10);
  });
});

describe('scorecardVerdict', () => {
  it('reports the empty state for k=0', () => {
    const v = scorecardVerdict([]);
    expect(v.k).toBe(0);
    expect(v.status).toBe('empty');
    expect(v.text).toMatch(/zbieramy/i);
  });

  it('says "w paśmie szumu" when the latest cumHits sits inside ±2σ', () => {
    const v = scorecardVerdict([{ k: 3, cumHits: 2, expected: 2.204, sigmaBand: 2.63 }]);
    expect(v.status).toBe('within');
    expect(v.text).toContain('po 3 kuponach'.replace('po', 'Po'));
    expect(v.text.toLowerCase()).toContain('w paśmie szumu');
  });

  it('flags above-band without ever claiming an edge', () => {
    const v = scorecardVerdict([{ k: 3, cumHits: 8, expected: 2.204, sigmaBand: 2.63 }]);
    expect(v.status).toBe('above');
    expect(v.text.toLowerCase()).toContain('powyżej');
    expect(v.text.toLowerCase()).toContain('nie przewaga');
  });

  it('flags below-band', () => {
    const v = scorecardVerdict([{ k: 5, cumHits: 0, expected: 3.673, sigmaBand: 3.4 }]);
    expect(v.status).toBe('below');
    expect(v.text.toLowerCase()).toContain('poniżej');
  });

  it('uses the singular locative "kuponie" at k=1', () => {
    const v = scorecardVerdict([{ k: 1, cumHits: 1, expected: 0.7347, sigmaBand: 1.52 }]);
    expect(v.text).toContain('Po 1 kuponie');
  });
});
