// Chi-squared survival function (upper-tail p-value), pure math, no dependencies.
//
// chi2Sf(x, df) = P(X > x) for X ~ chi-squared with `df` degrees of freedom
//               = Q(df/2, x/2), the regularised upper incomplete gamma.
//
// Two code paths, matching the brief:
//   - even df: exact closed form  exp(-x/2) * Σ_{j=0}^{df/2-1} (x/2)^j / j!
//   - odd  df: regularised upper incomplete gamma Q(a, y) with a=df/2, y=x/2,
//              via a Lentz continued fraction (y >= a+1) or a series (y < a+1).
// Verified against scipy anchors and an independent Simpson integration in tests.

const EPS = 1e-15;
const FPMIN = 1e-300;

// Lanczos approximation for ln Gamma(z), g=7, n=9. Accurate to ~1e-15 for z >= 0.5,
// which is all we need here (a = df/2 >= 0.5 for df >= 1).
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function lnGamma(z) {
  if (z < 0.5) {
    // reflection: Gamma(z)Gamma(1-z) = pi/sin(pi z)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) x += LANCZOS[i] / (z + i);
  const t = z + 7 + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Lower regularised incomplete gamma P(a, y) via the series expansion (good for y < a+1).
function gammaPSeries(a, y) {
  if (y <= 0) return 0;
  const gln = lnGamma(a);
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < 10000; n++) {
    ap += 1;
    del *= y / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-y + a * Math.log(y) - gln);
}

// Upper regularised incomplete gamma Q(a, y) via the modified Lentz continued
// fraction (good for y >= a+1). Numerical Recipes gcf.
function gammaQContinuedFraction(a, y) {
  const gln = lnGamma(a);
  let b = y + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-y + a * Math.log(y) - gln) * h;
}

// Q(a, y) = 1 - P(a, y): the regularised upper incomplete gamma.
function gammaQ(a, y) {
  if (y < 0 || a <= 0) throw new Error(`gammaQ: invalid args a=${a}, y=${y}`);
  if (y === 0) return 1;
  if (y < a + 1) return 1 - gammaPSeries(a, y);
  return gammaQContinuedFraction(a, y);
}

// Even-df closed form: exp(-y) * Σ_{j=0}^{k-1} y^j / j!, y = x/2, k = df/2.
// Terms are summed smallest-first (ascending j) for stability; for x up to ~500 the
// largest term stays well within double range (verified for df <= 48 in tests).
function chi2SfEven(x, df) {
  const y = x / 2;
  const k = df / 2;
  let term = 1; // j = 0 term: y^0 / 0! = 1
  let sum = 1;
  for (let j = 1; j < k; j++) {
    term *= y / j;
    sum += term;
  }
  return Math.exp(-y) * sum;
}

/**
 * Survival function of the chi-squared distribution: P(X > x), X ~ chi2(df).
 * `df` must be a positive integer; `x` a non-negative finite number.
 */
export function chi2Sf(x, df) {
  if (!Number.isInteger(df) || df < 1) throw new Error(`chi2Sf: df must be a positive integer (got ${df})`);
  if (!Number.isFinite(x) || x < 0) throw new Error(`chi2Sf: x must be a non-negative finite number (got ${x})`);
  if (x === 0) return 1;
  if (df % 2 === 0) return chi2SfEven(x, df);
  return gammaQ(df / 2, x / 2);
}
