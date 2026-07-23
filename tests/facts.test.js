import { describe, expect, it } from 'vitest';
import { generateFact, sumPercentile } from '../src/server/lib/facts.js';

// Helper: turn a compact spec into the ascending {drawNumber, drawnAt, numbers} shape
// generateFact consumes. Draw numbers default to 1..n; dates are irrelevant to every rule
// except déjà vu's copy, so a fixed placeholder is fine.
function draws(list) {
  return list.map((numbers, i) => ({
    drawNumber: i + 1,
    drawnAt: '2020-01-01',
    numbers,
  }));
}

// A deliberately unremarkable draw used to bound sums (a very high and a very low earlier
// draw) so the rule under test isn't accidentally out-competed by the sum-record rule.
const HIGH = [40, 42, 44, 46, 47, 48]; // sum 267
const LOW = [1, 2, 3, 4, 5, 6]; // sum 21

describe('sumPercentile — theoretical CDF of the six-number sum', () => {
  it('21 (only {1..6}) is essentially the 0th percentile, 279 is exactly the 100th', () => {
    expect(sumPercentile(21)).toBeLessThan(0.001);
    expect(sumPercentile(279)).toBe(100);
  });

  it('150 (the mean) sits just above the 50th percentile', () => {
    const p = sumPercentile(150);
    expect(p).toBeGreaterThan(50);
    expect(p).toBeLessThan(51);
  });
});

describe('generateFact — empty / degenerate input', () => {
  it('returns null with no draws', () => {
    expect(generateFact([])).toBeNull();
    expect(generateFact(undefined)).toBeNull();
  });
});

describe('generateFact — rule 1: déjà vu (mask repeat)', () => {
  it('fires when the latest combination has occurred before, naming the prior draw', () => {
    const fact = generateFact(draws([[40, 44, 45, 46, 47, 48], HIGH, LOW, [40, 44, 45, 46, 47, 48]]));
    expect(fact.type).toBe('dejavu');
    expect(fact.text).toContain('nr 1'); // the earliest matching prior draw
  });
});

describe('generateFact — rule 2: new all-time sum record', () => {
  it('fires for a new maximum sum', () => {
    const fact = generateFact(draws([LOW, [44, 45, 46, 47, 48, 49]]));
    expect(fact.type).toBe('sum_record');
    expect(fact.text).toContain('najwyższa');
    expect(fact.text).toContain('279');
  });

  it('fires for a new minimum sum', () => {
    const fact = generateFact(draws([[10, 20, 30, 40, 45, 48], [1, 2, 3, 4, 5, 6]]));
    expect(fact.type).toBe('sum_record');
    expect(fact.text).toContain('najniższa');
  });

  it('does NOT fire when the sum merely ties the existing record', () => {
    // both draws sum to 21; the latest is not a *new* record, so it falls through.
    const fact = generateFact(draws([LOW, [1, 2, 3, 4, 5, 6]]));
    expect(fact.type).not.toBe('sum_record');
  });
});

describe('generateFact — rule 3: sum in a theoretical tail', () => {
  it('fires "high" for an extreme sum that is not a new record', () => {
    // 279 (max) and 21 (min) both present earlier, so 250 is neither a new max nor min,
    // but 250 is still >95th percentile.
    const fact = generateFact(draws([[44, 45, 46, 47, 48, 49], LOW, [30, 38, 42, 45, 47, 48]]));
    expect(fact.type).toBe('sum_percentile');
    expect(fact.text).toContain('wysoka');
  });

  it('fires "low" for an extreme-low sum that is not a new record', () => {
    // 267 (max) and 21 (min) both present earlier, so 61 is neither a new max nor min,
    // but 61 is still <5th percentile.
    const fact = generateFact(draws([HIGH, LOW, [1, 4, 8, 12, 16, 20]]));
    expect(fact.type).toBe('sum_percentile');
    expect(fact.text).toContain('niska');
  });
});

describe('generateFact — rule 4: run of >=3 consecutive', () => {
  it('fires and lists the run', () => {
    const fact = generateFact(draws([HIGH, LOW, [3, 4, 5, 20, 35, 47]]));
    expect(fact.type).toBe('consecutive');
    expect(fact.text).toContain('3, 4, 5');
  });
});

