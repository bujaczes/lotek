// Deterministic "dlaczego te liczby" narrative (SPEC §8.4). Pure: no db, no I/O, no clock.
// buildCommentary(prediction, statsCtx) -> Polish markdown, assembled entirely from the
// facts in `prediction` (the runPrediction result) and `statsCtx` (number_stat rows, the
// scheduled draw date, and an example skipped historical winning six). The SAME inputs
// ALWAYS produce the SAME string — every value that reaches the text is a plain function
// of the inputs, so the stored commentary is reproducible and testable.
//
// Honest-framing rule (CONVENTIONS.md): the text never claims any set has a higher P(6/6)
// than 1/13 983 816. The one and only probability statement is HONEST_FRAME_SENTENCE.

const TOTAL_COMBOS_TEXT = '1 : 13 983 816'; // C(49,6) — the fixed jackpot odds for every coupon
const BIRTHDAY_MAX = 31; // n <= 31 = a calendar day, over-picked
const BIRTHDAY_MASS_SUM = 120; // sums below this are the birthday-coupon mass (lowSumThreshold)
const AVG_SUM = 150; // mean draw sum (21..279)
const EXPECTED_HITS_PER_COUPON = 36 / 49; // 0.7347… — E[trafienia kuponu], the null-hypothesis reference
const DEFAULT_CHI2_ALPHA = 0.05;

// The single, exact probability sentence. Exported so the honesty test can assert it is
// present verbatim (and that no competing "higher chance" claim ever appears).
export const HONEST_FRAME_SENTENCE =
  `Zacznijmy uczciwie: szansa tego kuponu na szóstkę to ${TOTAL_COMBOS_TEXT} — ` +
  'identyczna jak każdego innego. Ten zestaw nie jest bardziej prawdopodobny — ' +
  'jest lepiej opłacalny, jeśli wygra.';

