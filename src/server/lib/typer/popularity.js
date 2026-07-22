import { numberToCell } from '../blanket.js';
import { maskFromNumbers } from '../mask.js';

// Składnik B — anty-popularność (SPEC §8.2). We model how *popular* a coupon is among
// human players (birthday dates, lucky numbers, geometric patterns, replayed historical
// winners) — high popularity is BAD because a shared jackpot is split more ways, so the
// engine subtracts wB·popularity(S) from the score.
//
// Operationalization of the SPEC formula. SPEC writes it loosely as
//   popularity(S) = Σ_i w(n_i)  +  Π kary_wzorcowe(S)
// but a raw "+" of a sum-of-weights and a product-of-penalties is dimensionally odd (a
// penalty of 1.0 = "no pattern" would still add 1.0). We operationalize it as a MULTIPLY —
// the pattern penalties SCALE the base weight mass:
//   popularity(S) = (Σ_i w(n_i)) · Π kary_wzorcowe(S)
// so "no pattern" (every penalty = 1.0) leaves the weight mass untouched, and each pattern
// multiplies it up. This matches the intent ("mnożniki > 1 = popularne = złe") and keeps
// the quantity a pure popularity mass. Documented here as the single source of truth.

const MAX_NUMBER = 49;
const NUMBERS_PER_DRAW = 6;
const HIGH_MIN = 40; // 40..49 = least-played band -> discount
const BIRTHDAY_MAX = 31; // 1..31 = calendar day
const DAY_MONTH_MAX = 12; // 1..12 = also a month
const HIGH_LOW_SPLIT = 32; // "high" number = >= 32 (allHigh / allBirthday second-order trap)

// ---------------------------------------------------------------------------
// Per-number weights w[49] (index 0 = number 1).
// ---------------------------------------------------------------------------
/**
 * w(n) = base
 *        + birthdayBonus  when n <= 31   (players over-pick calendar days)
 *        + dayMonthBonus  when n <= 12   (also a valid month -> extra crowding)
 *        × luckyMultipliers[n] when listed (7, 13, 3, 9, 11, 17)
 *        × highDiscount   when 40 <= n <= 49 (least-played band)
 * Lucky numbers are all <= 31 and the discount band is 40..49, so the two multipliers
 * never apply to the same number; multiplication order is therefore irrelevant.
 */
export function numberWeights(cfg) {
  const p = cfg.popularity;
  const lucky = p.luckyMultipliers;
  const w = new Array(MAX_NUMBER);
  for (let n = 1; n <= MAX_NUMBER; n++) {
    let x = p.base;
    if (n <= BIRTHDAY_MAX) x += p.birthdayBonus;
    if (n <= DAY_MONTH_MAX) x += p.dayMonthBonus;
    const m = lucky[n];
    if (m != null) x *= m;
    if (n >= HIGH_MIN && n <= MAX_NUMBER) x *= p.highDiscount;
    w[n - 1] = x;
  }
  return w;
}

// ---------------------------------------------------------------------------
// 7×7 blankiet line ids, built ONCE from the single-source-of-truth geometry in
// blanket.js. For each number we store its row, column, and both diagonal ids:
//   d1 = row - col  (+6 to keep it non-negative)  -> the "↘" diagonals
//   d2 = row + col                                -> the "↙" (anti) diagonals
// Two numbers are colinear on a line iff they share one of these four ids. Because there
// are only 7 rows/cols and 13 diagonals, a line of >=4 selected numbers necessarily sits
// on a grid line of length >=4, so "share an id, count >= 4" is exactly the SPEC's
// "≥4 liczby w jednej linii/kolumnie/przekątnej ... długości ≥4".
function buildLineIds() {
  const rowOf = new Int8Array(MAX_NUMBER + 1);
  const colOf = new Int8Array(MAX_NUMBER + 1);
  const d1 = new Int8Array(MAX_NUMBER + 1);
  const d2 = new Int8Array(MAX_NUMBER + 1);
  for (let n = 1; n <= MAX_NUMBER; n++) {
    const { row, col } = numberToCell(n);
    rowOf[n] = row;
    colOf[n] = col;
    d1[n] = row - col + 6; // 0..12
    d2[n] = row + col; // 0..12
  }
  return { rowOf, colOf, d1, d2 };
}

