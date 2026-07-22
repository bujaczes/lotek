import { describe, expect, it } from 'vitest';
import {
  GEOMETRIC_P,
  yearSeries,
  bestYear,
  foldGapTail,
  geometricExpectation,
  zScorePoints,
  labelInterval,
  sumPercentile,
  sumSector,
  neighbourNumbers,
} from '../src/charts/career-transforms.js';

describe('yearSeries', () => {
  it('orders the years ascending and fills the gap years with zero', () => {
    const out = yearSeries({ 1959: 5, 1957: 3, 1961: 2 });
    expect(out.years).toEqual([1957, 1958, 1959, 1960, 1961]);
    expect(out.counts).toEqual([3, 0, 5, 0, 2]);
  });

  it('reports the mean count per year', () => {
    expect(yearSeries({ 2000: 4, 2001: 6 }).mean).toBe(5);
  });

  it('is empty for a number that never appeared', () => {
    expect(yearSeries({})).toEqual({ years: [], counts: [], mean: null });
  });
});

describe('bestYear', () => {
  it('picks the year with the highest count', () => {
    expect(bestYear({ 1980: 9, 1981: 14, 1982: 11 })).toEqual({ year: 1981, count: 14 });
  });

  it('breaks a tie in favour of the earlier year', () => {
    expect(bestYear({ 1990: 12, 1991: 12 })).toEqual({ year: 1990, count: 12 });
  });

  it('is null when there is nothing to rank', () => {
    expect(bestYear({})).toBeNull();
  });
});

describe('foldGapTail', () => {
  const histogram = [
    { gap: 0, count: 40 },
    { gap: 1, count: 30 },
    { gap: 2, count: 20 },
    { gap: 3, count: 8 },
    { gap: 4, count: 1 },
    { gap: 5, count: 0 },
    { gap: 6, count: 1 },
  ];

  it('keeps every bin when the histogram is already short', () => {
    const { bins, tailFrom } = foldGapTail(histogram.slice(0, 3), 0.99);
    expect(bins.map((b) => b.label)).toEqual(['0', '1', '2']);
    expect(tailFrom).toBeNull();
  });

  it('folds the sparse tail into one "n+" bucket', () => {
    const { bins, tailFrom } = foldGapTail(histogram, 0.98);
    expect(tailFrom).toBe(4);
    expect(bins.map((b) => b.label)).toEqual(['0', '1', '2', '3', '4+']);
    expect(bins.at(-1)).toMatchObject({ count: 2, isTail: true });
  });

  it('preserves the total count', () => {
    const { bins } = foldGapTail(histogram, 0.9);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(100);
  });

  it('handles an empty histogram', () => {
    expect(foldGapTail([], 0.99)).toEqual({ bins: [], tailFrom: null });
  });
});

describe('geometricExpectation', () => {
  it('uses p = 6/49 — the per-draw chance of a given number', () => {
    expect(GEOMETRIC_P).toBeCloseTo(6 / 49, 12);
  });

  it('scales the geometric pmf to the observed number of gaps', () => {
    const bins = [{ gap: 0 }, { gap: 1 }, { gap: 2 }];
    const expected = geometricExpectation(bins, 1000);
    expect(expected[0]).toBeCloseTo(1000 * GEOMETRIC_P, 9);
    expect(expected[1]).toBeCloseTo(1000 * GEOMETRIC_P * (1 - GEOMETRIC_P), 9);
    expect(expected[2]).toBeCloseTo(1000 * GEOMETRIC_P * (1 - GEOMETRIC_P) ** 2, 9);
  });

  it('gives the folded tail bin the whole remaining tail mass', () => {
    const bins = [{ gap: 0 }, { gap: 1 }, { gap: 2, isTail: true }];
    const expected = geometricExpectation(bins, 1000);
    expect(expected.reduce((s, v) => s + v, 0)).toBeCloseTo(1000, 9);
    expect(expected[2]).toBeCloseTo(1000 * (1 - GEOMETRIC_P) ** 2, 9);
  });
});

describe('zScorePoints', () => {
  const series = [
    { drawNumber: 100, drawnAt: '1959-01-11', k: 100, count: 7, zScore: -1.51 },
    { drawNumber: 200, drawnAt: '1960-12-11', k: 200, count: 21, zScore: 0.71 },
  ];

  it('exposes an axis category and a year per checkpoint', () => {
    const out = zScorePoints(series);
    expect(out.categories).toEqual(['100', '200']);
    expect(out.years).toEqual([1959, 1960]);
    expect(out.values).toEqual([-1.51, 0.71]);
  });

  it('reports the largest absolute z-score, for the honest-framing caption', () => {
    expect(zScorePoints(series).maxAbs).toBeCloseTo(1.51, 9);
  });

  it('drops checkpoints with no z-score', () => {
    expect(zScorePoints([{ drawNumber: 100, drawnAt: '1959-01-11', k: 100, count: 7, zScore: null }])).toEqual({
      categories: [],
      years: [],
      values: [],
      points: [],
      maxAbs: 0,
    });
  });
});

describe('labelInterval', () => {
  it('shows every label when they all fit', () => {
    expect(labelInterval(6, 8)).toBe(0);
  });

  it('thins the labels so at most maxLabels are drawn', () => {
    expect(labelInterval(73, 8)).toBe(9);
    expect(labelInterval(16, 8)).toBe(1);
  });

  it('is safe for an empty axis', () => {
    expect(labelInterval(0, 8)).toBe(0);
  });
});

describe('sumPercentile', () => {
  const histogram = [
    { sum: 21, count: 1 },
    { sum: 22, count: 2 },
    { sum: 23, count: 7 },
  ];

  it('is the share of draws at or below the given sum', () => {
    expect(sumPercentile(histogram, 21)).toBeCloseTo(10, 9);
    expect(sumPercentile(histogram, 22)).toBeCloseTo(30, 9);
    expect(sumPercentile(histogram, 23)).toBeCloseTo(100, 9);
  });

  it('is null without data or without a sum', () => {
    expect(sumPercentile([], 100)).toBeNull();
    expect(sumPercentile(histogram, null)).toBeNull();
  });
});

describe('sumSector', () => {
  it('labels the sum sector from its percentile (same cuts as the API)', () => {
    expect(sumSector(10)).toBe('niski');
    expect(sumSector(25)).toBe('typowy');
    expect(sumSector(75)).toBe('typowy');
    expect(sumSector(90)).toBe('wysoki');
    expect(sumSector(null)).toBeNull();
  });
});

describe('neighbourNumbers', () => {
  it('clamps at both ends of 1..49 rather than wrapping', () => {
    expect(neighbourNumbers(7)).toEqual({ prev: 6, next: 8 });
    expect(neighbourNumbers(1)).toEqual({ prev: null, next: 2 });
    expect(neighbourNumbers(49)).toEqual({ prev: 48, next: null });
  });
});
