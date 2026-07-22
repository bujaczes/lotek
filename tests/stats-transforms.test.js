import { describe, expect, it } from 'vitest';
import {
  binSumHistogram,
  binIndexForSum,
  meanFromHistogram,
  percentileLabel,
  formatLift,
  liftBar,
  structureSeries,
  yearTicks,
  pairsOf,
  poissonZero,
} from '../src/charts/transforms.js';

const histo = (from, to, fn) => {
  const rows = [];
  for (let s = from; s <= to; s++) rows.push({ sum: s, count: fn(s) });
  return rows;
};
const theo = (from, to, fn) => {
  const rows = [];
  for (let s = from; s <= to; s++) rows.push({ sum: s, expected: fn(s) });
  return rows;
};

describe('binSumHistogram', () => {
  it('groups sums into fixed-width bins, summing counts and expectations', () => {
    const bins = binSumHistogram(histo(21, 30, () => 2), theo(21, 30, () => 0.5), 5);
    expect(bins).toHaveLength(2);
    expect(bins[0]).toMatchObject({ from: 21, to: 25, count: 10, expected: 2.5 });
    expect(bins[1]).toMatchObject({ from: 26, to: 30, count: 10, expected: 2.5 });
  });

  it('labels each bin as an inclusive range with an en dash', () => {
    const bins = binSumHistogram(histo(21, 30, () => 1), theo(21, 30, () => 1), 5);
    expect(bins.map((b) => b.label)).toEqual(['21–25', '26–30']);
  });

  it('keeps a short trailing bin when the range is not a multiple of the width', () => {
    const bins = binSumHistogram(histo(21, 27, () => 1), theo(21, 27, () => 1), 5);
    expect(bins).toHaveLength(2);
    expect(bins[1]).toMatchObject({ from: 26, to: 27, count: 2, label: '26–27' });
  });

  it('preserves the grand totals of both series (nothing is dropped)', () => {
    const h = histo(21, 279, (s) => s % 7);
    const t = theo(21, 279, (s) => s / 100);
    const bins = binSumHistogram(h, t, 5);
    const totalCount = bins.reduce((a, b) => a + b.count, 0);
    const totalExpected = bins.reduce((a, b) => a + b.expected, 0);
    expect(totalCount).toBe(h.reduce((a, r) => a + r.count, 0));
    expect(totalExpected).toBeCloseTo(t.reduce((a, r) => a + r.expected, 0), 6);
  });

  it('returns an empty list for an empty histogram', () => {
    expect(binSumHistogram([], [], 5)).toEqual([]);
  });
});

describe('binIndexForSum', () => {
  const bins = binSumHistogram(histo(21, 40, () => 1), theo(21, 40, () => 1), 5);

  it('finds the bin holding a sum, inclusive on both ends', () => {
    expect(binIndexForSum(bins, 21)).toBe(0);
    expect(binIndexForSum(bins, 25)).toBe(0);
    expect(binIndexForSum(bins, 26)).toBe(1);
    expect(binIndexForSum(bins, 40)).toBe(3);
  });

  it('returns -1 for a sum outside every bin or a null sum', () => {
    expect(binIndexForSum(bins, 20)).toBe(-1);
    expect(binIndexForSum(bins, 41)).toBe(-1);
    expect(binIndexForSum(bins, null)).toBe(-1);
  });
});

describe('meanFromHistogram', () => {
  it('computes the count-weighted mean of the sums', () => {
    expect(meanFromHistogram([
      { sum: 100, count: 1 },
      { sum: 200, count: 3 },
    ])).toBe(175);
  });

  it('returns null when nothing was observed', () => {
    expect(meanFromHistogram([{ sum: 100, count: 0 }])).toBeNull();
    expect(meanFromHistogram([])).toBeNull();
  });
});