export const LINE_IDS = buildLineIds();

// Allocation-free "do >=4 of these six ids share a value?" — increment a scratch counter
// per id, test the six touched slots, then undo. Single-threaded callers only (the worker
// runs one enumeration; comboPenalty is called serially in tests/reports), so the shared
// scratch buffer is safe.
const lineScratch = new Int8Array(13);
function anyIdGE4(v0, v1, v2, v3, v4, v5) {
  lineScratch[v0]++;
  lineScratch[v1]++;
  lineScratch[v2]++;
  lineScratch[v3]++;
  lineScratch[v4]++;
  lineScratch[v5]++;
  const hit =
    lineScratch[v0] >= 4 ||
    lineScratch[v1] >= 4 ||
    lineScratch[v2] >= 4 ||
    lineScratch[v3] >= 4 ||
    lineScratch[v4] >= 4 ||
    lineScratch[v5] >= 4;
  lineScratch[v0]--;
  lineScratch[v1]--;
  lineScratch[v2]--;
  lineScratch[v3]--;
  lineScratch[v4]--;
  lineScratch[v5]--;
  return hit;
}

/**
 * True when >=4 of the six numbers are colinear on the 7×7 blankiet (any row, column, or
 * either-orientation diagonal). `L` is a LINE_IDS-shaped object. Numbers are the raw
 * values 1..49 (need not be sorted).
 */
