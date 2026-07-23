import { describe, expect, it } from 'vitest';
import { buildCommentary, HONEST_FRAME_SENTENCE } from '../src/server/lib/typer/commentary.js';

// ---------------------------------------------------------------------------
// A frozen prediction + stats fixture. buildCommentary is pure, so the whole test
// suite runs off these two plain objects — no db, no clock.
// ---------------------------------------------------------------------------
const NUMBERS = [5, 20, 36, 38, 43, 49];

function basePrediction(overrides = {}) {
  return {
    forDrawNumber: 7382,
    numbers: NUMBERS,
    alternatives: [
      { numbers: [5, 20, 36, 38, 43, 48], totalScore: -6.3 },
      { numbers: [5, 20, 36, 38, 44, 49], totalScore: -6.31 },
      { numbers: [5, 20, 37, 38, 43, 49], totalScore: -6.33 },
    ],
    scores: { bias: 0.12, popularity: 6.34, total: -6.22 },
    chi2: { stat: 40.1, df: 48, p: 0.78 },
    biasReport: [
      { number: 17, decayed: 30.2, z: 1.42 },
      { number: 3, decayed: 29.1, z: 1.1 },
    ],
    popularityReport: {
      winnerWeights: NUMBERS.map((n) => ({ number: n, weight: 1 })),
      winnerPenalties: {
        runs: [],
        runFactor: 1,
        line4plus: false,
        allBirthday: false,
        allHigh: false,
        lowSum: false,
        historicalWinner: false,
        sum: 191,
        multiplier: 1.0,
      },
      rejectedExample: { numbers: [1, 2, 3, 4, 5, 6], popularity: 45.2, rank: 812 },
    },
    ...overrides,
  };
}

const STATS = {
  drawDate: '2026-07-23', // a Thursday -> "czw"
  chi2Alpha: 0.05,
  lowSumThreshold: 120, // the real config.popularity.penalties.lowSumThreshold, threaded in
  skippedWinner: { numbers: [4, 16, 23, 27, 29, 33], drawNumber: 7381, date: '2026-07-21' },
  numberStats: {
    5: { totalCount: 906, zScore: -0.31, lastDrawnAt: '2026-07-18', lastDrawNumber: 7380, currentGap: 1 },
    20: { totalCount: 889, zScore: -0.62, lastDrawnAt: '2026-07-14', lastDrawNumber: 7378, currentGap: 3 },
    36: { totalCount: 921, zScore: 0.4, lastDrawnAt: '2026-07-11', lastDrawNumber: 7377, currentGap: 4 },
    38: { totalCount: 915, zScore: 0.12, lastDrawnAt: '2026-07-09', lastDrawNumber: 7376, currentGap: 5 },
    43: { totalCount: 870, zScore: -1.05, lastDrawnAt: '2026-05-30', lastDrawNumber: 7360, currentGap: 21 },
    49: { totalCount: 902, zScore: -0.2, lastDrawnAt: '2026-07-16', lastDrawNumber: 7379, currentGap: 2 },
  },
};

// Phrases that would DISHONESTLY claim a higher win probability. None may ever appear.
const FORBIDDEN = [
  'większa szansa',
  'większe szanse',
  'większą szansę',
  'zwiększa szansę',
  'podnosi szansę',
  'wyższe P(6/6)',
  'wyższa szansa',
  'bardziej prawdopodobne niż',
];