describe('percentileLabel', () => {
  it('rounds to a whole ordinal percentile in Polish', () => {
    expect(percentileLabel(45.6775)).toBe('46. percentyl');
    expect(percentileLabel(62)).toBe('62. percentyl');
  });

  it('never claims the 0th percentile for a non-empty history', () => {
    expect(percentileLabel(0.2)).toBe('1. percentyl');
    expect(percentileLabel(99.9)).toBe('100. percentyl');
  });

  it('returns null when there is no percentile', () => {
    expect(percentileLabel(null)).toBeNull();
  });
});

describe('formatLift', () => {
  it('formats a lift with two decimals, a Polish comma and the multiplier sign', () => {
    expect(formatLift(1.317289972899729)).toBe('1,32×');
    expect(formatLift(1)).toBe('1,00×');
    expect(formatLift(0.8)).toBe('0,80×');
  });
});

describe('liftBar', () => {
  it('puts lift above 1.0 on the "above" side, proportional to the deviation', () => {
    expect(liftBar(1.25, 0.5)).toEqual({ side: 'above', ratio: 0.5 });
    expect(liftBar(1.5, 0.5)).toEqual({ side: 'above', ratio: 1 });
  });

  it('puts lift below 1.0 on the "below" side', () => {
    expect(liftBar(0.75, 0.5)).toEqual({ side: 'below', ratio: 0.5 });
  });

  it('clamps deviations beyond the domain to a full bar', () => {
    expect(liftBar(9, 0.5)).toEqual({ side: 'above', ratio: 1 });
    expect(liftBar(0, 0.5)).toEqual({ side: 'below', ratio: 1 });
  });

  it('treats exactly 1.0 as a zero-width bar on the above side', () => {
    expect(liftBar(1, 0.5)).toEqual({ side: 'above', ratio: 0 });
  });
});

describe('structureSeries', () => {
  const rows = [
    { k: 0, empiricalCount: 100, empiricalShare: 0.0135, theoretical: 0.01266 },
    { k: 1, empiricalCount: 670, empiricalShare: 0.0907, theoretical: 0.09118 },
  ];

  it('splits rows into aligned category/empirical/theoretical arrays in percent', () => {
    const series = structureSeries(rows);
    expect(series.categories).toEqual(['0', '1']);
    expect(series.empirical[0]).toBeCloseTo(1.35, 6);
    expect(series.theoretical[1]).toBeCloseTo(9.118, 6);
    expect(series.counts).toEqual([100, 670]);
  });

  it('accepts a category labeller', () => {
    const series = structureSeries(rows, (k) => `${k}/6`);
    expect(series.categories).toEqual(['0/6', '1/6']);
  });
});

describe('pairsOf', () => {
  it('counts unordered pairs', () => {
    expect(pairsOf(7380)).toBe(27228510);
    expect(pairsOf(2)).toBe(1);
  });

  it('is zero below two items', () => {
    expect(pairsOf(1)).toBe(0);
    expect(pairsOf(0)).toBe(0);
  });

  it('agrees with the API expectation C(N,2)/13983816', () => {
    expect(pairsOf(7380) / 13983816).toBeCloseTo(1.9471444704363958, 12);
  });
});

describe('poissonZero', () => {
  it('gives P(no collision) for the expected collision count', () => {
    expect(poissonZero(1.9471444704363958)).toBeCloseTo(0.1427, 4);
    expect(poissonZero(0)).toBe(1);
  });
});

describe('yearTicks', () => {
  const dates = ['1957-01-27', '1957-02-03', '1958-01-05', '1959-01-05', '1960-01-05'];

  it('marks the first draw index of each year', () => {
    expect(yearTicks(dates, 1)).toEqual([
      { index: 0, label: '1957' },
      { index: 2, label: '1958' },
      { index: 3, label: '1959' },
      { index: 4, label: '1960' },
    ]);
  });

  it('keeps only years divisible by the step so the axis never crowds', () => {
    expect(yearTicks(dates, 2)).toEqual([
      { index: 2, label: '1958' },
      { index: 4, label: '1960' },
    ]);
  });

  it('returns an empty list for no dates', () => {
    expect(yearTicks([], 10)).toEqual([]);
  });
});
