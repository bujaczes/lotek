import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { importHistory } from '../scripts/import-history.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { HALF_LIFE_DRAWS, computeNumberStats, computePairStats, rebuildStats } from '../src/server/lib/rebuild-stats.js';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(TESTS_DIR, '..', 'data', 'fixtures', 'dl_snapshot.txt.gz');

// Hand-built 8-draw synthetic history. Number 7 recurs (draws 1,2,4,6,8) to exercise
// gaps/streak/decay; number 1 occurs exactly once (draws 2020 only) to exercise the
// "single occurrence" edge (no completed gaps); number 19 never occurs to exercise the
// "zero occurrences" edge. No pair repeats across draws (only 7 recurs, paired with a
// different partner each time), so pair sums stay a clean 15 per draw.
const SYNTHETIC_DRAWS = [
  { drawNumber: 1, drawnAt: '2020-01-01', numbers: [7, 10, 20, 30, 40, 49] },
  { drawNumber: 2, drawnAt: '2020-01-08', numbers: [7, 11, 21, 31, 41, 42] },
  { drawNumber: 3, drawnAt: '2020-01-15', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 4, drawnAt: '2020-01-22', numbers: [7, 12, 22, 32, 43, 44] },
  { drawNumber: 5, drawnAt: '2020-01-29', numbers: [8, 13, 23, 33, 45, 46] },
  { drawNumber: 6, drawnAt: '2021-01-05', numbers: [7, 14, 24, 34, 47, 48] },
  { drawNumber: 7, drawnAt: '2021-01-12', numbers: [9, 15, 25, 35, 36, 37] },
  { drawNumber: 8, drawnAt: '2021-01-19', numbers: [7, 16, 26, 27, 28, 29] },
];
const N = SYNTHETIC_DRAWS.length; // 8
const MAX_DRAW_NUMBER = 8;

function zScoreFormula(c, n) {
  return (c - (n * 6) / 49) / Math.sqrt(n * 6 * (1 / 49) * (48 / 49));
}

function decayedFormula(ages) {
  const lambda = Math.pow(0.5, 1 / HALF_LIFE_DRAWS);
  return ages.reduce((sum, age) => sum + Math.pow(lambda, age), 0);
}

function rowFor(rows, number) {
  return rows.find((r) => r.number === number);
}

