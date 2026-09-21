import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../db/index.js';
import { createApp } from '../src/server/app.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { invalidateCache } from '../src/server/lib/cache.js';
import { upsertPrizes } from '../src/server/lib/prize-store.js';

// 5047 predates the OpenAPI prize data; 5048-5051 have prizes; 5052 is the newest draw and
// has none yet. Hand-built so every record has an exact expected value, with ties on
// mostSixes (2: 5049 and 5051) and mostThrees (40 000: 5049 and 5051).
const DRAWS = [
  { drawNumber: 5047, drawnAt: '2011-08-23', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 5048, drawnAt: '2011-08-25', numbers: [7, 8, 9, 10, 11, 12] },
  { drawNumber: 5049, drawnAt: '2011-08-27', numbers: [13, 14, 15, 16, 17, 18] },
  { drawNumber: 5050, drawnAt: '2011-08-30', numbers: [19, 20, 21, 22, 23, 24] },
  { drawNumber: 5051, drawnAt: '2011-09-01', numbers: [25, 26, 27, 28, 29, 30] },
  { drawNumber: 5052, drawnAt: '2011-09-03', numbers: [31, 32, 33, 34, 35, 36] },
];

// [winners, grosze] for 6, 5, 4, 3 hits.
const PRIZES = {
  5048: [[0, 0], [32, 721800], [1744, 40460], [34020, 2000]],
  5049: [[2, 150000000], [40, 500000], [2000, 15000], [40000, 2000]],
  5050: [[1, 3000000000], [10, 2500000], [900, 50000], [30000, 2400]],
  5051: [[2, 100000000], [20, 900000], [1500, 30000], [40000, 2400]],
};

function seed(db) {
  const insert = db.prepare(
    `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
     VALUES ('lotto', @drawNumber, @drawnAt, @n1, @n2, @n3, @n4, @n5, @n6, @mask, 'manual', @createdAt)`
  );
  for (const d of DRAWS) {
    const [n1, n2, n3, n4, n5, n6] = d.numbers;
    insert.run({ ...d, n1, n2, n3, n4, n5, n6, mask: maskFromNumbers(d.numbers), createdAt: Date.now() });
  }
  for (const [nr, tiers] of Object.entries(PRIZES)) {
    const [t6, t5, t4, t3] = tiers.map(([winners, amount]) => ({ winners, amount }));
    upsertPrizes(db, Number(nr), { status: 'ok', tiers: { 6: t6, 5: t5, 4: t4, 3: t3 } }, 1);
  }
}

describe('prizes in the draw API', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    seed(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it('GET /api/draws/:nr carries the tiers in złoty for a draw with prizes', async () => {
    const res = await request(app).get('/api/draws/5050');
    expect(res.status).toBe(200);
    expect(res.body.prizes).toEqual({
      status: 'ok',
      tiers: [
        { hits: 6, winners: 1, amount: 30000000 },
        { hits: 5, winners: 10, amount: 25000 },
        { hits: 4, winners: 900, amount: 500 },
        { hits: 3, winners: 30000, amount: 24 },
      ],
    });
  });

  it('a draw before 5048 is unavailable', async () => {
    const res = await request(app).get('/api/draws/5047');
    expect(res.body.prizes).toEqual({ status: 'unavailable' });
  });

  it('the latest draw without prizes yet is pending, then ok once they land and the cache is cleared', async () => {
    const before = await request(app).get('/api/draws/latest');
    expect(before.body.drawNumber).toBe(5052);
    expect(before.body.prizes).toEqual({ status: 'pending' });

    upsertPrizes(db, 5052, { status: 'ok', tiers: { 6: { winners: 0, amount: 0 }, 5: { winners: 5, amount: 1000000 }, 4: { winners: 800, amount: 30000 }, 3: { winners: 20000, amount: 2400 } } }, 2);
    invalidateCache();

    const after = await request(app).get('/api/draws/latest');
    expect(after.body.prizes.status).toBe('ok');
    expect(after.body.prizes.tiers[1]).toEqual({ hits: 5, winners: 5, amount: 10000 });
  });
});

describe('GET /api/stats/prizes', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    seed(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  const nrs = (entry) => entry.draws.map((d) => d.drawNumber);

  it('reports coverage from the first draw with prizes', async () => {
    const res = await request(app).get('/api/stats/prizes');
    expect(res.status).toBe(200);
    expect(res.body.coverage).toEqual({ fromDrawNumber: 5048, fromDate: '2011-08-25', draws: 4 });
  });

  it('computes every record, keeping ties', async () => {
    const { records } = (await request(app).get('/api/stats/prizes')).body;

    expect(records.topJackpot.value).toBe(30000000);
    expect(records.topJackpot.draws).toEqual([
      { drawNumber: 5050, date: '2011-08-30', numbers: [19, 20, 21, 22, 23, 24], winners: 1, amount: 30000000 },
    ]);
    expect(records.mostSixes.value).toBe(2);
    expect(nrs(records.mostSixes)).toEqual([5049, 5051]);
    expect(records.maxFive.value).toBe(25000);
    expect(nrs(records.maxFive)).toEqual([5050]);
    expect(records.maxFour.value).toBe(500);
    expect(nrs(records.maxFour)).toEqual([5050]);
    expect(records.mostThrees.value).toBe(40000);
    expect(nrs(records.mostThrees)).toEqual([5049, 5051]);
    expect(records.mostThrees.draws[0]).toMatchObject({ winners: 40000, amount: 20 });
  });

  it('threeAmount keeps the first draw, every change and the last draw', async () => {
    const { threeAmount } = (await request(app).get('/api/stats/prizes')).body;
    expect(threeAmount).toEqual([
      { drawNumber: 5048, date: '2011-08-25', amount: 20 },
      { drawNumber: 5050, date: '2011-08-30', amount: 24 },
      { drawNumber: 5051, date: '2011-09-01', amount: 24 },
    ]);
  });

  it('an empty prize table gives null coverage/records and no series', async () => {
    db.prepare('DELETE FROM draw_prize').run();
    invalidateCache();

    const res = await request(app).get('/api/stats/prizes');
    expect(res.body).toEqual({ coverage: null, records: null, threeAmount: [] });
  });
});
