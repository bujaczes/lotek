// Pure value->color mapping for the blankiet heatmap. No DOM. Unit-tested in
// tests/blanket-scale.test.js. A simple per-channel RGB lerp is used (not OKLCH):
// the fixed heat scale #fff3c4 -> #ffc400 -> #e4372e already rises smoothly in
// hue and lightness, so a straight sRGB lerp reads clean and stays trivial to
// reason about and test.

export const HEAT_STOPS = ['#fff3c4', '#ffc400', '#e4372e'];

// Diverging scale for z-score. The warm poles come from the palette (hot =
// --color-hot); the cool pole is the one color the fixed palette lacks — a muted
// steel blue chosen to sit quietly against the navy ink. Neutral is a near-paper
// tone so numbers "in the noise" (z ~ 0) barely register, which is the point.
export const DIVERGING = { cool: '#3e6c8e', neutral: '#f4f1e8', hot: '#e4372e' };

// z-score is displayed on a fixed +/-3 sigma domain: it keeps the scale stable
// across datasets and reinforces the honest caption — real numbers top out well
// inside +/-3, so none of them is meaningfully "hot".
export const Z_DOMAIN = 3;

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const hex2 = (n) => n.toString(16).padStart(2, '0');

function parseHex(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function lerpHex(a, b, t) {
  const k = clamp01(t);
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const mix = (x, y) => Math.round(x + (y - x) * k);
  return `#${hex2(mix(ar, br))}${hex2(mix(ag, bg))}${hex2(mix(ab, bb))}`;
}

// Three-stop sequential scale. t in [0,1]: 0 -> pale, 0.5 -> Lotto yellow, 1 -> hot.
export function heatColor(t) {
  const k = clamp01(t);
  if (k <= 0.5) return lerpHex(HEAT_STOPS[0], HEAT_STOPS[1], k / 0.5);
  return lerpHex(HEAT_STOPS[1], HEAT_STOPS[2], (k - 0.5) / 0.5);
}

// Three-stop diverging scale. t in [0,1]: 0 -> cool, 0.5 -> neutral, 1 -> hot.
export function divergingColor(t) {
  const k = clamp01(t);
  if (k <= 0.5) return lerpHex(DIVERGING.cool, DIVERGING.neutral, k / 0.5);
  return lerpHex(DIVERGING.neutral, DIVERGING.hot, (k - 0.5) / 0.5);
}

// Corner micro-dot: a number's freshness on its own green->red scale, independent
// of the active mode. Fresh (gap 0) = green, long-absent (max gap) = red.
export function freshnessDotColor(gap, maxGap) {
  const t = maxGap > 0 ? gap / maxGap : 0;
  return lerpHex('#0e9f6e', '#e4372e', t);
}

// Muted fill for a field whose value is unknown in the active mode (e.g. a null
// z-score on a tiny dataset). Never happens on full history.
export const MUTED_FILL = '#ece9e0';

const INK = '#191a2e';
const ON_DARK = '#fff7ea';

// Pick a legible numeral color for a given ball fill, by sRGB relative luminance.
// Dark fills (deep red, cool blue) get warm-white; light fills keep the ink navy.
export function textColorFor(hex) {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.42 ? ON_DARK : INK;
}

function minMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Map the 49 blanket entries to render data for a mode.
 * Returns [{ number, value, t, fill }] where `t` is the 0..1 scale position
 * (null when the value is unknown) and `fill` is the resolved hex color.
 *
 *  - frequency: total draws, normalized across the 49 (rarest 0 -> most frequent 1).
 *  - freshness: currentGap INVERTED (freshest 1 -> longest-absent 0), heat scale.
 *  - zscore:    z on a fixed +/-3 diverging scale (cool negatives, hot positives).
 */
export function buildFieldData(entries, mode) {
  if (mode === 'zscore') {
    return entries.map((e) => {
      const z = e.zScore;
      if (z == null) return { number: e.number, value: null, t: null, fill: MUTED_FILL };
      const t = clamp01((z + Z_DOMAIN) / (2 * Z_DOMAIN));
      return { number: e.number, value: z, t, fill: divergingColor(t) };
    });
  }

  const key = mode === 'freshness' ? 'currentGap' : 'total';
  const { min, max } = minMax(entries.map((e) => e[key]));
  const span = max - min;

  return entries.map((e) => {
    const value = e[key];
    if (value == null) return { number: e.number, value: null, t: null, fill: MUTED_FILL };
    let t = span > 0 ? (value - min) / span : 0.5;
    if (mode === 'freshness') t = 1 - t; // invert: small gap = fresh = hot
    return { number: e.number, value, t, fill: heatColor(t) };
  });
}
