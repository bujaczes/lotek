import { describe, expect, it } from 'vitest';
import { chi2Sf } from '../src/server/lib/typer/chi2.js';

// ---------------------------------------------------------------------------
// Independent reference implementation #2: direct numerical integration of the
// chi-squared pdf tail via composite Simpson's rule. Its gamma normalisation is
// computed from closed-form factorial / double-factorial identities, so it shares
// NO code with the production chi2Sf (which uses a Lanczos lgamma + a Lentz
// continued fraction / series for the regularised incomplete gamma). Agreement
// between the two to ~1e-8 is the correctness evidence for chi2Sf.
// ---------------------------------------------------------------------------

// ln Gamma(k/2) for positive integer k, from exact identities:
//   k even -> Gamma(m)     = (m-1)!            with m = k/2
//   k odd  -> Gamma(m+1/2) = (2m)!/(4^m m!) * sqrt(pi)   with m = (k-1)/2
function lnGammaHalfInt(k) {
  if (k % 2 === 0) {
    const m = k / 2;
    let s = 0;
    for (let j = 2; j <= m - 1; j++) s += Math.log(j);
    return s; // ln((m-1)!)
  }
  const m = (k - 1) / 2;
  let ln2mFact = 0;
  for (let j = 2; j <= 2 * m; j++) ln2mFact += Math.log(j);
  let lnmFact = 0;
  for (let j = 2; j <= m; j++) lnmFact += Math.log(j);
  return ln2mFact - m * Math.LN2 * 2 - lnmFact + 0.5 * Math.log(Math.PI);
}

function chi2SfSimpson(x, df) {
  const a2 = df / 2;
  const lnG = lnGammaHalfInt(df);
  const pdf = (t) => {
    if (t <= 0) return a2 > 1 ? 0 : t === 0 && df === 2 ? 0.5 : 0;
    const logf = (a2 - 1) * Math.log(t) - t / 2 - a2 * Math.LN2 - lnG;
    return Math.exp(logf);
  };
  // Upper bound well into the negligible tail; smooth integrand => Simpson is exact-ish.
  const T = Math.max(x, df) + 30 * Math.sqrt(2 * df) + 60;
  const N = 200000; // even
  const h = (T - x) / N;
  let s = pdf(x) + pdf(T);
  for (let i = 1; i < N; i++) {
    s += (i % 2 === 0 ? 2 : 4) * pdf(x + i * h);
  }
  return (s * h) / 3;
}

describe('chi2Sf — reference anchors (scipy.stats.chi2.sf)', () => {
  // These three anchors are reproduced EXACTLY by chi2Sf (to ~15 digits):
  it('chi2.sf(10, 10) = 0.4404932850652127', () => {
    expect(chi2Sf(10, 10)).toBeCloseTo(0.4404932850652127, 12);
  });

  it('chi2.sf(3.84, 1) = 0.05004352124870519 (odd df path)', () => {
    expect(chi2Sf(3.84, 1)).toBeCloseTo(0.05004352124870519, 12);
  });

  it('chi2.sf(0, 48) = 1.0 exactly', () => {
    expect(chi2Sf(0, 48)).toBe(1.0);
  });

  // The brief's anchors for (48,48) and (60,48) DISAGREE with a careful derivation.
  // FOUR independent methods — the even-df closed form, its Kahan-summed variant, the
  // cumulative-Poisson form P(Poisson(x/2) <= df/2-1), and the Simpson integration in
  // the block below — all agree to ~1e-15 on the values asserted here. In particular
  // SF(48, df=48) = P(Poisson(24) <= 23) = 0.4728497... is textbook Poisson–chi²
  // duality, not a numerical artefact. The brief's 0.4667693834471520 actually equals
  // chi2.sf(x≈48.150, 48) and its 0.1120165946732 equals chi2.sf(x≈60.156, 48) — i.e.
  // the brief anchors are evaluated at a slightly shifted x. Per the brief's own
  // instruction ("TRUST A CAREFUL DERIVATION and note the discrepancy rather than
  // fudging the test") we assert the derived, cross-validated values.
  it('chi2.sf(48, 48) = 0.4728497205477438 (brief anchor 0.46677 is at x≈48.15; corrected)', () => {
    expect(chi2Sf(48, 48)).toBeCloseTo(0.4728497205477438, 12);
  });

  it('chi2.sf(60, 48) = 0.1146459127142738 (brief anchor 0.11202 is at x≈60.16; corrected)', () => {
    expect(chi2Sf(60, 48)).toBeCloseTo(0.1146459127142738, 12);
  });
});

describe('chi2Sf — cross-check vs independent Simpson integration (~1e-8 rel)', () => {
  const points = [
    [48, 48],
    [60, 48],
    [10, 10],
    [3.84, 1],
    [1, 1],
    [5, 3],
    [20, 15],
    [30, 25],
    [2, 4],
    [100, 90],
    [40, 48],
    [7, 7],
  ];

  for (const [x, df] of points) {
    it(`agrees with Simpson at x=${x}, df=${df}`, () => {
      const a = chi2Sf(x, df);
      const b = chi2SfSimpson(x, df);
      const relErr = Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
      expect(relErr).toBeLessThan(1e-8);
    });
  }

  it('Simpson SF(0, 48) integrates to ~1.0 (normalisation sanity)', () => {
    expect(chi2SfSimpson(0, 48)).toBeCloseTo(1.0, 6);
  });
});

describe('chi2Sf — basic invariants', () => {
  it('returns 1 at x=0 for several df (even and odd)', () => {
    for (const df of [1, 2, 3, 10, 25, 48]) {
      expect(chi2Sf(0, df)).toBe(1.0);
    }
  });

  it('is strictly decreasing in x', () => {
    let prev = chi2Sf(0, 48);
    for (const x of [10, 20, 40, 48, 60, 80, 120]) {
      const v = chi2Sf(x, 48);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('stays within [0, 1] across a wide range', () => {
    for (const df of [1, 5, 12, 48]) {
      for (const x of [0.01, 1, 5, 50, 200, 500]) {
        const v = chi2Sf(x, df);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('handles very large x without NaN/overflow (deep tail ~0)', () => {
    const v = chi2Sf(500, 48);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1e-40);
  });
});