describe('computeNumberStats (pure, no db) — hand-computed synthetic dataset', () => {
  const rows = computeNumberStats(SYNTHETIC_DRAWS);

  it('returns exactly 49 rows, numbers 1..49', () => {
    expect(rows).toHaveLength(49);
    expect(rows.map((r) => r.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 49 }, (_, i) => i + 1)
    );
  });

  it('total_count sums to 6*N across all numbers (every draw contributes exactly 6 slots)', () => {
    const sum = rows.reduce((s, r) => s + r.totalCount, 0);
    expect(sum).toBe(6 * N);
  });

  it('number 7 (recurs in draws 1,2,4,6,8): total_count, gaps, max_gap/avg_gap, streak, current_gap', () => {
    const r = rowFor(rows, 7);
    expect(r.totalCount).toBe(5);
    // completed gaps between consecutive occurrences (1,2,4,6,8): 0, 1, 1, 1
    expect(r.maxGap).toBe(1);
    // first gap to reach the max wins ties (earlier wins, house convention) — the gap
    // between draws 2 and 4 is the first to hit length 1, ended by draw 4.
    expect(r.maxGapEndedAt).toBe('2020-01-22');
    expect(r.avgGap).toBeCloseTo((0 + 1 + 1 + 1) / 4, 10);
    // longest run of consecutive draw_numbers: 1,2 is the longest (length 2)
    expect(r.longestStreak).toBe(2);
    expect(r.lastDrawNumber).toBe(8);
    expect(r.lastDrawnAt).toBe('2021-01-19');
    expect(r.currentGap).toBe(MAX_DRAW_NUMBER - 8); // 0, last draw is the newest
  });

  it('number 7: decayed_count = sum of lambda^age over ages [7,6,4,2,0] (age=0 term is exactly 1)', () => {
    const r = rowFor(rows, 7);
    expect(r.decayedCount).toBeCloseTo(decayedFormula([7, 6, 4, 2, 0]), 12);
  });

  it('lambda sanity: lambda^0 = 1 and lambda^300 = 0.5 (half-life definition)', () => {
    const lambda = Math.pow(0.5, 1 / HALF_LIFE_DRAWS);
    expect(Math.pow(lambda, 0)).toBe(1);
    expect(Math.pow(lambda, HALF_LIFE_DRAWS)).toBeCloseTo(0.5, 10);
    expect(HALF_LIFE_DRAWS).toBe(300);
  });

  it('number 7: z_score matches (c - N*6/49) / sqrt(N*6*(1/49)*(48/49)) with c=5, N=8', () => {
    const r = rowFor(rows, 7);
    expect(r.zScore).toBeCloseTo(zScoreFormula(5, N), 10);
  });

  it('number 7: year_counts groups occurrences by drawn_at year', () => {
    const r = rowFor(rows, 7);
    expect(JSON.parse(r.yearCounts)).toEqual({ '2020': 3, '2021': 2 });
  });

  it('number 1 (single occurrence, draw 3): no completed gaps -> max_gap/avg_gap are null, streak=1', () => {
    const r = rowFor(rows, 1);
    expect(r.totalCount).toBe(1);
    expect(r.maxGap).toBeNull();
    expect(r.maxGapEndedAt).toBeNull();
    expect(r.avgGap).toBeNull();
    expect(r.longestStreak).toBe(1);
    expect(r.lastDrawNumber).toBe(3);
    expect(r.lastDrawnAt).toBe('2020-01-15');
    expect(r.currentGap).toBe(MAX_DRAW_NUMBER - 3); // 5
    expect(JSON.parse(r.yearCounts)).toEqual({ '2020': 1 });
    expect(r.zScore).toBeCloseTo(zScoreFormula(1, N), 10);
  });

  it('number 19 (never occurs): all counters zero/null, z_score still defined (N>0)', () => {
    const r = rowFor(rows, 19);
    expect(r.totalCount).toBe(0);
    expect(r.countLast50).toBe(0);
    expect(r.countLast100).toBe(0);
    expect(r.countLast300).toBe(0);
    expect(r.decayedCount).toBe(0);
    expect(r.lastDrawNumber).toBeNull();
    expect(r.lastDrawnAt).toBeNull();
    expect(r.currentGap).toBeNull();
    expect(r.maxGap).toBeNull();
    expect(r.maxGapEndedAt).toBeNull();
    expect(r.avgGap).toBeNull();
    expect(r.longestStreak).toBe(0);
    expect(JSON.parse(r.yearCounts)).toEqual({});
    expect(r.zScore).toBeCloseTo(zScoreFormula(0, N), 10);
  });
});

describe('computeNumberStats — windows (count_last50/100/300) on a 60-draw synthetic set', () => {
  // Number 3 occurs only in draw 1 and draw 55 (of 60). Number 41 is filler present in
  // every draw. maxDrawNumber=60, so the last-50 window is draw_number > 10.
  const draws = [];
  for (let i = 1; i <= 60; i++) {
    const drawnAt = `2022-01-${String(((i - 1) % 28) + 1).padStart(2, '0')}`;
    const numbers = i === 1 || i === 55 ? [3, 41, 42, 43, 44, 45] : [40, 41, 42, 43, 44, 45];
    draws.push({ drawNumber: i, drawnAt, numbers });
  }
  const rows = computeNumberStats(draws);

  it('number 3 (only draws 1 and 55): last50 excludes draw 1 (threshold 60-50=10), last100/300 include both', () => {
    const r = rowFor(rows, 3);
    expect(r.totalCount).toBe(2);
    expect(r.countLast50).toBe(1);
    expect(r.countLast100).toBe(2);
    expect(r.countLast300).toBe(2);
    expect(r.currentGap).toBe(60 - 55);
  });

  it('number 41 (every draw): last50 = 50, last100/300 = 60 (window cannot exceed N)', () => {
    const r = rowFor(rows, 41);
    expect(r.totalCount).toBe(60);
    expect(r.countLast50).toBe(50);
    expect(r.countLast100).toBe(60);
    expect(r.countLast300).toBe(60);
  });
});

