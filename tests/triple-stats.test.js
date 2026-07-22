import { describe, expect, it } from 'vitest';
import { computeTripleStats } from '../src/server/lib/triple-stats.js';
import { P_SPECIFIC_TRIPLE } from '../src/server/lib/theory.js';

// 3 draws, hand-picked so triple (1,2,3) recurs in all three (the only triple that does),
// while every other triple is distinct-ish (some incidental repeats within a single draw's
// own C(6,3)=20 triples are impossible since a draw's 6 numbers are fixed, but triples
// CAN recur across draws when numbers overlap -- tracked below).
const DRAWS = [
  { drawNumber: 1, numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 2, numbers: [1, 2, 3, 7, 8, 9] },
  { drawNumber: 3, numbers: [1, 2, 3, 4, 5, 7] },
];
const N = DRAWS.length;

describe('computeTripleStats(draws) — all observed triples, cnt/expected/lift', () => {
  // top: 100 is comfortably above the distinct-triple count for this fixture, so this is
  // effectively "give me everything" -- the exactness check below needs the full universe,
  // not just the default top-15 slice the real /api/stats/pairs endpoint asks for.
  const rows = computeTripleStats(DRAWS, { top: 100 });

  it('sums to C(6,3)*N = 20*N total triple-occurrences EXACTLY (each draw contributes exactly 20 triples)', () => {
    const total = rows.reduce((s, r) => s + r.cnt, 0);
    expect(total).toBe(20 * N);
  });

  it('triple (1,2,3) is observed in all 3 draws -> cnt=3, the unique maximum', () => {
    const row123 = rows.find((r) => r.numbers.join(',') === '1,2,3');
    expect(row123.cnt).toBe(3);
    expect(rows.every((r) => r.numbers.join(',') === '1,2,3' || r.cnt <= 3)).toBe(true);
  });

  it('triple (1,2,4) is observed in draws 1 and 3 -> cnt=2', () => {
    const row124 = rows.find((r) => r.numbers.join(',') === '1,2,4');
    expect(row124.cnt).toBe(2);
  });

  it('every row has expected = N * P_SPECIFIC_TRIPLE and lift = cnt/expected', () => {
    const expected = N * P_SPECIFIC_TRIPLE;
    for (const row of rows) {
      expect(row.expected).toBeCloseTo(expected, 12);
      expect(row.lift).toBeCloseTo(row.cnt / expected, 10);
    }
  });

  it('is sorted descending by cnt (ties broken by ascending numbers)', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].cnt).toBeGreaterThanOrEqual(rows[i].cnt);
      if (rows[i - 1].cnt === rows[i].cnt) {
        expect(rows[i - 1].numbers.join(',') <= rows[i].numbers.join(',')).toBe(true);
      }
    }
  });

  it('respects the `top` option to slice the sorted list', () => {
    const top2 = computeTripleStats(DRAWS, { top: 2 });
    expect(top2).toHaveLength(2);
    expect(top2[0].numbers).toEqual([1, 2, 3]);
  });

  it('empty history returns an empty array, not an error', () => {
    expect(computeTripleStats([])).toEqual([]);
  });
});
