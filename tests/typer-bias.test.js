import { describe, expect, it } from 'vitest';
import { decayedCounts, dirichletPosterior, biasZ, chi2Stat } from '../src/server/lib/typer/bias.js';

// counts arrays are length-49, 0-indexed: counts[i] is number (i+1).
const idx = (n) => n - 1;

// ---------------------------------------------------------------------------
// Deterministic LCG (Numerical Recipes params) — NO Math.random anywhere. Fixed
// seed => bit-identical draws every run, so the detectability assertions below are
// fully reproducible fixtures, not probabilistic.
// ---------------------------------------------------------------------------
function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296; // [0, 1)
  };
}

function sixDistinct(rand, forced = null) {
  const chosen = new Set();
  if (forced !== null) chosen.add(forced);
  while (chosen.size < 6) {
    chosen.add(Math.floor(rand() * 49) + 1);
  }
  return [...chosen].sort((a, b) => a - b);
}

// Generate `n` draws. If forceProb > 0, number `biasNumber` is force-included with that
// probability (else a fair 6-of-49 draw). Overall P(biasNumber) = forceProb + (1-forceProb)*6/49.
function generateDraws(seed, n, { biasNumber = null, forceProb = 0 } = {}) {
  const rand = makeLcg(seed);
  const draws = [];
  for (let k = 1; k <= n; k++) {
    const forced = biasNumber !== null && rand() < forceProb ? biasNumber : null;
    draws.push({ drawNumber: k, numbers: sixDistinct(rand, forced) });
  }
  return draws;
}

// force-include probability that yields an exact target marginal ratio vs fair 6/49.
function forceProbForRatio(ratio) {
  const p0 = 6 / 49;
  return (ratio * p0 - p0) / (1 - p0);
}

describe('decayedCounts — exponential decay weights', () => {
  it('a draw at age = halfLife weighs 0.5, the newest (age 0) weighs 1.0', () => {
    const halfLife = 300;
    const draws = [
      { drawNumber: 1, numbers: [5, 6, 7, 8, 9, 10] }, // age = 301-1 = 300 = halfLife -> 0.5
      { drawNumber: 301, numbers: [5, 11, 12, 13, 14, 15] }, // age 0 -> 1.0
    ];
    const { counts, effectiveN, sumSqWeights } = decayedCounts(draws, halfLife);
    expect(counts).toHaveLength(49);
    expect(counts[idx(6)]).toBeCloseTo(0.5, 12); // only in the age-halfLife draw
    expect(counts[idx(11)]).toBeCloseTo(1.0, 12); // only in the newest draw
    expect(counts[idx(5)]).toBeCloseTo(1.5, 12); // in both
    expect(counts[idx(20)]).toBe(0); // absent
    expect(effectiveN).toBeCloseTo(1.5, 12);
    expect(sumSqWeights).toBeCloseTo(0.25 + 1.0, 12);
  });

  it('a single draw: effectiveN = 1, its 6 numbers each weigh 1, sumSqWeights = 1', () => {
    const { counts, effectiveN, sumSqWeights } = decayedCounts(
      [{ drawNumber: 1, numbers: [1, 2, 3, 4, 5, 6] }],
      300
    );
    expect(effectiveN).toBeCloseTo(1, 12);
    expect(sumSqWeights).toBeCloseTo(1, 12);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(counts[idx(n)]).toBeCloseTo(1, 12);
    expect(counts[idx(7)]).toBe(0);
  });

  it('matches rebuild-stats decayed-count definition (weight = lambda^(maxDrawNumber-drawNumber))', () => {
    const halfLife = 300;
    const lambda = Math.pow(0.5, 1 / halfLife);
    const draws = [
      { drawNumber: 10, numbers: [1, 2, 3, 4, 5, 6] },
      { drawNumber: 50, numbers: [1, 7, 8, 9, 10, 11] },
      { drawNumber: 90, numbers: [1, 12, 13, 14, 15, 16] },
    ];
    const { counts, effectiveN } = decayedCounts(draws, halfLife);
    const w = [lambda ** 80, lambda ** 40, lambda ** 0];
    expect(counts[idx(1)]).toBeCloseTo(w[0] + w[1] + w[2], 12);
    expect(effectiveN).toBeCloseTo(w[0] + w[1] + w[2], 12);
  });

  it('empty draw set: effectiveN 0, sumSqWeights 0, 49 zero counts', () => {
    const { counts, effectiveN, sumSqWeights } = decayedCounts([], 300);
    expect(effectiveN).toBe(0);
    expect(sumSqWeights).toBe(0);
    expect(counts).toHaveLength(49);
    expect(counts.every((c) => c === 0)).toBe(true);
  });
});

