const MAX_NUMBER = 49;
const NUMBERS_PER_DRAW = 6;

/**
 * Pure computation (no db) over `draws: [{drawNumber, drawnAt, numbers}]` sorted ascending
 * by drawNumber: the z-score of a single `number`'s occurrence rate, recomputed at every
 * `step`-th draw (default 100) using ONLY the draws seen up to that point (the whole
 * point of a time series — a checkpoint at k=100 must not see draws 101+). Emits one
 * checkpoint per COMPLETE multiple of `step` reached within `draws.length` (a history
 * shorter than `step` yields an empty series, not a partial/misleading checkpoint).
 * Formula matches computeNumberStats' full-history z_score: z = (c - k*6/49) /
 * sqrt(k*6*(1/49)*(48/49)), with k = draws seen so far, c = occurrences of `number` so far.
 */
export function zScoreCheckpoints(draws, number, step = 100) {
  const series = [];
  let count = 0;
  const varianceFactor = NUMBERS_PER_DRAW * (1 / MAX_NUMBER) * ((MAX_NUMBER - 1) / MAX_NUMBER);

  for (let i = 0; i < draws.length; i++) {
    if (draws[i].numbers.includes(number)) count++;
    const k = i + 1;
    if (k % step === 0) {
      const denom = Math.sqrt(k * varianceFactor);
      const zScore = denom > 0 ? (count - (k * NUMBERS_PER_DRAW) / MAX_NUMBER) / denom : null;
      series.push({ drawNumber: draws[i].drawNumber, drawnAt: draws[i].drawnAt, k, count, zScore });
    }
  }

  return series;
}

/**
 * Pure computation (no db) of the completed-gap histogram for a SINGLE number, scoped
 * (unlike gaps.js's computeGapDistribution, which pools across all 49 numbers). Same
 * zero-filled 0..maxGap shape so it's a drop-in per-number companion to the blanket-wide
 * gap distribution.
 */
export function numberGapHistogram(draws, number) {
  const occurrences = [];
  for (const draw of draws) {
    if (draw.numbers.includes(number)) occurrences.push(draw.drawNumber);
  }

  const counts = new Map();
  let total = 0;
  let maxGap = 0;
  for (let i = 1; i < occurrences.length; i++) {
    const gap = occurrences[i] - occurrences[i - 1] - 1;
    counts.set(gap, (counts.get(gap) || 0) + 1);
    total += 1;
    if (gap > maxGap) maxGap = gap;
  }

  const histogram = [];
  for (let g = 0; g <= maxGap; g++) {
    histogram.push({ gap: g, count: counts.get(g) || 0 });
  }

  return { histogram, total, maxGap };
}