export function hasLine4(a, b, c, d, e, f, L = LINE_IDS) {
  const { rowOf, colOf, d1, d2 } = L;
  if (anyIdGE4(rowOf[a], rowOf[b], rowOf[c], rowOf[d], rowOf[e], rowOf[f])) return true;
  if (anyIdGE4(colOf[a], colOf[b], colOf[c], colOf[d], colOf[e], colOf[f])) return true;
  if (anyIdGE4(d1[a], d1[b], d1[c], d1[d], d1[e], d1[f])) return true;
  if (anyIdGE4(d2[a], d2[b], d2[c], d2[d], d2[e], d2[f])) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Penalty parameter pack — flattened from cfg.popularity.penalties once, so the hot
// enumeration loop never touches the nested config object. runExtraPow[k] = runPerExtra^k
// for k = 0..3 (a maximal run inside six numbers has length 3..6 -> exponent 0..3).
// ---------------------------------------------------------------------------
export function buildPenaltyParams(cfg) {
  const pen = cfg.popularity.penalties;
  const x = pen.runPerExtra;
  return {
    run3: pen.run3,
    runExtraPow: [1, x, x * x, x * x * x],
    line4plus: pen.line4plus,
    allBirthday: pen.allBirthday,
    lowSum: pen.lowSum,
    lowSumThreshold: pen.lowSumThreshold,
    historicalWinner: pen.historicalWinner,
    allHigh: pen.allHigh,
  };
}

// Consecutive-run penalty for the sorted six a<b<c<d<e<f. Each MAXIMAL run of length
// L>=3 contributes run3·runPerExtra^(L-3); multiple maximal runs COMBINE MULTIPLICATIVELY
// (e.g. {1,2,3, 10,11,12} -> run3² · runPerExtra⁰). Unrolled and allocation-free.
function runPenaltyScalar(a, b, c, d, e, f, P) {
  let mult = 1;
  let len = 1;
  if (b === a + 1) len++;
  else {
    if (len >= 3) mult *= P.run3 * P.runExtraPow[len - 3];
    len = 1;
  }
  if (c === b + 1) len++;
  else {
    if (len >= 3) mult *= P.run3 * P.runExtraPow[len - 3];
    len = 1;
  }
  if (d === c + 1) len++;
  else {
    if (len >= 3) mult *= P.run3 * P.runExtraPow[len - 3];
    len = 1;
  }
  if (e === d + 1) len++;
  else {
    if (len >= 3) mult *= P.run3 * P.runExtraPow[len - 3];
    len = 1;
  }
  if (f === e + 1) len++;
  else {
    if (len >= 3) mult *= P.run3 * P.runExtraPow[len - 3];
    len = 1;
  }
  if (len >= 3) mult *= P.run3 * P.runExtraPow[len - 3];
  return mult;
}

/**
 * The full pattern-penalty product for the sorted six a<b<c<d<e<f with precomputed
 * `sum` and `mask`. `P` = buildPenaltyParams(cfg), `winnerMasks` = a Set of historical
 * winning masks, `L` = LINE_IDS. Pure, allocation-free — this is the single scoring core
 * shared by comboPenalty() (canonical/reporting) and the enumeration hot loop.
 */
export function penaltyMultiplierScalar(a, b, c, d, e, f, sum, mask, P, winnerMasks, L = LINE_IDS) {
  let pen = runPenaltyScalar(a, b, c, d, e, f, P);
  if (hasLine4(a, b, c, d, e, f, L)) pen *= P.line4plus;
  if (f <= BIRTHDAY_MAX) pen *= P.allBirthday; // all six <= 31 (f is the max)
  if (a >= HIGH_LOW_SPLIT) pen *= P.allHigh; // all six >= 32 (a is the min) — 2nd-order trap
  if (sum < P.lowSumThreshold) pen *= P.lowSum;
  if (winnerMasks.has(mask)) pen *= P.historicalWinner;
  return pen;
}

function asWinnerSet(winnerMasks) {
  return winnerMasks instanceof Set ? winnerMasks : new Set(winnerMasks ?? []);
}

/**
 * Canonical combo penalty (used by tests, reports, and as the reference the hot loop is
 * cross-checked against). `numbers` need not be sorted. `winnerMasks` may be a Set or any
 * iterable of masks.
 */
export function comboPenalty(numbers, cfg, winnerMasks) {
  const s = [...numbers].sort((x, y) => x - y);
  const sum = s[0] + s[1] + s[2] + s[3] + s[4] + s[5];
  const mask = maskFromNumbers(s);
  const P = buildPenaltyParams(cfg);
  return penaltyMultiplierScalar(s[0], s[1], s[2], s[3], s[4], s[5], sum, mask, P, asWinnerSet(winnerMasks));
}

/**
 * popularity(S) = (Σ w(n_i)) · Π kary_wzorcowe(S). See the operationalization note at the
 * top of this file (SPEC §8.2). `weights` may be passed in (numberWeights(cfg)) to avoid
 * recomputing it; omit to have it built here.
 */
export function popularity(numbers, cfg, winnerMasks, weights = numberWeights(cfg)) {
  let sw = 0;
  for (const n of numbers) sw += weights[n - 1];
  return sw * comboPenalty(numbers, cfg, winnerMasks);
}

/**
 * Human-readable breakdown of which penalties fired for one combo — for the
 * popularityReport (winnerPenalties) and for tests. Not on the hot path.
 */
export function penaltyBreakdown(numbers, cfg, winnerMasks) {
  const s = [...numbers].sort((x, y) => x - y);
  const [a, b, c, d, e, f] = s;
  const sum = a + b + c + d + e + f;
  const mask = maskFromNumbers(s);
  const P = buildPenaltyParams(cfg);
  const ws = asWinnerSet(winnerMasks);

  // Maximal consecutive runs (lengths), for the "run" factor.
  const runs = [];
  let len = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1] + 1) len++;
    else {
      if (len >= 3) runs.push(len);
      len = 1;
    }
  }
  if (len >= 3) runs.push(len);
  const runFactor = runs.reduce((m, l) => m * P.run3 * P.runExtraPow[l - 3], 1);

  const line4plus = hasLine4(a, b, c, d, e, f);
  const allBirthday = f <= BIRTHDAY_MAX;
  const allHigh = a >= HIGH_LOW_SPLIT;
  const lowSum = sum < P.lowSumThreshold;
  const historicalWinner = ws.has(mask);

  const multiplier = penaltyMultiplierScalar(a, b, c, d, e, f, sum, mask, P, ws);
  return {
    runs, // lengths of maximal runs (>=3) that contributed
    runFactor,
    line4plus,
    allBirthday,
    allHigh,
    lowSum,
    historicalWinner,
    sum,
    multiplier,
  };
}

export const POPULARITY_CONSTANTS = { MAX_NUMBER, NUMBERS_PER_DRAW, HIGH_MIN, BIRTHDAY_MAX, HIGH_LOW_SPLIT };
