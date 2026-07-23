import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../db/index.js';
import { createApp } from '../src/server/app.js';
import { prepareInsertDraw } from '../src/server/lib/draw-writer.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { invalidateCache } from '../src/server/lib/cache.js';
import { evaluatePredictions } from '../src/server/lib/evaluate.js';
import { HITS_VARIANCE } from '../src/server/lib/scorecard.js';

function insertDraw(db, drawNumber, numbers, drawnAt) {
  prepareInsertDraw(db).run({
    gameType: 'lotto',
    drawNumber,
    drawnAt,
    n1: numbers[0], n2: numbers[1], n3: numbers[2], n4: numbers[3], n5: numbers[4], n6: numbers[5],
    mask: maskFromNumbers(numbers),
    source: 'manual',
    createdAt: Date.now(),
  });
}

function insertPrediction(db, forDrawNumber, numbers) {
  db.prepare(
    `INSERT INTO prediction (for_draw_number, numbers, mask, model_version, created_at)
     VALUES (@forDrawNumber, @numbers, @mask, 'test-v1', @createdAt)`
  ).run({
    forDrawNumber,
    numbers: JSON.stringify(numbers),
    mask: maskFromNumbers(numbers),
    createdAt: Date.now(),
  });
}

// Seed three predictions and their draws, then evaluate:
//   nr 100: predicted {1,2,3,4,5,6}     drawn {1,2,3,10,11,12}  -> 3 hits (IV) -> 24 zł
//   nr 101: predicted {33,34,35,44,45,49} drawn {33,34,35,44,45,46} -> 5 hits (II) -> 6000 zł  [high mask bits]
//   nr 102: predicted {1,2,3,4,5,6}     drawn {7,8,9,10,11,12}  -> 0 hits -> 0 zł
function seedEvaluated(db) {
  insertDraw(db, 100, [1, 2, 3, 10, 11, 12], '2026-07-01');
  insertDraw(db, 101, [33, 34, 35, 44, 45, 46], '2026-07-04');
  insertDraw(db, 102, [7, 8, 9, 10, 11, 12], '2026-07-08');
  insertPrediction(db, 100, [1, 2, 3, 4, 5, 6]);
  insertPrediction(db, 101, [33, 34, 35, 44, 45, 49]);
  insertPrediction(db, 102, [1, 2, 3, 4, 5, 6]);
  evaluatePredictions(db);
}

describe('GET /api/typer/scorecard', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it('aggregates every evaluated prediction (per-prediction, cumulative, distribution, balance)', async () => {
    seedEvaluated(db);
    const res = await request(app).get('/api/typer/scorecard');
    expect(res.status).toBe(200);
    const { perPrediction, cumulative, distribution, balance, variance, evaluatedCount } = res.body;

    expect(evaluatedCount).toBe(3);

    // per-prediction, oldest-first, with the high-bit set carried through
    expect(perPrediction).toEqual([
      { forDrawNumber: 100, date: '2026-07-01', numbers: [1, 2, 3, 4, 5, 6], hits: 3, prizeTier: 4 },
      { forDrawNumber: 101, date: '2026-07-04', numbers: [33, 34, 35, 44, 45, 49], hits: 5, prizeTier: 2 },
      { forDrawNumber: 102, date: '2026-07-08', numbers: [1, 2, 3, 4, 5, 6], hits: 0, prizeTier: null },
    ]);

    // cumulative hits + expected + ±2σ band, hand-checked
    expect(cumulative.map((c) => c.cumHits)).toEqual([3, 8, 8]);
    expect(cumulative[2].expected).toBeCloseTo(3 * (36 / 49), 10);
    expect(cumulative[2].sigmaBand).toBeCloseTo(2 * Math.sqrt(3 * HITS_VARIANCE), 10);
    expect(cumulative[1].forDrawNumber).toBe(101);

    // distribution: observed counts + expected pmf·k
    expect(distribution.observed).toEqual({ 0: 1, 1: 0, 2: 0, 3: 1, 4: 0, 5: 1, 6: 0 });
    const expTotal = Object.values(distribution.expected).reduce((a, b) => a + b, 0);
    expect(expTotal).toBeCloseTo(3, 8);

    // balance: 3 coupons × 3 zł, winnings 24 + 6000
    expect(balance.cost).toBeCloseTo(9, 10);
    expect(balance.winnings).toBe(6024);
    expect(balance.net).toBeCloseTo(6015, 10);

    expect(variance).toBeCloseTo(0.5775718450645565, 12);
  });

  it('returns a sane empty shape when nothing is evaluated yet (k=0)', async () => {
    const res = await request(app).get('/api/typer/scorecard');
    expect(res.status).toBe(200);
    expect(res.body.evaluatedCount).toBe(0);
    expect(res.body.perPrediction).toEqual([]);
    expect(res.body.cumulative).toEqual([]);
    expect(res.body.balance).toEqual({ cost: 0, winnings: 0, net: 0 });
    for (let h = 0; h <= 6; h++) {
      expect(res.body.distribution.observed[String(h)]).toBe(0);
      expect(res.body.distribution.expected[String(h)]).toBe(0);
    }
  });

  it('excludes pending (not-yet-drawn) predictions from the scorecard', async () => {
    seedEvaluated(db);
    insertPrediction(db, 103, [7, 8, 9, 10, 11, 12]); // no draw 103 yet -> stays pending
    invalidateCache();
    const res = await request(app).get('/api/typer/scorecard');
    expect(res.body.evaluatedCount).toBe(3); // the pending one is not counted
  });

  it('reflects a freshly-evaluated prediction after evaluate invalidates the cache', async () => {
    seedEvaluated(db);
    const before = await request(app).get('/api/typer/scorecard');
    expect(before.body.evaluatedCount).toBe(3);

    // A new draw lands for a pending pick, gets scored, and evaluate drops the cache.
    insertPrediction(db, 103, [1, 2, 3, 4, 5, 6]);
    insertDraw(db, 103, [1, 2, 3, 4, 5, 6], '2026-07-11'); // 6 hits (I stopień)
    const { evaluated } = evaluatePredictions(db);
    expect(evaluated).toBe(1);

    const after = await request(app).get('/api/typer/scorecard');
    expect(after.body.evaluatedCount).toBe(4);
    expect(after.body.cumulative[3].cumHits).toBe(14); // 3+5+0+6
    expect(after.body.balance.winnings).toBe(6024 + 2000000);
  });
});
