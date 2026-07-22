const MAX_NUMBER = 49;
const NUMBERS_PER_DRAW = 6;

/** P(a specific number is drawn in a given draw) = 6/49, per CONVENTIONS. */
export const P_NUMBER_DRAWN = NUMBERS_PER_DRAW / MAX_NUMBER;

/**
 * Pure computation (no db) over `draws: [{drawNumber, numbers}]` sorted ascending: the
 * full distribution of *completed* gaps (draws strictly between two consecutive
 * occurrences of the same number), pooled across all 49 numbers. Unlike
 * `rebuild-stats.js`'s per-number `maxGap`/`avgGap`, this keeps every individual gap
 * length to build a histogram. `histogram` covers every integer 0..maxGap (zero-filled,
 * no gaps in the gap axis) so it lines up 1:1 with `geometricGapCurve`'s output.
 */
export function computeGapDistribution(draws) {
  const occurrencesByNumber = new Map();
  for (let n = 1; n <= MAX_NUMBER; n++) occurrencesByNumber.set(n, []);
  for (const draw of draws) {
    for (const n of draw.numbers) occurrencesByNumber.get(n).push(draw.drawNumber);
  }

  const counts = new Map();
  let total = 0;
  let maxGap = 0;

  for (let n = 1; n <= MAX_NUMBER; n++) {
    const occ = occurrencesByNumber.get(n);
    for (let i = 1; i < occ.length; i++) {
      const gap = occ[i] - occ[i - 1] - 1;
      counts.set(gap, (counts.get(gap) || 0) + 1);
      total += 1;
      if (gap > maxGap) maxGap = gap;
    }
  }

  const histogram = [];
  for (let g = 0; g <= maxGap; g++) {
    histogram.push({ gap: g, count: counts.get(g) || 0 });
  }

  return { histogram, total, maxGap };
}

/**
 * Theoretical geometric curve P(gap=g) = p(1-p)^g, scaled to `totalObservations`, for
 * g=0..maxGap. Overlaying this on `computeGapDistribution`'s histogram is the "a long
 * absence doesn't make a number due" evidence from SPEC 6.3 — gaps are memoryless, they
 * follow a geometric distribution, not a rising hazard.
 */
export function geometricGapCurve(maxGap, totalObservations, p = P_NUMBER_DRAWN) {
  const curve = [];
  for (let g = 0; g <= maxGap; g++) {
    curve.push({ gap: g, expected: totalObservations * p * (1 - p) ** g });
  }
  return curve;
}
