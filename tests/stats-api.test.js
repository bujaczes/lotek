import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../db/index.js';
import { createApp } from '../src/server/app.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { invalidateCache } from '../src/server/lib/cache.js';
import { rebuildStats } from '../src/server/lib/rebuild-stats.js';
import { computeNumberStats } from '../src/server/lib/rebuild-stats.js';

function insertDraws(db, draws) {
  const insert = db.prepare(
    `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
     VALUES ('lotto', @drawNumber, @drawnAt, @n1, @n2, @n3, @n4, @n5, @n6, @mask, 'manual', @createdAt)`
  );
  for (const d of draws) {
    insert.run({
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
  }
}

// Same 10-draw fixture as tests/draws-api.test.js (see there for the full rationale).
// total occurrences per number: 1->5, 2->4, 3->4, 4..9->3 each, 10->2, everything else
// (11..37 minus the ones just listed) ->1, 38..49 ->0. Sum = 60 = 6*10.
const DRAWS = [
  { drawNumber: 1, drawnAt: '2020-01-05', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 2, drawnAt: '2020-01-08', numbers: [7, 8, 9, 10, 11, 12] },
  { drawNumber: 3, drawnAt: '2020-01-12', numbers: [1, 2, 3, 7, 8, 9] },
  { drawNumber: 4, drawnAt: '2020-01-15', numbers: [1, 7, 13, 14, 15, 16] },
  { drawNumber: 5, drawnAt: '2020-01-19', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 6, drawnAt: '2020-01-22', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 7, drawnAt: '2021-02-02', numbers: [8, 9, 10, 17, 18, 19] },
  { drawNumber: 8, drawnAt: '2021-02-05', numbers: [20, 21, 22, 23, 24, 25] },
  { drawNumber: 9, drawnAt: '2021-02-09', numbers: [26, 27, 28, 29, 30, 31] },
  { drawNumber: 10, drawnAt: '2021-02-12', numbers: [32, 33, 34, 35, 36, 37] },
];

describe('GET /api/stats/blanket', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    insertDraws(db, DRAWS);
    rebuildStats(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns exactly 49 rows, one per number 1..49, matching computeNumberStats exactly', async () => {
    const res = await request(app).get('/api/stats/blanket');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(49);
    expect(res.body.map((r) => r.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 49 }, (_, i) => i + 1)
    );

    const expected = computeNumberStats(
      DRAWS.map((d) => ({ drawNumber: d.drawNumber, drawnAt: d.drawnAt, numbers: d.numbers }))
    );
    const expectedByNumber = Object.fromEntries(expected.map((r) => [r.number, r]));

    for (const row of res.body) {
      const exp = expectedByNumber[row.number];
      expect(row.total).toBe(exp.totalCount);
      expect(row.last50).toBe(exp.countLast50);
      expect(row.last100).toBe(exp.countLast100);
      expect(row.currentGap).toBe(exp.currentGap);
      expect(row.lastDrawnAt).toBe(exp.lastDrawnAt);
      if (exp.zScore === null) expect(row.zScore).toBeNull();
      else expect(row.zScore).toBeCloseTo(exp.zScore, 10);
    }
  });
});

