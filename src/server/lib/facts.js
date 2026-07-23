import { maskFromNumbers } from './mask.js';
import { sumDistribution } from './theory.js';

/**
 * "Ciekawostka dnia" generator — deterministic, I/O-free. `generateFact(draws)` evaluates
 * a fixed ladder of rules against the LATEST draw (the last element of an ascending
 * `[{drawNumber, drawnAt, numbers}]` array) and returns the FIRST match as `{type, text}`
 * (Polish copy). Same input → byte-identical output: no clock, no RNG. The DB-reading
 * wrapper + `GET /api/facts/latest` live in `src/server/facts.js`; the result is memoized
 * under `facts:latest` and thus invalidated by `rebuildStats` after every import.
 *
 * Rule ladder (highest priority first, matching the Task 18 brief):
 *   1 dejavu           — the six-number combination has occurred before (mask repeat)
 *   2 sum_record       — the sum is a NEW all-time max or min
 *   3 sum_percentile   — the sum sits in a theoretical tail (<5% or >95% of C(49,6))
 *   4 consecutive      — a run of >=3 consecutive integers within the draw
 *   5 record_absence   — a number returned after its longest-ever gap (>= MIN_RECORD_GAP)
 *   6 streak           — a number present in the last >=3 consecutive draws
 *   7 milestone        — round draw number (draw_number % 500 == 0)
 *   8 birthday         — extreme "urodzinowość": 0 or 6 numbers <= 31
 *   9 zscore           — fallback: the draw's most deviating number by |z-score|
 */

const MAX_NUMBER = 49;
const NUMBERS_PER_DRAW = 6;
const BIRTHDAY_MAX = 31;
const MIN_RUN = 3;
const MIN_STREAK = 3;
const MILESTONE = 500;
// A returning number only counts as a "record-long absence" when the gap it just closed
// is both a strict personal record AND at least this many draws — otherwise a number's
// very first completed gap (always a "record") would fire on trivially short absences.
const MIN_RECORD_GAP = 15;
const FIRST_DRAW_DATE = '27.01.1957';
const MEAN_SUM = 150;

// Theoretical distribution of the six-number sum over all C(49,6) combinations. Pure and
// db-independent, so computed once at module load (same pattern as stats.js's SUM_DIST).
const SUM_ROWS = sumDistribution();
const SUM_TOTAL = SUM_ROWS.reduce((s, r) => s + r.count, 0); // === C(49,6)

/** Share (in %) of all combinations whose sum is <= `sum` (theoretical CDF at `sum`). */
export function sumPercentile(sum) {
  let below = 0;
  for (const r of SUM_ROWS) if (r.sum <= sum) below += r.count;
  return (below / SUM_TOTAL) * 100;
}

function sumTailShares(sum) {
  let below = 0;
  let above = 0;
  for (const r of SUM_ROWS) {
    if (r.sum <= sum) below += r.count;
    if (r.sum >= sum) above += r.count;
  }
  return { atOrBelow: (below / SUM_TOTAL) * 100, atOrAbove: (above / SUM_TOTAL) * 100 };
}

// --- small deterministic formatters -----------------------------------------------------

function plDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function plNumberList(numbers) {
  return numbers.join(', ');
}

/** z-score with an explicit sign and a Polish decimal comma, e.g. "+1,84" / "-2,10". */
function formatZ(z) {
  const sign = z < 0 ? '-' : '+';
  return `${sign}${Math.abs(z).toFixed(2).replace('.', ',')}`;
}

/** percentage rounded to one decimal with a Polish comma, e.g. "3,7". */
function formatPct(p) {
  return p.toFixed(1).replace('.', ',');
}

// --- per-number derivations (pure) ------------------------------------------------------

function numberOccurrences(draws) {
  const occ = new Map();
  for (let n = 1; n <= MAX_NUMBER; n++) occ.set(n, []);
  for (const d of draws) {
    for (const n of d.numbers) occ.get(n).push(d.drawNumber);
  }
  return occ;
}

function zScore(count, N) {
  if (N <= 0) return 0;
  const denom = Math.sqrt(N * NUMBERS_PER_DRAW * (1 / MAX_NUMBER) * ((MAX_NUMBER - 1) / MAX_NUMBER));
  return (count - (N * NUMBERS_PER_DRAW) / MAX_NUMBER) / denom;
}

/**
 * For an ascending list of a number's occurrence draw-numbers: the gap it most recently
 * closed and whether that gap is a strict personal record. `lastGap` is null with fewer
 * than two occurrences (no completed gap exists).
 */