describe('generateFact — rule 5: return after a record-long absence', () => {
  it('fires for the number whose just-closed gap is a personal record >= threshold', () => {
    // number 7 appears at draw 1, then not again until draw 20 (gap 18). Every other
    // latest number is a first-timer. Earlier draws bound the sum so rule 2 stays silent.
    const list = [];
    list.push([7, 8, 9, 10, 11, 13]); // draw 1 (holds the 7)
    list.push(HIGH); // draw 2 (bounds the max)
    for (let i = 3; i <= 19; i++) list.push(LOW); // fillers, bound the min, never a 7
    list.push([7, 12, 22, 33, 41, 45]); // draw 20 — the 7 returns
    const fact = generateFact(draws(list));
    expect(fact.type).toBe('record_absence');
    expect(fact.text).toContain('liczba 7');
    expect(fact.text).toContain('18 losowań');
  });
});

describe('generateFact — rule 6: number on a streak of >=3 draws', () => {
  it('fires naming the streaking number and the run of draw numbers', () => {
    const fact = generateFact(
      draws([
        [44, 45, 46, 47, 48, 49], // draw 1 — bounds the sum, no 5
        [5, 10, 15, 20, 25, 30], // draw 2
        [5, 11, 16, 21, 26, 31], // draw 3
        [5, 13, 22, 33, 39, 42], // draw 4 (latest) — 5 on a 3-draw streak
      ])
    );
    expect(fact.type).toBe('streak');
    expect(fact.text).toContain('Liczba 5');
    expect(fact.text).toContain('3 losowaniach');
    expect(fact.text).toMatch(/nr 2.4\)/); // "nr 2–4)" — dash char left unasserted
  });
});

describe('generateFact — rule 7: round-number milestone', () => {
  it('fires when draw_number % 500 == 0', () => {
    const list = [
      { drawNumber: 497, drawnAt: '2020-01-01', numbers: [1, 2, 3, 4, 5, 7] }, // low bound
      { drawNumber: 498, drawnAt: '2020-01-01', numbers: [10, 20, 30, 40, 45, 48] },
      { drawNumber: 499, drawnAt: '2020-01-01', numbers: [11, 21, 31, 41, 46, 49] },
      { drawNumber: 500, drawnAt: '2020-01-01', numbers: [3, 15, 24, 29, 37, 44] }, // latest
    ];
    const fact = generateFact(list);
    expect(fact.type).toBe('milestone');
    expect(fact.text).toContain('nr 500');
  });
});

describe('generateFact — rule 8: extreme birthday-ness', () => {
  it('fires when all six numbers are <= 31 (and the sum is not itself extreme)', () => {
    const fact = generateFact(draws([[44, 45, 46, 47, 48, 49], LOW, [18, 23, 26, 28, 30, 31]]));
    expect(fact.type).toBe('birthday');
    expect(fact.text).toContain('1–31');
  });
});

describe('generateFact — rule 9: z-score fallback', () => {
  it('fires for an unremarkable draw, naming a latest number and its z-score', () => {
    const fact = generateFact(draws([LOW, [10, 20, 30, 40, 45, 48], [3, 17, 22, 31, 38, 44]]));
    expect(fact.type).toBe('zscore');
    expect(fact.text).toMatch(/z-score [+-]\d+,\d{2}/);
  });
});

describe('generateFact — priority ordering (first match wins)', () => {
  it('déjà vu outranks every lower rule it also satisfies', () => {
    // {1..6} repeats (déjà vu) AND is a consecutive run AND all-birthday AND low-sum.
    const fact = generateFact(draws([LOW, [10, 20, 30, 40, 45, 48], [1, 2, 3, 4, 5, 6]]));
    expect(fact.type).toBe('dejavu');
  });

  it('a new sum record outranks the percentile/birthday rules it also satisfies', () => {
    // {44..49} is a new max sum AND >95th percentile AND zero birthday numbers.
    const fact = generateFact(draws([LOW, [44, 45, 46, 47, 48, 49]]));
    expect(fact.type).toBe('sum_record');
  });
});
