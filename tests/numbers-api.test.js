import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../db/index.js';
import { createApp } from '../src/server/app.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { invalidateCache } from '../src/server/lib/cache.js';
import { rebuildStats, computeNumberStats } from '../src/server/lib/rebuild-stats.js';
import { numberToCell } from '../src/server/lib/blanket.js';

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

// Reuses the exact same 10-draw fixture as tests/draws-api.test.js / tests/stats-api.test.js
// so career totals for number 1 (5 occurrences: draws 1,3,4,5,6) are already cross-checked
// elsewhere.
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

describe('GET /api/numbers/:n', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    insertDraws(db, DRAWS);
    rebuildStats(db);
    app = createApp(db);
  });

  afterEach(() => db.close());

  it('number 1: stats matches computeNumberStats exactly (totalCount=5, occurring in draws 1,3,4,5,6)', async () => {
    const res = await request(app).get('/api/numbers/1');
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(1);

    const expected = computeNumberStats(DRAWS).find((r) => r.number === 1);
    expect(res.body.stats.totalCount).toBe(expected.totalCount);
    expect(res.body.stats.currentGap).toBe(expected.currentGap);
    expect(res.body.stats.lastDrawnAt).toBe(expected.lastDrawnAt);
    expect(res.body.stats.longestStreak).toBe(expected.longestStreak);
    expect(res.body.yearCounts).toEqual(JSON.parse(expected.yearCounts));
  });

  it('number 1: gapHistogram reflects its own completed gaps only (occurs at draws 1,3,4,5,6 -> gaps 1,0,0,0)', async () => {
    const res = await request(app).get('/api/numbers/1');
    expect(res.body.gapHistogram.total).toBe(4);
    expect(res.body.gapHistogram.histogram).toEqual([
      { gap: 0, count: 3 },
      { gap: 1, count: 1 },
    ]);
  });

  it('number 1: blanket position matches numberToCell(1) = {row:0, col:0}', async () => {
    const res = await request(app).get('/api/numbers/1');
    expect(res.body.blanket).toEqual(numberToCell(1));
  });

  it('number 49: blanket position matches numberToCell(49)', async () => {
    const res = await request(app).get('/api/numbers/49');
    expect(res.body.blanket).toEqual(numberToCell(49));
  });

  it('number 38 (never drawn in this fixture): totalCount=0, gapHistogram empty, zScoreSeries reflects zero occurrences', async () => {
    const res = await request(app).get('/api/numbers/38');
    expect(res.status).toBe(200);
    expect(res.body.stats.totalCount).toBe(0);
    expect(res.body.gapHistogram.total).toBe(0);
  });

  it('zScoreSeries is empty for a 10-draw history with step=100 (no complete checkpoint reached)', async () => {
    const res = await request(app).get('/api/numbers/1');
    expect(res.body.zScoreSeries).toEqual([]);
  });

  it('400 for out-of-range or non-numeric number', async () => {
    expect((await request(app).get('/api/numbers/0')).status).toBe(400);
    expect((await request(app).get('/api/numbers/50')).status).toBe(400);
    expect((await request(app).get('/api/numbers/abc')).status).toBe(400);
    expect((await request(app).get('/api/numbers/4.5')).status).toBe(400);
  });
});

describe('GET /api/numbers/:n — zScoreSeries checkpoints (250-draw synthetic history)', () => {
  it('number 7 occurs every 3rd draw -> checkpoints at k=100 (count=33) and k=200 (count=66)', async () => {
    invalidateCache();
    const db = openDatabase(':memory:');
    const draws = [];
    for (let i = 1; i <= 250; i++) {
      const numbers = i % 3 === 0 ? [7, 10, 20, 30, 40, 49] : [1, 10, 20, 30, 40, 49];
      draws.push({ drawNumber: i, drawnAt: `2020-01-${String(((i - 1) % 28) + 1).padStart(2, '0')}`, numbers });
    }
    insertDraws(db, draws);
    rebuildStats(db);
    const app = createApp(db);

    const res = await request(app).get('/api/numbers/7');
    expect(res.body.zScoreSeries).toHaveLength(2);
    expect(res.body.zScoreSeries.map((r) => r.k)).toEqual([100, 200]);
    expect(res.body.zScoreSeries[0].count).toBe(33);
    expect(res.body.zScoreSeries[1].count).toBe(66);
    db.close();
  });
});