describe('buildCommentary — determinism (SPEC §8.4: same input -> identical text)', () => {
  it('two builds of the same prediction+stats produce a byte-identical string', () => {
    const a = buildCommentary(basePrediction(), STATS);
    const b = buildCommentary(basePrediction(), STATS);
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('buildCommentary — honest framing (CONVENTIONS.md)', () => {
  const text = buildCommentary(basePrediction(), STATS);

  it('contains the exact honest 1 : 13 983 816 sentence verbatim', () => {
    expect(text).toContain(HONEST_FRAME_SENTENCE);
    expect(text).toContain('1 : 13 983 816');
  });

  it('never claims a higher win probability', () => {
    for (const phrase of FORBIDDEN) {
      expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
    // "bardziej prawdopodobny" may appear ONLY inside the negated honest phrase.
    const negated = (text.match(/nie jest bardziej prawdopodobny/g) || []).length;
    const total = (text.match(/bardziej prawdopodobny/g) || []).length;
    expect(total).toBe(negated);
  });
});

describe('buildCommentary — header', () => {
  it('renders "Typ na losowanie nr X (dzień, DD.MM.RRRR): a, b, c, d, e, f"', () => {
    const text = buildCommentary(basePrediction(), STATS);
    expect(text).toContain('**Typ na losowanie nr 7382 (czw, 23.07.2026): 5, 20, 36, 38, 43, 49**');
  });
});

describe('buildCommentary — χ² verdict branches', () => {
  it('no-bias branch (p > alpha): explains the test found no machine bias, with the p-value', () => {
    const text = buildCommentary(basePrediction({ chi2: { stat: 40.1, df: 48, p: 0.78 } }), STATS);
    expect(text).toContain('maszyna gra czysto');
    expect(text).toContain('p = 0,78');
    expect(text).toContain('model popularności');
    expect(text).not.toContain('coś wychwycił');
  });

  it('bias-found branch (p <= alpha): flags the deviation and names the top number', () => {
    const biased = basePrediction({
      chi2: { stat: 95, df: 48, p: 0.002 },
      biasReport: [{ number: 17, decayed: 42, z: 3.14 }],
    });
    const text = buildCommentary(biased, STATS);
    expect(text).toContain('coś wychwycił');
    expect(text).toContain('liczba 17');
    expect(text).not.toContain('maszyna gra czysto');
  });

  it('very small p is rendered as "p < 0,001"', () => {
    const text = buildCommentary(basePrediction({ chi2: { stat: 200, df: 48, p: 1e-9 } }), STATS);
    expect(text).toContain('p < 0,001');
  });

  it('a small p in [0,001, 0,01) never renders as the misleading "p = 0,00"', () => {
    const biased = basePrediction({
      chi2: { stat: 90, df: 48, p: 0.003 },
      biasReport: [{ number: 17, decayed: 42, z: 3.14 }],
    });
    const text = buildCommentary(biased, STATS);
    expect(text).not.toContain('0,00');
    expect(text).toContain('p < 0,01');
    expect(text).toContain('coś wychwycił');
  });

  it('bias-found branch degrades gracefully on an empty biasReport (no throw, no named number)', () => {
    const biased = basePrediction({ chi2: { stat: 90, df: 48, p: 0.002 }, biasReport: [] });
    let text;
    expect(() => {
      text = buildCommentary(biased, STATS);
    }).not.toThrow();
    expect(text).toContain('coś wychwycił');
    expect(text).not.toContain('odstaje przy tym liczba');
  });
});

describe('buildCommentary — popularity rationale & curiosity', () => {
  const text = buildCommentary(basePrediction(), STATS);

  it('states how many chosen numbers sit in the birthday zone (<= 31)', () => {
    expect(text).toContain('w strefie urodzinowej ma 2 liczby ≤ 31');
  });

  it('reports the sum and the pool-sharing multiple vs 1-2-3-4-5-6', () => {
    expect(text).toContain('sumę 191');
    expect(text).toContain('1-2-3-4-5-6 ma 45,20');
    expect(text).toContain('7,1× więcej');
  });

  it('curiosity names the largest current gap with the "bez znaczenia dla szans" caveat', () => {
    expect(text).toContain('Ciekawostka: 43 nie padła od 21 losowań');
    expect(text).toContain('bez znaczenia dla szans');
  });
});

describe('buildCommentary — per-number and "czego uniknęliśmy" sections', () => {
  const text = buildCommentary(basePrediction(), STATS);

  it('has a per-number list with total count, last-seen draw/date and z-score', () => {
    expect(text).toContain('### Liczba po liczbie');
    expect(text).toContain('- **5** — wypadła 906 razy w historii, ostatnio w losowaniu nr 7380 (18.07.2026); z-score −0,31.');
    expect(text).toContain('- **43** — wypadła 870 razy w historii, ostatnio w losowaniu nr 7360 (30.05.2026); z-score −1,05.');
  });

  it('rejects 1-2-3-4-5-6 with its popularity rank and cites a skipped historical six', () => {
    expect(text).toContain('### Czego świadomie nie zagraliśmy');
    expect(text).toContain('Odrzuciliśmy 1-2-3-4-5-6 — najpopularniejszy kupon w Polsce');
    expect(text).toContain('#812');
    expect(text).toContain('Pominęliśmy też historyczną szóstkę 4-16-23-27-29-33 z losowania nr 7381 (21.07.2026)');
  });
});

// ---------------------------------------------------------------------------
// The honesty-adjacent branches: each variant of the popularity/curiosity prose must
// render the expected clause AND stay honest (no win-probability overstatement).
// ---------------------------------------------------------------------------
function assertHonest(text) {
  for (const phrase of FORBIDDEN) expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
  const negated = (text.match(/nie jest bardziej prawdopodobny/g) || []).length;
  const total = (text.match(/bardziej prawdopodobny/g) || []).length;
  expect(total).toBe(negated);
}

// Build a prediction with a specific number set and penalty booleans.
function predWith({ numbers = NUMBERS, penalties = {}, scores = {}, popularity = 6.34, rejPop = 45.2 } = {}) {
  const p = basePrediction({ numbers });
  p.scores = { bias: 0.12, popularity, total: 0.12 - popularity, ...scores };
  p.popularityReport.winnerPenalties = {
    runs: [], runFactor: 1, line4plus: false, allBirthday: false, allHigh: false,
    lowSum: false, historicalWinner: false, sum: 191, multiplier: 1.0, ...penalties,
  };
  p.popularityReport.rejectedExample = { numbers: [1, 2, 3, 4, 5, 6], popularity: rejPop, rank: 812 };
  return p;
}

const MINIMAL_STATS = { drawDate: '2026-07-23', chi2Alpha: 0.05, lowSumThreshold: 120, skippedWinner: null, numberStats: {} };

describe('buildCommentary — popularity/curiosity branch coverage (honest in every variant)', () => {
  it('all-high set (no number <= 31): "omija całą strefę urodzinową"', () => {
    const text = buildCommentary(
      predWith({ numbers: [33, 36, 38, 41, 43, 49], penalties: { allHigh: true, sum: 240 } }),
      MINIMAL_STATS
    );
    expect(text).toContain('omija całą strefę urodzinową (żadna liczba ≤ 31)');
    assertHonest(text);
  });

  it('a blankiet line present: "układa się w linię na blankiecie 7×7"', () => {
    const text = buildCommentary(predWith({ penalties: { line4plus: true } }), MINIMAL_STATS);
    expect(text).toContain('układa się w linię na blankiecie 7×7');
    assertHonest(text);
  });

  it('a consecutive run present: "zawiera ciąg kolejnych liczb (3)"', () => {
    const text = buildCommentary(predWith({ penalties: { runs: [3] } }), MINIMAL_STATS);
    expect(text).toContain('zawiera ciąg kolejnych liczb (3)');
    assertHonest(text);
  });

  it('sum below threshold uses the scoring flag and the threaded config threshold', () => {
    const text = buildCommentary(
      predWith({ numbers: [3, 8, 11, 17, 20, 25], penalties: { lowSum: true, sum: 84 } }),
      { ...MINIMAL_STATS, lowSumThreshold: 90 }
    );
    expect(text).toContain('ma sumę 84 — poniżej granicy 90, w masie kuponów granych datami');
    assertHonest(text);
  });

  it('zero winner popularity falls back to "wielokrotnie" (no divide-by-zero)', () => {
    const text = buildCommentary(predWith({ popularity: 0 }), MINIMAL_STATS);
    expect(text).toContain('wielokrotnie więcej');
    assertHonest(text);
  });

  it('no meaningful gap among the numbers omits the ciekawostka block entirely', () => {
    const stats = {
      ...MINIMAL_STATS,
      numberStats: Object.fromEntries(NUMBERS.map((n) => [n, { totalCount: 900, zScore: 0, lastDrawnAt: '2026-07-18', lastDrawNumber: 7380, currentGap: 0 }])),
    };
    const text = buildCommentary(predWith(), stats);
    expect(text).not.toContain('Ciekawostka:');
    assertHonest(text);
  });
});