function gapInfo(occDrawNumbers) {
  if (occDrawNumbers.length < 2) return { lastGap: null, isRecord: false };
  let maxOther = -1;
  for (let i = 1; i < occDrawNumbers.length - 1; i++) {
    const g = occDrawNumbers[i] - occDrawNumbers[i - 1] - 1;
    if (g > maxOther) maxOther = g;
  }
  const last = occDrawNumbers.length - 1;
  const lastGap = occDrawNumbers[last] - occDrawNumbers[last - 1] - 1;
  return { lastGap, isRecord: lastGap > maxOther };
}

/** Trailing run of consecutive draw-numbers ending at the number's last occurrence. */
function trailingStreak(occDrawNumbers) {
  if (occDrawNumbers.length === 0) return 0;
  let streak = 1;
  for (let i = occDrawNumbers.length - 1; i > 0; i--) {
    if (occDrawNumbers[i] - occDrawNumbers[i - 1] === 1) streak++;
    else break;
  }
  return streak;
}

/** Longest run of consecutive integers within a draw's sorted numbers. */
function longestConsecutiveRun(numbers) {
  let best = [numbers[0]];
  let cur = [numbers[0]];
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] === numbers[i - 1] + 1) cur.push(numbers[i]);
    else cur = [numbers[i]];
    if (cur.length > best.length) best = cur.slice();
  }
  return best;
}

// --- text builders ----------------------------------------------------------------------

function dejavuFact(latest, prior, N) {
  return {
    type: 'dejavu',
    text:
      `Déjà vu! Identyczna szóstka — ${plNumberList(latest.numbers)} — padła już w losowaniu ` +
      `nr ${prior.drawNumber} z ${plDate(prior.drawnAt)}. Przy ${N} losowaniach powtórka całej ` +
      `kombinacji to prawdziwy ewenement.`,
  };
}

function sumRecordFact(latest, sum, kind) {
  const word = kind === 'max' ? 'najwyższa' : 'najniższa';
  return {
    type: 'sum_record',
    text:
      `Nowy rekord! Suma ${sum} liczb w losowaniu nr ${latest.drawNumber} jest ${word} w całej ` +
      `historii Dużego Lotka (średnia suma to ${MEAN_SUM}, teoretyczny zakres 21–279).`,
  };
}

function sumPercentileFact(latest, sum, share, side) {
  if (side === 'low') {
    return {
      type: 'sum_percentile',
      text:
        `Nietypowo niska suma: ${sum}. Teoretycznie zaledwie ${formatPct(share)}% wszystkich ` +
        `kombinacji ma sumę tak niską lub niższą (średnia to ${MEAN_SUM}).`,
    };
  }
  return {
    type: 'sum_percentile',
    text:
      `Nietypowo wysoka suma: ${sum}. Teoretycznie zaledwie ${formatPct(share)}% wszystkich ` +
      `kombinacji ma sumę tak wysoką lub wyższą (średnia to ${MEAN_SUM}).`,
  };
}

function consecutiveFact(latest, run) {
  return {
    type: 'consecutive',
    text:
      `Ciąg kolejnych liczb! W losowaniu nr ${latest.drawNumber} padły ${plNumberList(run)} — ` +
      `${run.length} następujące po sobie liczby. Rzadszy widok, niż podpowiada intuicja.`,
  };
}

function recordAbsenceFact(latest, absence) {
  return {
    type: 'record_absence',
    text:
      `Powrót po rekordowej przerwie: liczba ${absence.number} nie pojawiała się przez ` +
      `${absence.gap} losowań — najdłużej w swojej historii — i wróciła w losowaniu ` +
      `nr ${latest.drawNumber}. Przerwa nie zwiększała jej szans; to gambler's fallacy.`,
  };
}

function streakFact(latest, streak) {
  const from = latest.drawNumber - streak.streak + 1;
  return {
    type: 'streak',
    text:
      `Liczba ${streak.number} jest w serii — padła w ${streak.streak} losowaniach z rzędu ` +
      `(nr ${from}–${latest.drawNumber}). Efektowne, ale każde losowanie jest niezależne od poprzedniego.`,
  };
}

function milestoneFact(latest) {
  return {
    type: 'milestone',
    text:
      `Okrągły jubileusz — to już losowanie nr ${latest.drawNumber}! Maszyna kręci od ` +
      `${FIRST_DRAW_DATE} i wciąż żaden trwały wzór się nie ujawnił.`,
  };
}

