import { chi2Sf } from './chi2.js';

// Składnik A — physical-bias detection (Dirichlet-multinomial with exponential decay).
// Pure math, no db / no I/O / no clock. All arrays over numbers 1..49 are length-49 and
// 0-indexed: index i holds number (i+1).

const MAX_NUMBER = 49;
const NUMBERS_PER_DRAW = 6;

/**
 * Exponentially-decayed occurrence counts over `draws` (each `{drawNumber, numbers:[6]}`).
 *
 *   lambda   = 0.5^(1/halfLife)                         (half-weight after `halfLife` draws)
 *   weight_k = lambda^(maxDrawNumber - drawNumber_k)     (newest draw weighs 1.0)
 *   effectiveN     = Σ weight_k
 *   counts[i]      = Σ over draws containing (i+1) of weight_k
 *   sumSqWeights   = Σ weight_k^2                         (for the per-number variance)
 *
 * Same decay definition as src/server/lib/rebuild-stats.js `decayedCount`. maxDrawNumber
 * is taken as the max over all draws (draws need not be pre-sorted).
 */
export function decayedCounts(draws, halfLife) {
  const counts = new Array(MAX_NUMBER).fill(0);
  if (draws.length === 0) return { counts, effectiveN: 0, sumSqWeights: 0 };

  const lambda = Math.pow(0.5, 1 / halfLife);
  let maxDrawNumber = -Infinity;
  for (const d of draws) if (d.drawNumber > maxDrawNumber) maxDrawNumber = d.drawNumber;

  let effectiveN = 0;
  let sumSqWeights = 0;
  for (const d of draws) {
    const weight = Math.pow(lambda, maxDrawNumber - d.drawNumber);
    effectiveN += weight;
    sumSqWeights += weight * weight;
    for (const n of d.numbers) counts[n - 1] += weight;
  }
  return { counts, effectiveN, sumSqWeights };
}

/**
 * Dirichlet-multinomial posterior mean per number: p_i = (c_i + alpha)/(effectiveN*6 + 49*alpha),
 * alpha = priorStrengthDraws * 6/49. A strong "fairness" prior (~5 years of honest data at
 * priorStrengthDraws=780) keeps p near 1/49 unless a strong, fresh signal moves it. At zero
 * data p_i = alpha/(49*alpha) = 1/49 for every number.
 */
export function dirichletPosterior(counts, effectiveN, priorStrengthDraws) {
  const alpha = (priorStrengthDraws * NUMBERS_PER_DRAW) / MAX_NUMBER;
  const denom = effectiveN * NUMBERS_PER_DRAW + MAX_NUMBER * alpha;
  return counts.map((c) => (c + alpha) / denom);
}

/**
 * Standardized per-number deviation on the decayed counts: z_i = (c_i - E)/sqrt(Var),
 * E = effectiveN*6/49, Var = (6/49)(43/49)*sumSqWeights (variance of a weighted sum of
 * Bernoulli(6/49) per-number indicators). Returns all-zero when Var = 0 (no data).
 */
export function biasZ(counts, effectiveN, sumSqWeights) {
  const E = (effectiveN * NUMBERS_PER_DRAW) / MAX_NUMBER;
  const variance =
    (NUMBERS_PER_DRAW / MAX_NUMBER) * ((MAX_NUMBER - NUMBERS_PER_DRAW) / MAX_NUMBER) * sumSqWeights;
  if (variance <= 0) return new Array(MAX_NUMBER).fill(0);
  const sd = Math.sqrt(variance);
  return counts.map((c) => (c - E) / sd);
}

/**
 * Global Pearson chi-squared goodness-of-fit against a uniform 1..49: E_i = effectiveN*6/49,
 * stat = Σ (c_i - E_i)^2 / E_i, df = 48, p = chi2Sf(stat, 48).
 *
 * NOTE: with exponentially-weighted (decayed) counts this is an APPROXIMATION — the counts
 * are not integer multinomial cell counts, so the reference chi-squared distribution holds
 * only approximately (the effective sample size shrinks the true degrees of freedom slightly).
 * It is used as a sanity gate ("is there any evidence of bias at all?"), not an exact test.
 * At zero data (effectiveN = 0) returns {stat: 0, df: 48, p: 1}.
 */
export function chi2Stat(counts, effectiveN) {
  const E = (effectiveN * NUMBERS_PER_DRAW) / MAX_NUMBER;
  if (E <= 0) return { stat: 0, df: 48, p: 1 };
  let stat = 0;
  for (const c of counts) {
    const d = c - E;
    stat += (d * d) / E;
  }
  return { stat, df: 48, p: chi2Sf(stat, 48) };
}
