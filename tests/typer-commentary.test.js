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
  it('no-bias branch (p > alpha): "nie wykrywa biasu maszyny" and the p-value', () => {
    const text = buildCommentary(basePrediction({ chi2: { stat: 40.1, df: 48, p: 0.78 } }), STATS);
    expect(text).toContain('nie wykrywa biasu maszyny');
    expect(text).toContain('p = 0,78');
    expect(text).toContain('zdecydował model popularności');
    expect(text).not.toContain('sygnalizuje odchylenie');
  });

  it('bias-found branch (p <= alpha): flags the deviation and names the top number', () => {
    const biased = basePrediction({
      chi2: { stat: 95, df: 48, p: 0.002 },
      biasReport: [{ number: 17, decayed: 42, z: 3.14 }],
    });
    const text = buildCommentary(biased, STATS);
    expect(text).toContain('sygnalizuje odchylenie');
    expect(text).toContain('liczba 17');
    expect(text).toContain('z̃ = +3,14');
    expect(text).not.toContain('nie wykrywa biasu maszyny');
  });

  it('very small p is rendered as "p < 0,001"', () => {
    const text = buildCommentary(basePrediction({ chi2: { stat: 200, df: 48, p: 1e-9 } }), STATS);
    expect(text).toContain('p < 0,001');
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