function birthdayFact(latest, count) {
  if (count === 0) {
    return {
      type: 'birthday',
      text:
        `Zero liczb „urodzinowych”: wszystkie sześć liczb (${plNumberList(latest.numbers)}) jest ` +
        `powyżej 31. Kupony typowane datami nie miały dziś żadnej z nich — a to właśnie one ` +
        `najczęściej dzielą się nagrodą.`,
    };
  }
  return {
    type: 'birthday',
    text:
      `Same „urodzinowe” liczby: wszystkie sześć (${plNumberList(latest.numbers)}) mieści się w ` +
      `zakresie 1–31. Gdyby ta szóstka wygrała, pulę dzieliłoby wyjątkowo wielu graczy typujących daty.`,
  };
}

function zscoreFact(latest, best) {
  const moreOrLess = best.z >= 0 ? 'częściej' : 'rzadziej';
  return {
    type: 'zscore',
    text:
      `Najbardziej wyróżniająca się liczba losowania nr ${latest.drawNumber} to ${best.number}: ` +
      `w historii padła ${best.count} razy, ${moreOrLess} niż przeciętnie (z-score ${formatZ(best.z)}). ` +
      `Z-score mówi, o ile częstość odbiega od średniej, liczone w „krokach”: wszystko między −3 a +3 ` +
      `to u loterii zwykłe wahanie przypadku. To nie znaczy, że liczba ${best.number} jest „gorąca” — ` +
      `w następnym losowaniu ma dokładnie takie same szanse jak każda inna.`,
  };
}

// --- the ladder -------------------------------------------------------------------------

export function generateFact(draws) {
  if (!draws || draws.length === 0) return null;
  const N = draws.length;
  const latest = draws[N - 1];
  const nums = latest.numbers;
  const latestSum = nums.reduce((s, n) => s + n, 0);

  // 1 — déjà vu (mask repeat against any earlier draw)
  const latestMask = maskFromNumbers(nums);
  for (let i = N - 2; i >= 0; i--) {
    if (maskFromNumbers(draws[i].numbers) === latestMask) return dejavuFact(latest, draws[i], N);
  }

  // 2 — new all-time sum record (needs at least one earlier draw to be a "new" record)
  if (N >= 2) {
    let prevMax = -Infinity;
    let prevMin = Infinity;
    for (let i = 0; i < N - 1; i++) {
      const s = draws[i].numbers.reduce((a, b) => a + b, 0);
      if (s > prevMax) prevMax = s;
      if (s < prevMin) prevMin = s;
    }
    if (latestSum > prevMax) return sumRecordFact(latest, latestSum, 'max');
    if (latestSum < prevMin) return sumRecordFact(latest, latestSum, 'min');
  }

  // 3 — sum in a theoretical tail (<5% low, >95% high)
  const shares = sumTailShares(latestSum);
  if (shares.atOrBelow < 5) return sumPercentileFact(latest, latestSum, shares.atOrBelow, 'low');
  if (shares.atOrBelow > 95) return sumPercentileFact(latest, latestSum, shares.atOrAbove, 'high');

  // 4 — run of >=3 consecutive integers
  const run = longestConsecutiveRun(nums);
  if (run.length >= MIN_RUN) return consecutiveFact(latest, run);

  const occ = numberOccurrences(draws);

  // 5 — a number returning after its longest-ever (>= MIN_RECORD_GAP) absence
  let bestAbsence = null;
  for (const n of nums) {
    const g = gapInfo(occ.get(n));
    if (g.isRecord && g.lastGap !== null && g.lastGap >= MIN_RECORD_GAP) {
      if (!bestAbsence || g.lastGap > bestAbsence.gap) bestAbsence = { number: n, gap: g.lastGap };
    }
  }
  if (bestAbsence) return recordAbsenceFact(latest, bestAbsence);

  // 6 — a number on a streak of >=3 consecutive draws
  let bestStreak = null;
  for (const n of nums) {
    const s = trailingStreak(occ.get(n));
    if (s >= MIN_STREAK) {
      if (!bestStreak || s > bestStreak.streak) bestStreak = { number: n, streak: s };
    }
  }
  if (bestStreak) return streakFact(latest, bestStreak);

  // 7 — round-number milestone
  if (latest.drawNumber % MILESTONE === 0) return milestoneFact(latest);

  // 8 — extreme birthday-ness (0 or 6 numbers <= 31)
  const birthdayCount = nums.filter((n) => n <= BIRTHDAY_MAX).length;
  if (birthdayCount === 0 || birthdayCount === 6) return birthdayFact(latest, birthdayCount);

  // 9 — fallback: the draw's most deviating number by |z-score| (lowest number breaks ties)
  let best = null;
  for (const n of nums) {
    const count = occ.get(n).length;
    const z = zScore(count, N);
    if (!best || Math.abs(z) > Math.abs(best.z)) best = { number: n, z, count };
  }
  return zscoreFact(latest, best);
}