describe('computeNumberStats — empty history (N=0)', () => {
  it('returns 49 rows, all zeroed/null, z_score null (division by zero avoided)', () => {
    const rows = computeNumberStats([]);
    expect(rows).toHaveLength(49);
    for (const r of rows) {
      expect(r.totalCount).toBe(0);
      expect(r.decayedCount).toBe(0);
      expect(r.zScore).toBeNull();
      expect(r.lastDrawNumber).toBeNull();
      expect(r.currentGap).toBeNull();
      expect(JSON.parse(r.yearCounts)).toEqual({});
    }
  });
});

describe('computePairStats (pure, no db) — hand-computed synthetic dataset', () => {
  const rows = computePairStats(SYNTHETIC_DRAWS);

  it('returns exactly 1176 rows (all a<b pairs in 1..49), sum of cnt = 15*N', () => {
    expect(rows).toHaveLength(1176);
    const sum = rows.reduce((s, r) => s + r.cnt, 0);
    expect(sum).toBe(15 * N);
  });

  it('expected = N*5/392 for every row; pair (7,10) seen once in draw 1: lift = cnt/expected', () => {
    const expected = (N * 5) / 392;
    const pair710 = rows.find((r) => r.a === 7 && r.b === 10);
    expect(pair710.expected).toBeCloseTo(expected, 12);
    expect(pair710.cnt).toBe(1);
    expect(pair710.lift).toBeCloseTo(1 / expected, 10);
    expect(pair710.lift).toBeCloseTo(9.8, 10);
  });

  it('pair (1,2) seen once in draw 3: same cnt/lift as (7,10)', () => {
    const pair12 = rows.find((r) => r.a === 1 && r.b === 2);
    expect(pair12.cnt).toBe(1);
    expect(pair12.lift).toBeCloseTo(9.8, 10);
  });

  it('pair (1,49) never co-occurs: cnt=0, lift=0', () => {
    const pair149 = rows.find((r) => r.a === 1 && r.b === 49);
    expect(pair149.cnt).toBe(0);
    expect(pair149.lift).toBe(0);
  });
});

describe('computePairStats — empty history (N=0)', () => {
  it('1176 rows, cnt=0, expected=0, lift=0 (no division by zero)', () => {
    const rows = computePairStats([]);
    expect(rows).toHaveLength(1176);
    for (const r of rows) {
      expect(r.cnt).toBe(0);
      expect(r.expected).toBe(0);
      expect(r.lift).toBe(0);
    }
  });
});