describe('GET /api/stats/rankings', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    insertDraws(db, DRAWS);
    rebuildStats(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it('has hot/cold x all/last100/currentYear, each with exactly 10 entries', async () => {
    const res = await request(app).get('/api/stats/rankings');
    expect(res.status).toBe(200);
    for (const bucket of ['hot', 'cold']) {
      for (const window of ['all', 'last100', 'currentYear']) {
        expect(res.body[bucket][window]).toHaveLength(10);
      }
    }
  });

  it('hot.all is sorted descending by count and matches the hand-computed top 10 (numbers 1..10)', async () => {
    const res = await request(app).get('/api/stats/rankings');
    const hotAll = res.body.hot.all;
    expect(hotAll.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(hotAll.map((r) => r.count)).toEqual([5, 4, 4, 3, 3, 3, 3, 3, 3, 2]);
    for (let i = 1; i < hotAll.length; i++) {
      expect(hotAll[i - 1].count).toBeGreaterThanOrEqual(hotAll[i].count);
    }
  });

  it('cold.all is sorted ascending by count and matches the hand-computed bottom 10 (first 10 zero-count numbers, 38..47)', async () => {
    const res = await request(app).get('/api/stats/rankings');
    const coldAll = res.body.cold.all;
    expect(coldAll.map((r) => r.number)).toEqual([38, 39, 40, 41, 42, 43, 44, 45, 46, 47]);
    expect(coldAll.every((r) => r.count === 0)).toBe(true);
  });

  it('every entry carries a numeric zScore (or null) alongside count', async () => {
    const res = await request(app).get('/api/stats/rankings');
    for (const r of res.body.hot.all) {
      expect(typeof r.zScore === 'number' || r.zScore === null).toBe(true);
    }
  });
});

describe('GET /api/stats/gaps', () => {
  // Dedicated small fixture (see tests/gaps.test.js for the identical hand-derivation):
  // number 1 occurs at draws 1,2,4,7 -> completed gaps [0,1,2]; number 23 occurs at
  // draws 5,6 -> completed gap [0]. Every other number occurs at most once.
  const GAP_DRAWS = [
    { drawNumber: 1, drawnAt: '2022-01-01', numbers: [1, 2, 3, 4, 5, 6] },
    { drawNumber: 2, drawnAt: '2022-01-04', numbers: [1, 7, 8, 9, 10, 11] },
    { drawNumber: 3, drawnAt: '2022-01-08', numbers: [12, 13, 14, 15, 16, 17] },
    { drawNumber: 4, drawnAt: '2022-01-11', numbers: [1, 18, 19, 20, 21, 22] },
    { drawNumber: 5, drawnAt: '2022-01-15', numbers: [23, 24, 25, 26, 27, 28] },
    { drawNumber: 6, drawnAt: '2022-01-18', numbers: [23, 29, 30, 31, 32, 33] },
    { drawNumber: 7, drawnAt: '2022-01-22', numbers: [1, 34, 35, 36, 37, 38] },
  ];

  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    insertDraws(db, GAP_DRAWS);
    rebuildStats(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it('currentGapTop10: highest current_gap first, 10 entries (numbers 2-6 tie at 6, then 7-11 tie at 5)', async () => {
    const res = await request(app).get('/api/stats/gaps');
    expect(res.status).toBe(200);
    expect(res.body.currentGapTop10).toHaveLength(10);
    expect(res.body.currentGapTop10.map((r) => r.number)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(res.body.currentGapTop10.map((r) => r.currentGap)).toEqual([6, 6, 6, 6, 6, 5, 5, 5, 5, 5]);
  });

  it('maxGapTop10: only numbers with a completed gap appear (2 entries here, not padded to 10)', async () => {
    const res = await request(app).get('/api/stats/gaps');
    expect(res.body.maxGapTop10).toHaveLength(2);
    expect(res.body.maxGapTop10[0]).toMatchObject({ number: 1, maxGap: 2, avgGap: 1 });
    expect(res.body.maxGapTop10[1]).toMatchObject({ number: 23, maxGap: 0, avgGap: 0 });
  });

  it('gapDistribution: histogram matches the hand-computed distribution and the geometric curve sums correctly', async () => {
    const res = await request(app).get('/api/stats/gaps');
    const dist = res.body.gapDistribution;
    expect(dist.totalObservations).toBe(4);
    expect(dist.observed).toEqual([
      { gap: 0, count: 2 },
      { gap: 1, count: 1 },
      { gap: 2, count: 1 },
    ]);
    expect(dist.p).toBeCloseTo(6 / 49, 12);

    const p = 6 / 49;
    const sum = dist.theoretical.reduce((s, r) => s + r.expected, 0);
    expect(sum).toBeCloseTo(4 * (1 - (1 - p) ** 3), 10);
  });
});

describe('GET /api/stats/* — cache invalidation wiring', () => {
  it('blanket reflects a rebuilt total_count after rebuildStats invalidates the cache', async () => {
    invalidateCache();
    const db = openDatabase(':memory:');
    insertDraws(db, DRAWS);
    rebuildStats(db);
    const app = createApp(db);

    const before = await request(app).get('/api/stats/blanket');
    const number1Before = before.body.find((r) => r.number === 1);
    expect(number1Before.total).toBe(5);

    insertDraws(db, [{ drawNumber: 11, drawnAt: '2021-02-16', numbers: [1, 40, 41, 42, 43, 44] }]);
    rebuildStats(db);

    const after = await request(app).get('/api/stats/blanket');
    const number1After = after.body.find((r) => r.number === 1);
    expect(number1After.total).toBe(6);

    db.close();
  });
});
