import { hypergeomPmf } from './theory.js';
import { prizeForHits } from './config.js';

// The "Sprawdzam!" self-scorecard (SPEC §8.5): pure aggregation over the already-scored
// predictions. No DB, no I/O — the handler (src/server/scorecard.js) feeds it rows and a
// prizes config, everything here is unit-tested in tests/scorecard.test.js.

const HITS = [0, 1, 2, 3, 4, 5, 6];

/** E[trafienia kuponu] = 36/49 ≈ 0,7347 — the null-hypothesis anchor (CONVENTIONS.md). */
export const EXPECTED_HITS_PER_COUPON = 36 / 49;

/**
 * Variance of a single coupon's hit count, from the EXACT hypergeometric distribution
 * (N=49, K=6, n=6): Var = Σ_{h=0..6} (h − 36/49)²·P(h), P from theory.js's hypergeomPmf.
 * Computed once at module load. Its value is 0.5775718450645565 — identical (to machine
 * precision) to the hypergeometric closed form n·(K/N)·((N−K)/N)·((N−n)/(N−1)) =
 * 6·(6/49)·(43/49)·(43/48). This is the per-coupon Var; k independent coupons give k·Var,
 * so the cumulative ±2σ noise band is 2·√(k·Var).
 */
export const HITS_VARIANCE = HITS.reduce(
  (acc, h) => acc + (h - EXPECTED_HITS_PER_COUPON) ** 2 * hypergeomPmf(h),
  0
);

const SIGMA_MULTIPLIER = 2;

/** Half-width of the ±2σ band around the expected cumulative hits after k coupons. */
export function sigmaBand(k) {
  return SIGMA_MULTIPLIER * Math.sqrt(k * HITS_VARIANCE);
}

/**
 * Aggregate every EVALUATED prediction into the scorecard payload. `predictions` is
 * ordered oldest-first, each `{forDrawNumber, date, numbers, hits, prizeTier}`; `prizes`
 * is the config/prizes.json object. k=0 yields empty arrays + zeroed aggregates (never
 * nulls that would crash the view).
 */
export function buildScorecard(predictions, prizes) {
  const perPrediction = predictions.map((p) => ({
    forDrawNumber: p.forDrawNumber,
    date: p.date,
    numbers: p.numbers,
    hits: p.hits,
    prizeTier: p.prizeTier ?? null,
  }));

  const observed = Object.fromEntries(HITS.map((h) => [h, 0]));
  const cumulative = [];
  let cumHits = 0;
  let winnings = 0;

  predictions.forEach((p, i) => {
    const k = i + 1;
    cumHits += p.hits;
    cumulative.push({
      k,
      forDrawNumber: p.forDrawNumber,
      date: p.date,
      cumHits,
      expected: k * EXPECTED_HITS_PER_COUPON,
      sigmaBand: sigmaBand(k),
    });
    observed[p.hits] = (observed[p.hits] || 0) + 1;
    // Same prize lookup the wehikuł/evaluate path uses (config.prizeForHits): only 3+ hits
    // pay, keyed by hit count — never duplicated here.
    winnings += prizeForHits(prizes, p.hits);
  });

  const k = predictions.length;
  const expected = Object.fromEntries(HITS.map((h) => [h, hypergeomPmf(h) * k]));
  const cost = k * prizes.betPrice;

  return {
    perPrediction,
    cumulative,
    distribution: { observed, expected },
    balance: { cost, winnings, net: winnings - cost },
    variance: HITS_VARIANCE,
    expectedPerCoupon: EXPECTED_HITS_PER_COUPON,
    evaluatedCount: k,
  };
}
