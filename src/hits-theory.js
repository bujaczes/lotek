// How many 3/4/5/6-hit draws chance alone predicts for a coupon played N times.
//
// SOURCE OF TRUTH: src/server/lib/theory.js (hypergeomPmf). The formula is duplicated
// here — not imported — so the client bundle never pulls in a server module, the same
// arrangement as src/blanket-geometry.js. It is one line of combinatorics, frozen by
// docs/CONVENTIONS.md ("rozkład trafień hipergeometryczny"), and asserted against the
// documented anchors in tests/hits-theory.test.js.

const MAX_NUMBER = 49;
const PER_DRAW = 6;

export function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

export const C_49_6 = binomial(MAX_NUMBER, PER_DRAW);

/** P(exactly k of your six are drawn) = C(6,k)·C(43,6−k) / C(49,6). */
export function hitProbability(k) {
  return (binomial(PER_DRAW, k) * binomial(MAX_NUMBER - PER_DRAW, PER_DRAW - k)) / C_49_6;
}

export const HIT_PROBABILITIES = Object.freeze({
  3: hitProbability(3),
  4: hitProbability(4),
  5: hitProbability(5),
  6: hitProbability(6),
});

/** Expected number of 3/4/5/6-hit draws over `drawsPlayed` draws. */
export function expectedHits(drawsPlayed) {
  return {
    3: HIT_PROBABILITIES[3] * drawsPlayed,
    4: HIT_PROBABILITIES[4] * drawsPlayed,
    5: HIT_PROBABILITIES[5] * drawsPlayed,
    6: HIT_PROBABILITIES[6] * drawsPlayed,
  };
}

/** "1 : 13 983 816" style odds for a tier — the honest counterweight to the balance. */
export function oddsFor(k) {
  return Math.round(1 / hitProbability(k));
}