const WEEKDAYS_PL = ['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];

// pl-PL number formatting, normalized to a plain ASCII space so output is bit-identical
// across Node/ICU builds (some emit U+00A0 / U+202F as the group separator).
function plInt(n) {
  return new Intl.NumberFormat('pl-PL').format(n).replace(/\s/g, ' ');
}
function plDec(n, digits) {
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(n)
    .replace(/\s/g, ' ');
}
// Signed decimal with a real minus (U+2212) so a z-score sets like the rest of the data.
function plSigned(n, digits) {
  return `${n >= 0 ? '+' : '−'}${plDec(Math.abs(n), digits)}`;
}

function weekdayPl(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS_PL[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function ddmmyyyy(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Polish plural picker (forms = [one, few, many]) — same rule as src/format.js.
function pluralPl(n, forms) {
  const abs = Math.abs(n);
  if (abs === 1) return forms[0];
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1];
  return forms[2];
}
const draws = (n) => pluralPl(n, ['losowanie', 'losowania', 'losowań']);
const times = (n) => pluralPl(n, ['raz', 'razy', 'razy']);

function header(prediction, statsCtx) {
  const { forDrawNumber, numbers } = prediction;
  const wd = weekdayPl(statsCtx.drawDate);
  const date = ddmmyyyy(statsCtx.drawDate);
  return `**Typ na losowanie nr ${forDrawNumber} (${wd}, ${date}): ${numbers.join(', ')}**`;
}

// χ² verdict — the two branches SPEC §8.4 calls for. Above alpha: no bias, popularity
// decided. At/below alpha: the bias component co-decided; name the most-elevated number.
function chi2Verdict(prediction, alpha) {
  const { p } = prediction.chi2;
  const pText = p < 0.001 ? 'p < 0,001' : `p = ${plDec(p, 2)}`;
  if (p > alpha) {
    return (
      `Test χ² na wygaszonym oknie ostatnich losowań nie wykrywa biasu maszyny (${pText}), ` +
      'więc o wyborze zdecydował model popularności — składnik detekcji biasu jest dziś praktycznie neutralny.'
    );
  }
  const top = prediction.biasReport[0];
  return (
    `Test χ² sygnalizuje odchylenie od losowości (${pText} < ${plDec(alpha, 2)}): tym razem ` +
    'współdecydował składnik detekcji biasu. Najsilniej wygaszony sygnał niesie liczba ' +
    `${top.number} (z̃ = ${plSigned(top.z, 2)}) — infrastruktura wykryłaby wadliwy zestaw kul ` +
    'pierwsza, ale mówimy wprost: to wciąż nie zmienia szansy na szóstkę.'
  );
}

function popularityRationale(prediction) {
  const { numbers, scores, popularityReport } = prediction;
  const pen = popularityReport.winnerPenalties;
  const lowCount = numbers.filter((n) => n <= BIRTHDAY_MAX).length;
  const sum = pen.sum;

  const zoneText =
    lowCount === 0
      ? 'omija całą strefę urodzinową (żadna liczba ≤ 31)'
      : `w strefie urodzinowej ma ${lowCount} ${pluralPl(lowCount, ['liczbę', 'liczby', 'liczb'])} ≤ 31`;

  const lineText = pen.line4plus
    ? 'układa się w linię na blankiecie 7×7'
    : 'nie układa się w żadną linię na blankiecie 7×7';
  const runText =
    pen.runs && pen.runs.length > 0
      ? `zawiera ciąg kolejnych liczb (${pen.runs.join(', ')})`
      : 'nie zawiera ciągu kolejnych liczb';

  let sumText;
  if (sum < BIRTHDAY_MASS_SUM) {
    sumText = `ma sumę ${sum} — poniżej granicy ${BIRTHDAY_MASS_SUM}, w masie kuponów granych datami`;
  } else {
    const rel = sum >= AVG_SUM ? 'powyżej' : 'w okolicy';
    sumText = `ma sumę ${sum} — ${rel} średniej ${AVG_SUM} i daleko od masy kuponów urodzinowych (suma < ${BIRTHDAY_MASS_SUM})`;
  }

  // Pool-sharing conclusion grounded in the two popularity masses we actually have: the
  // winner's own popularity vs the extreme reference 1-2-3-4-5-6 (same units).
  const ref = popularityReport.rejectedExample.popularity;
  const ratio = scores.popularity > 0 ? ref / scores.popularity : Infinity;
  const ratioText = Number.isFinite(ratio) ? `${plDec(ratio, 1)}×` : 'wielokrotnie';

  return (
    `Model popularności wybrał ten kupon, bo minimalizuje obłożenie przy neutralnym składniku biasu: ` +
    `${zoneText}, ${lineText}, ${runText} i ${sumText}. Jego miara popularności to ` +
    `${plDec(scores.popularity, 2)} — dla porównania skrajnie popularny 1-2-3-4-5-6 ma ${plDec(ref, 2)}, ` +
    `czyli ${ratioText} więcej. Według modelu ewentualną pulę dzieliłby więc z odpowiednio mniejszą ` +
    'liczbą graczy niż typowy zestaw — i to jest jedyna dźwignia, jaką mamy.'
  );
}

function curiosity(prediction, statsCtx) {
  // Largest current gap among the chosen numbers (deterministic tie-break: lower number).
  let best = null;
  for (const n of prediction.numbers) {
    const gap = statsCtx.numberStats[n]?.currentGap;
    if (gap == null) continue;
    if (!best || gap > best.gap || (gap === best.gap && n < best.number)) {
      best = { number: n, gap };
    }
  }
  if (!best || best.gap <= 0) return null;
  return (
    `Ciekawostka: ${best.number} nie padła od ${best.gap} ${draws(best.gap)} — ale to bez znaczenia ` +
    'dla szans i mówimy to wprost.'
  );
}

// Returns [headingBlock, listBlock] — the list is one block of contiguous "- " lines so
// the markdown renderer groups it into a single <ul>.
function perNumberSection(prediction, statsCtx) {
  const items = [];
  for (const n of [...prediction.numbers].sort((a, b) => a - b)) {
    const s = statsCtx.numberStats[n];
    const total = s && s.totalCount != null ? `${plInt(s.totalCount)} ${times(s.totalCount)}` : 'brak danych';
    const last =
      s && s.lastDrawNumber != null && s.lastDrawnAt
        ? `ostatnio w losowaniu nr ${s.lastDrawNumber} (${ddmmyyyy(s.lastDrawnAt)})`
        : 'jeszcze nigdy';
    const z = s && s.zScore != null ? `z-score ${plSigned(s.zScore, 2)}` : 'z-score —';
    items.push(`- **${n}** — wypadła ${total} w historii, ${last}; ${z}.`);
  }
  return ['### Liczba po liczbie', items.join('\n')];
}

// Returns [headingBlock, paragraph, paragraph?] — each paragraph its own block.
function avoidedSection(prediction, statsCtx) {
  const rej = prediction.popularityReport.rejectedExample;
  const blocks = [
    '### Czego świadomie nie zagraliśmy',
    `Odrzuciliśmy ${rej.numbers.join('-')} — najpopularniejszy kupon w Polsce ` +
      `(miara popularności ${plDec(rej.popularity, 2)}, #${plInt(rej.rank)} w rankingu obłożenia ` +
      'wszystkich 13 983 816 kombinacji).',
  ];
  const skipped = statsCtx.skippedWinner;
  if (skipped && skipped.numbers) {
    const when =
      skipped.drawNumber != null && skipped.date
        ? ` z losowania nr ${skipped.drawNumber} (${ddmmyyyy(skipped.date)})`
        : '';
    blocks.push(
      `Pominęliśmy też historyczną szóstkę ${skipped.numbers.join('-')}${when} — ludzie chętnie ` +
        'odgrywają dawne wygrane, a to znaczy dzieloną pulę, gdyby akurat wróciła.'
    );
  }
  return blocks;
}

/**
 * Assembles the full deterministic commentary markdown for a prediction.
 *
 * `prediction` — the runPrediction result: {forDrawNumber, numbers, scores, chi2,
 *   biasReport, popularityReport{winnerPenalties, rejectedExample}}.
 * `statsCtx` — {drawDate:'YYYY-MM-DD', numberStats:{[n]:{totalCount,lastDrawNumber,
 *   lastDrawnAt,zScore,currentGap}}, skippedWinner:{numbers,drawNumber,date}|null,
 *   chi2Alpha?:number}.
 *
 * The blocks are joined with blank lines (paragraph breaks for the markdown renderer).
 * Every block is a pure function of the inputs — no Date.now(), no Math.random().
 */
export function buildCommentary(prediction, statsCtx) {
  const alpha = statsCtx.chi2Alpha ?? DEFAULT_CHI2_ALPHA;
  const blocks = [
    header(prediction, statsCtx),
    HONEST_FRAME_SENTENCE,
    chi2Verdict(prediction, alpha),
    popularityRationale(prediction),
    curiosity(prediction, statsCtx),
    ...perNumberSection(prediction, statsCtx),
    ...avoidedSection(prediction, statsCtx),
  ].filter(Boolean);
  return blocks.join('\n\n');
}

export const COMMENTARY_CONSTANTS = {
  TOTAL_COMBOS_TEXT,
  BIRTHDAY_MASS_SUM,
  AVG_SUM,
  EXPECTED_HITS_PER_COUPON,
};