describe('dirichletPosterior — sceptical prior', () => {
  it('is exactly 1/49 for every number at zero data', () => {
    const p = dirichletPosterior(new Array(49).fill(0), 0, 780);
    expect(p).toHaveLength(49);
    for (const pi of p) expect(pi).toBeCloseTo(1 / 49, 15);
  });

  it('sums to 1 for a consistent count vector', () => {
    const draws = generateDraws(12345, 200);
    const { counts, effectiveN } = decayedCounts(draws, 1e9);
    const p = dirichletPosterior(counts, effectiveN, 780);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('pulls a wildly skewed count strongly back toward 1/49 under the strong prior', () => {
    const counts = new Array(49).fill(0);
    counts[idx(1)] = 100; // number 1 in all 100 "draws" — raw freq 100/600 = 0.1667
    const effectiveN = 100;
    const p = dirichletPosterior(counts, effectiveN, 780);
    const fair = 1 / 49;
    const rawFreq = 100 / (6 * effectiveN);
    expect(p[idx(1)]).toBeGreaterThan(fair); // still elevated
    expect(p[idx(1)]).toBeLessThan(0.05); // but nowhere near the raw 0.1667
    // closer to the fair prior than to the raw frequency:
    expect(Math.abs(p[idx(1)] - fair)).toBeLessThan(Math.abs(p[idx(1)] - rawFreq));
  });
});

describe('biasZ — standardized deviation on decayed counts', () => {
  it('the 49 z-scores sum to ~0 (Sum of counts is fixed at 6*effectiveN)', () => {
    const draws = generateDraws(777, 500);
    const { counts, effectiveN, sumSqWeights } = decayedCounts(draws, 1e9);
    const z = biasZ(counts, effectiveN, sumSqWeights);
    expect(z).toHaveLength(49);
    expect(z.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 8);
  });

  it('matches the formula z = (c - E)/sqrt(Var) for a hand-checked case', () => {
    const effectiveN = 1000;
    const sumSqWeights = 1000;
    const counts = new Array(49).fill(0);
    counts[idx(3)] = 200; // way above expected
    const z = biasZ(counts, effectiveN, sumSqWeights);
    const E = (effectiveN * 6) / 49;
    const Var = (6 / 49) * (43 / 49) * sumSqWeights;
    expect(z[idx(3)]).toBeCloseTo((200 - E) / Math.sqrt(Var), 12);
    expect(z[idx(3)]).toBeGreaterThan(0);
    // a number with count 0 is below expectation -> negative z
    expect(z[idx(4)]).toBeCloseTo((0 - E) / Math.sqrt(Var), 12);
    expect(z[idx(4)]).toBeLessThan(0);
  });

  it('returns all-zero when there is no data (Var = 0)', () => {
    const z = biasZ(new Array(49).fill(0), 0, 0);
    expect(z.every((v) => v === 0)).toBe(true);
  });
});

describe('chi2Stat — Pearson goodness-of-fit on decayed counts', () => {
  it('returns {stat, df: 48, p} with p = chi2Sf(stat, 48)', () => {
    const draws = generateDraws(2024, 800);
    const { counts, effectiveN } = decayedCounts(draws, 1e9);
    const res = chi2Stat(counts, effectiveN);
    expect(res.df).toBe(48);
    expect(res.stat).toBeGreaterThanOrEqual(0);
    expect(res.p).toBeGreaterThanOrEqual(0);
    expect(res.p).toBeLessThanOrEqual(1);
  });

  it('stat = Sum (c_i - E)^2 / E for a hand-checked case', () => {
    const effectiveN = 49; // E = 49*6/49 = 6 per number
    const counts = new Array(49).fill(6);
    counts[idx(1)] = 12; // +6
    counts[idx(2)] = 0; //  -6
    const res = chi2Stat(counts, effectiveN);
    // (12-6)^2/6 + (0-6)^2/6 = 6 + 6 = 12
    expect(res.stat).toBeCloseTo(12, 12);
  });

  it('degenerate empty input: stat 0, p 1', () => {
    const res = chi2Stat(new Array(49).fill(0), 0);
    expect(res.stat).toBe(0);
    expect(res.p).toBe(1);
  });
});

describe('detectability — planted 1.3x bias on number 17 (deterministic LCG)', () => {
  // A single-cell 1.3x bias is a STRONG per-number signal (z_17 is decisively the max)
  // but a WEAK diffuse signal for the 48-df omnibus chi-squared. To push chi-squared
  // below 0.05 with real margin we need a few thousand near-uniformly-weighted draws;
  // the SPEC's own point is that with the production half-life (300 -> effective ~430
  // draws) chi-squared almost never rejects. So this test uses a long half-life (draws
  // weigh ~0.92..1.0 across the window, isolating detection power from the decay taper)
  // and 4000 draws. Measured: z_17=6.38 (max), stat=68.8, p=0.0259.
  const N = 4000;
  const HL = 50000;

  it('biased set: z_17 is the max z-score and chi2 rejects H0 (p < 0.05)', () => {
    const draws = generateDraws(20260722, N, { biasNumber: 17, forceProb: forceProbForRatio(1.3) });
    const { counts, effectiveN, sumSqWeights } = decayedCounts(draws, HL);
    const z = biasZ(counts, effectiveN, sumSqWeights);
    const maxZ = Math.max(...z);
    expect(z[idx(17)]).toBe(maxZ);
    const { p } = chi2Stat(counts, effectiveN);
    expect(p).toBeLessThan(0.05);
  });

  it('fair set: chi2 does not reject H0 (p > 0.05)', () => {
    const draws = generateDraws(11223344, N);
    const { counts, effectiveN } = decayedCounts(draws, HL);
    const { p } = chi2Stat(counts, effectiveN);
    expect(p).toBeGreaterThan(0.05);
  });
});

describe('determinism — identical input yields bit-identical output', () => {
  it('decayedCounts + biasZ + chi2Stat are pure and reproducible', () => {
    const draws = generateDraws(42, 1000, { biasNumber: 17, forceProb: forceProbForRatio(1.3) });
    const a = decayedCounts(draws, 300);
    const b = decayedCounts(draws, 300);
    expect(a).toEqual(b);
    expect(biasZ(a.counts, a.effectiveN, a.sumSqWeights)).toEqual(
      biasZ(b.counts, b.effectiveN, b.sumSqWeights)
    );
    expect(chi2Stat(a.counts, a.effectiveN)).toEqual(chi2Stat(b.counts, b.effectiveN));
  });
});