describe('rebuildStats(db) — writes number_stat/pair_stat in a transaction', () => {
  let db;

  const insertDraw = (d) =>
    db
      .prepare(
        `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
         VALUES ('lotto', @drawNumber, @drawnAt, @n1, @n2, @n3, @n4, @n5, @n6, @mask, 'manual', @createdAt)`
      )
      .run({
        drawNumber: d.drawNumber,
        drawnAt: d.drawnAt,
        n1: d.numbers[0],
        n2: d.numbers[1],
        n3: d.numbers[2],
        n4: d.numbers[3],
        n5: d.numbers[4],
        n6: d.numbers[5],
        mask: maskFromNumbers(d.numbers),
        createdAt: Date.now(),
      });

  beforeEach(() => {
    db = openDatabase(':memory:');
    for (const d of SYNTHETIC_DRAWS) insertDraw(d);
  });

  afterEach(() => {
    db.close();
  });

  it('populates number_stat (49 rows) and pair_stat (1176 rows) matching the pure computation', () => {
    const result = rebuildStats(db);
    expect(result).toMatchObject({ gameType: 'lotto', drawsCount: N, numberStatRows: 49, pairStatRows: 1176 });

    const numberRows = db.prepare('SELECT * FROM number_stat').all();
    expect(numberRows).toHaveLength(49);
    const totalSum = numberRows.reduce((s, r) => s + r.total_count, 0);
    expect(totalSum).toBe(6 * N);

    const row7 = numberRows.find((r) => r.number === 7);
    expect(row7.total_count).toBe(5);
    expect(row7.max_gap).toBe(1);
    expect(row7.max_gap_ended_at).toBe('2020-01-22');
    expect(row7.longest_streak).toBe(2);
    expect(JSON.parse(row7.year_counts)).toEqual({ '2020': 3, '2021': 2 });

    const pairRows = db.prepare('SELECT * FROM pair_stat').all();
    expect(pairRows).toHaveLength(1176);
    const cntSum = pairRows.reduce((s, r) => s + r.cnt, 0);
    expect(cntSum).toBe(15 * N);
  });

  it('is a full rebuild: re-running after inserting one more draw replaces stale rows (DELETE + re-insert), not additive', () => {
    rebuildStats(db);
    const before = db.prepare('SELECT total_count FROM number_stat WHERE number = 7').get().total_count;
    expect(before).toBe(5);

    insertDraw({ drawNumber: 9, drawnAt: '2021-01-26', numbers: [7, 17, 18, 19, 38, 39] });
    rebuildStats(db);

    const rowCount = db.prepare('SELECT COUNT(*) AS c FROM number_stat').get().c;
    expect(rowCount).toBe(49); // still exactly 49, not 98 (proves DELETE ran, not pure INSERT)
    const after = db.prepare('SELECT total_count FROM number_stat WHERE number = 7').get().total_count;
    expect(after).toBe(6);
  });

  it('scopes to game_type: a lotto_plus rebuild does not touch lotto rows and vice versa', () => {
    rebuildStats(db, { gameType: 'lotto' });
    const lottoCountBefore = db.prepare('SELECT COUNT(*) AS c FROM number_stat').get().c;
    expect(lottoCountBefore).toBe(49);

    // no lotto_plus draws exist, but rebuildStats must still write 49 zeroed rows for it
    // without deleting the lotto rows already written above.
    const result = rebuildStats(db, { gameType: 'lotto_plus' });
    expect(result.drawsCount).toBe(0);

    const lottoCountAfter = db.prepare("SELECT COUNT(*) AS c FROM number_stat WHERE game_type = 'lotto'").get().c;
    expect(lottoCountAfter).toBe(49);
    const lottoPlusCount = db
      .prepare("SELECT COUNT(*) AS c FROM number_stat WHERE game_type = 'lotto_plus'")
      .get().c;
    expect(lottoPlusCount).toBe(49);
  });
});

describe('rebuildStats — integration on the committed dl_snapshot fixture', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
    const gz = readFileSync(SNAPSHOT_PATH);
    const text = gunzipSync(gz).toString('utf8');
    importHistory(db, text);
  });

  afterEach(() => {
    db.close();
  });

  it('total_count sums to 6N, pair cnt sums to 15N, 49 number rows, 1176 pair rows, all |z_score| < 5', () => {
    const { count: total } = db.prepare('SELECT COUNT(*) AS count FROM draw').get();
    expect(total).toBeGreaterThanOrEqual(7380);

    rebuildStats(db);

    const numberRows = db.prepare('SELECT * FROM number_stat').all();
    expect(numberRows).toHaveLength(49);
    expect(numberRows.map((r) => r.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 49 }, (_, i) => i + 1)
    );

    const totalSum = numberRows.reduce((s, r) => s + r.total_count, 0);
    expect(totalSum).toBe(6 * total);

    for (const row of numberRows) {
      expect(Math.abs(row.z_score)).toBeLessThan(5);
    }

    const pairRows = db.prepare('SELECT * FROM pair_stat').all();
    expect(pairRows).toHaveLength(1176);
    const cntSum = pairRows.reduce((s, r) => s + r.cnt, 0);
    expect(cntSum).toBe(15 * total);
  });
});
