// Pure data -> series transforms for /liczba/:n and the sum read-out on /losowanie/:nr.
// No DOM, no ECharts, no fetch. Unit-tested in tests/career-transforms.test.js.

/** Per-draw chance of one given number: 6 balls out of 49. */
export const GEOMETRIC_P = 6 / 49;

/** { "1957": 3, "1959": 5 } -> dense ascending series with the empty years filled in. */
export function yearSeries(yearCounts) {
  const entries = Object.entries(yearCounts || {}).map(([y, c]) => [Number(y), c]);
  if (!entries.length) return { years: [], counts: [], mean: null };
  const from = Math.min(...entries.map(([y]) => y));
  const to = Math.max(...entries.map(([y]) => y));
  const byYear = new Map(entries);
  const years = [];
  const counts = [];
  for (let y = from; y <= to; y += 1) {
    years.push(y);
    counts.push(byYear.get(y) || 0);
  }
  const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
  return { years, counts, mean };
}

/** The number's best year; ties go to the earlier one (the record it held first). */
export function bestYear(yearCounts) {
  let best = null;
  for (const [rawYear, count] of Object.entries(yearCounts || {})) {
    const year = Number(rawYear);
    if (!best || count > best.count || (count === best.count && year < best.year)) {
      best = { year, count };
    }
  }
  return best;
}

/**
 * A single number's completed-gap histogram runs to gaps of 60+ draws with counts of
 * 0 or 1 out there — 60 near-empty bars that hide the shape. Bins are kept individually
 * until `coverage` of all gaps is accounted for; everything past that folds into one
 * "n+" bucket so no observation is dropped.
 */
export function foldGapTail(histogram, coverage = 0.99) {
  if (!histogram || !histogram.length) return { bins: [], tailFrom: null };
  const total = histogram.reduce((s, r) => s + r.count, 0);
  if (total === 0) {
    return { bins: histogram.map((r) => ({ gap: r.gap, label: String(r.gap), count: 0, isTail: false })), tailFrom: null };
  }

  let cumulative = 0;
  let cut = histogram.length - 1;
  for (let i = 0; i < histogram.length; i += 1) {
    cumulative += histogram[i].count;
    if (cumulative / total >= coverage) {
      cut = i;
      break;
    }
  }
  if (cut >= histogram.length - 1) {
    return {
      bins: histogram.map((r) => ({ gap: r.gap, label: String(r.gap), count: r.count, isTail: false })),
      tailFrom: null,
    };
  }

  const bins = histogram
    .slice(0, cut + 1)
    .map((r) => ({ gap: r.gap, label: String(r.gap), count: r.count, isTail: false }));
  const tailFrom = histogram[cut + 1].gap;
  const tailCount = histogram.slice(cut + 1).reduce((s, r) => s + r.count, 0);
  bins.push({ gap: tailFrom, label: `${tailFrom}+`, count: tailCount, isTail: true });
  return { bins, tailFrom };
}

/**
 * Expected bin heights if the gaps were geometric with p = 6/49 — the reference curve
 * that turns "look at that long absence" into "exactly as many long absences as chance
 * predicts". The folded tail bin gets the whole remaining tail mass (1-p)^gap, so the
 * curve sums to `total` just like the bars do.
 */
export function geometricExpectation(bins, total, p = GEOMETRIC_P) {
  return bins.map((bin) =>
    bin.isTail ? total * (1 - p) ** bin.gap : total * p * (1 - p) ** bin.gap
  );
}

/** z-score checkpoints -> aligned axis arrays, skipping checkpoints without a value. */
export function zScorePoints(series) {
  const points = (series || []).filter((c) => c.zScore != null);
  return {
    points,
    categories: points.map((c) => String(c.drawNumber)),
    years: points.map((c) => Number(String(c.drawnAt).slice(0, 4))),
    values: points.map((c) => c.zScore),
    maxAbs: points.reduce((m, c) => Math.max(m, Math.abs(c.zScore)), 0),
  };
}

/** ECharts axisLabel.interval (0 = every label) that keeps at most `maxLabels` on screen. */
export function labelInterval(count, maxLabels = 8) {
  if (count <= maxLabels) return 0;
  return Math.ceil(count / maxLabels) - 1;
}

/**
 * Percentile of `sum` among all historical draw sums — the same "share at or below"
 * definition the API uses for the latest draw (src/server/stats.js), recomputed here
 * so any archived draw can be placed on the same scale from one cached histogram.
 */
export function sumPercentile(histogram, sum) {
  if (sum == null || !histogram || !histogram.length) return null;
  let total = 0;
  let atOrBelow = 0;
  for (const row of histogram) {
    total += row.count;
    if (row.sum <= sum) atOrBelow += row.count;
  }
  return total > 0 ? (atOrBelow / total) * 100 : null;
}

/** Sector cuts mirror sectorForPercentile() in src/server/stats.js. */
export function sumSector(percentile) {
  if (percentile == null) return null;
  if (percentile < 25) return 'niski';
  if (percentile > 75) return 'wysoki';
  return 'typowy';
}

/** Prev/next number for the career page. Clamped at 1 and 49 — the run does not wrap. */
export function neighbourNumbers(n) {
  return { prev: n > 1 ? n - 1 : null, next: n < 49 ? n + 1 : null };
}
