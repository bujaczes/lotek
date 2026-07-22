// Pure data -> chart-series transforms. No DOM, no ECharts, no fetch — everything
// here is unit-tested in tests/stats-transforms.test.js and consumed by the
// /statystyki sections.

const EN_DASH = '–';

const liftFormatter = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Group the per-sum histogram (21..279 = 259 one-wide bars, too noisy to read) into
 * fixed-width bins. The theoretical curve is binned with the SAME edges so both series
 * stay comparable on one axis; totals are preserved exactly (nothing is dropped, the
 * trailing bin may be short).
 */
export function binSumHistogram(histogram, theoretical, binWidth = 5) {
  if (!histogram.length) return [];
  const expectedBySum = new Map(theoretical.map((r) => [r.sum, r.expected]));
  const first = histogram[0].sum;
  const bins = [];
  for (const row of histogram) {
    const index = Math.floor((row.sum - first) / binWidth);
    if (!bins[index]) {
      bins[index] = { from: row.sum, to: row.sum, label: '', count: 0, expected: 0 };
    }
    const bin = bins[index];
    bin.to = row.sum;
    bin.count += row.count;
    bin.expected += expectedBySum.get(row.sum) || 0;
  }
  for (const bin of bins) bin.label = `${bin.from}${EN_DASH}${bin.to}`;
  return bins;
}

/** Index of the bin containing `sum` (inclusive on both edges), or -1. */
export function binIndexForSum(bins, sum) {
  if (sum == null) return -1;
  return bins.findIndex((b) => sum >= b.from && sum <= b.to);
}

/** Count-weighted mean of the observed sums; null when nothing was observed. */
export function meanFromHistogram(histogram) {
  let total = 0;
  let weighted = 0;
  for (const row of histogram) {
    total += row.count;
    weighted += row.sum * row.count;
  }
  return total > 0 ? weighted / total : null;
}

/**
 * "46. percentyl". Rounded to a whole number and clamped to 1..100: the endpoint values
 * come from a non-empty history, where "0th percentile" would be a lie (the last draw is
 * itself part of the sample, so at least one draw is <= it).
 */
export function percentileLabel(percentile) {
  if (percentile == null) return null;
  const whole = Math.min(100, Math.max(1, Math.round(percentile)));
  return `${whole}. percentyl`;
}

export function formatLift(lift) {
  return `${liftFormatter.format(lift)}×`;
}

/**
 * Geometry for the deviation-from-1.0 bar next to a pair/triple. `maxDeviation` fixes the
 * domain (default +/-0.5) so every row is read against the same scale instead of against
 * the current top row.
 */
export function liftBar(lift, maxDeviation = 0.5) {
  const deviation = lift - 1;
  const ratio = Math.min(1, Math.abs(deviation) / maxDeviation);
  return { side: deviation < 0 ? 'below' : 'above', ratio };
}

/** Rows of {k, empiricalShare, theoretical, empiricalCount} -> aligned arrays in PERCENT. */
export function structureSeries(rows, labelFor = (k) => String(k)) {
  return {
    categories: rows.map((r) => labelFor(r.k)),
    empirical: rows.map((r) => r.empiricalShare * 100),
    theoretical: rows.map((r) => r.theoretical * 100),
    counts: rows.map((r) => r.empiricalCount),
  };
}

/** C(n,2) — the number of draw PAIRS that can collide (birthday paradox, SPEC 6.9). */
export function pairsOf(n) {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}

/**
 * P(zero collisions) under Poisson(lambda). With lambda ~ 1.95 the answer is ~14%, which
 * is why "expected 1.95, found 0" is not a contradiction — the panel says so out loud.
 */
export function poissonZero(lambda) {
  return Math.exp(-lambda);
}

/**
 * Axis ticks for the carpet: the draw index at which each year first appears, thinned to
 * every `step`-th year so 70 years of labels never collide.
 */
export function yearTicks(dates, step = 10) {
  const ticks = [];
  let seen = null;
  for (let i = 0; i < dates.length; i++) {
    const year = Number(dates[i].slice(0, 4));
    if (year === seen) continue;
    seen = year;
    if (year % step === 0) ticks.push({ index: i, label: String(year) });
  }
  return ticks;
}
