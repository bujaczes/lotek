import { pluralPl } from '../format.js';

// Pure data -> chart-series transforms for the Typer "Sprawdzam!" scorecard. No DOM, no
// ECharts, no fetch — unit-tested in tests/scorecard-transforms.test.js and consumed by
// src/components/typer-scorecard.js.

const KUPON_LOC = ['kuponie', 'kuponach', 'kuponach']; // locative: "po 1 kuponie", "po 3 kuponach"

/**
 * Fold the full 0..6 hit distribution into the four buckets the chart shows: 0, 1, 2, and
 * "3+" (every prize-winning result — 3,4,5,6 — collapsed, since 4/5/6 are individually
 * near-invisible). Works on both the observed counts and the expected (pmf·k) values.
 */
export function bucketDistribution(observed, expected) {
  const threePlus = (d) => (d[3] || 0) + (d[4] || 0) + (d[5] || 0) + (d[6] || 0);
  return {
    categories: ['0', '1', '2', '3+'],
    observed: [observed[0] || 0, observed[1] || 0, observed[2] || 0, threePlus(observed)],
    expected: [expected[0] || 0, expected[1] || 0, expected[2] || 0, threePlus(expected)],
  };
}

/**
 * Turn the cumulative rows into the stacked (lower, range) pair ECharts needs to paint the
 * ±2σ band as one filled area: an invisible `lower` baseline stacked under a filled
 * `range` (= upper − lower). The lower bound is clamped at 0 — a cumulative hit count can
 * never be negative, so the Gaussian band is not drawn below the axis. `upper` is returned
 * too, for the tooltip.
 */
export function bandSeries(cumulative) {
  const lower = cumulative.map((c) => Math.max(0, c.expected - c.sigmaBand));
  const upper = cumulative.map((c) => c.expected + c.sigmaBand);
  const range = cumulative.map((_, i) => upper[i] - lower[i]);
  return { lower, upper, range };
}

/**
 * The honest verdict line under the chart. It states position relative to the noise band
 * and NEVER claims an edge — even above the band is "still noise, not an edge", because the
 * model's advantage lives in EV|win, not in hit count (SPEC §8.5).
 */
export function scorecardVerdict(cumulative) {
  if (!cumulative.length) {
    return { k: 0, status: 'empty', text: 'Jeszcze żaden typ nie został rozliczony — na razie zbieramy dowody.' };
  }
  const last = cumulative[cumulative.length - 1];
  const k = last.k;
  const delta = last.cumHits - last.expected;
  const kupon = `${k} ${pluralPl(k, KUPON_LOC)}`;

  let status;
  let phrase;
  if (Math.abs(delta) <= last.sigmaBand) {
    status = 'within';
    phrase = 'w paśmie szumu — dokładnie jak być powinno';
  } else if (delta > 0) {
    status = 'above';
    phrase = 'chwilowo powyżej pasma — ale to wciąż szum, nie przewaga';
  } else {
    status = 'below';
    phrase = 'chwilowo poniżej pasma — też mieści się w granicach szumu';
  }
  return { k, status, delta, text: `Po ${kupon}: ${phrase}.` };
}
