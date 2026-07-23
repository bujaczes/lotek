import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../db/index.js';
import { createApp } from '../src/server/app.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { invalidateCache } from '../src/server/lib/cache.js';
import { rebuildStats } from '../src/server/lib/rebuild-stats.js';
import { evaluatePredictions } from '../src/server/lib/evaluate.js';

function insertDraws(db, draws) {
  const insert = db.prepare(
    `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
     VALUES ('lotto', @drawNumber, @drawnAt, @n1, @n2, @n3, @n4, @n5, @n6, @mask, 'manual', @createdAt)`
  );
  for (const d of draws) {
    const [n1, n2, n3, n4, n5, n6] = d.numbers;
    insert.run({
      drawNumber: d.drawNumber, drawnAt: d.drawnAt, n1, n2, n3, n4, n5, n6,
      mask: maskFromNumbers(d.numbers), createdAt: Date.now(),
    });
  }
}

function insertPrediction(db, p) {
  db.prepare(
    `INSERT INTO prediction
       (for_draw_number, numbers, mask, model_version, bias_score, popularity_score, total_score,
        alternatives, commentary, created_at, result_draw_id, hits, prize_tier)
     VALUES
       (@forDrawNumber, @numbers, @mask, @modelVersion, @biasScore, @popularityScore, @totalScore,
        @alternatives, @commentary, @createdAt, @resultDrawId, @hits, @prizeTier)`
  ).run({
    forDrawNumber: p.forDrawNumber,
    numbers: JSON.stringify(p.numbers),
    mask: maskFromNumbers(p.numbers),
    modelVersion: p.modelVersion ?? '1.0.0',
    biasScore: p.biasScore ?? 0,
    popularityScore: p.popularityScore ?? 6.34,
    totalScore: p.totalScore ?? -6.34,
    alternatives: JSON.stringify(p.alternatives ?? []),
    commentary: p.commentary ?? null,
    createdAt: p.createdAt ?? Date.now(),
    resultDrawId: p.resultDrawId ?? null,
    hits: p.hits ?? null,
    prizeTier: p.prizeTier ?? null,
  });
}

const DRAWS = [
  { drawNumber: 1, drawnAt: '2020-01-05', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 2, drawnAt: '2020-01-08', numbers: [7, 8, 9, 10, 11, 12] },
  { drawNumber: 3, drawnAt: '2020-01-12', numbers: [1, 2, 3, 7, 8, 9] },
  { drawNumber: 4, drawnAt: '2020-01-15', numbers: [1, 7, 13, 14, 15, 16] },
  { drawNumber: 5, drawnAt: '2020-01-19', numbers: [5, 20, 36, 38, 43, 49] },
  { drawNumber: 6, drawnAt: '2020-01-22', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 7, drawnAt: '2021-02-02', numbers: [8, 9, 10, 17, 18, 19] },
  { drawNumber: 8, drawnAt: '2021-02-05', numbers: [20, 21, 22, 23, 24, 25] },
  { drawNumber: 9, drawnAt: '2021-02-09', numbers: [26, 27, 28, 29, 30, 31] },
  { drawNumber: 10, drawnAt: '2021-02-12', numbers: [32, 33, 34, 35, 36, 37] },
];

describe('GET /api/typer', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    insertDraws(db, DRAWS);
    rebuildStats(db);

    const draw10Id = db.prepare('SELECT id FROM draw WHERE draw_number = 10').get().id;
    // An older, already-evaluated prediction for draw 10 (3 hits -> IV stopień).
    insertPrediction(db, {
      forDrawNumber: 10,
      numbers: [1, 2, 3, 34, 35, 36],
      commentary: 'stary komentarz',
      alternatives: [{ numbers: [1, 2, 3, 34, 35, 37], totalScore: -1 }],
      resultDrawId: draw10Id,
      hits: 3,
      prizeTier: 4,
    });
    // The current, pending pick for draw 11.
    insertPrediction(db, {
      forDrawNumber: 11,
      numbers: [5, 20, 36, 38, 43, 49],
      commentary: '**Typ na losowanie nr 11**\n\nZacznijmy uczciwie: 1 : 13 983 816.',
      alternatives: [
        { numbers: [5, 20, 36, 38, 43, 48], totalScore: -6.3 },
        { numbers: [5, 20, 36, 38, 44, 49], totalScore: -6.31 },
        { numbers: [5, 20, 37, 38, 43, 49], totalScore: -6.33 },
      ],
    });

    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns current (pending pick) + history (newest first) + nullHypothesis', async () => {
    const res = await request(app).get('/api/typer');
    expect(res.status).toBe(200);

    const { current, history, nullHypothesis } = res.body;

    // current = the highest for_draw_number
    expect(current.prediction.forDrawNumber).toBe(11);
    expect(current.prediction.numbers).toEqual([5, 20, 36, 38, 43, 49]);
    expect(current.commentary).toContain('1 : 13 983 816');
    expect(current.prediction.alternatives).toHaveLength(3);
    expect(current.prediction.alternatives[0]).toEqual([5, 20, 36, 38, 43, 48]);
    expect(current.prediction.scores).toEqual({
      bias: expect.any(Number),
      popularity: expect.any(Number),
      total: expect.any(Number),
    });
    expect(typeof current.prediction.drawDate).toBe('string');

    // per-number stats: one row per chosen number, sorted, carrying number_stat fields
    expect(current.prediction.numberStats).toHaveLength(6);
    expect(current.prediction.numberStats.map((s) => s.number)).toEqual([5, 20, 36, 38, 43, 49]);
    const five = current.prediction.numberStats.find((s) => s.number === 5);
    expect(five.total).toBe(3); // number 5 appears in draws 1, 5 and 6
    expect(five).toHaveProperty('zScore');
    expect(five).toHaveProperty('currentGap');
    expect(five).toHaveProperty('lastDrawNumber');

    // history: the evaluated draw-10 prediction, with resultNumbers from the joined draw
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      forDrawNumber: 10,
      numbers: [1, 2, 3, 34, 35, 36],
      hits: 3,
      prizeTier: 4,
    });
    expect(history[0].resultNumbers).toEqual([32, 33, 34, 35, 36, 37]);

    // null hypothesis: one evaluated prediction so far, 3 cumulative hits
    expect(nullHypothesis.evaluatedCount).toBe(1);
    expect(nullHypothesis.totalHits).toBe(3);
    expect(nullHypothesis.expectedPerCoupon).toBeCloseTo(36 / 49, 12);
    expect(nullHypothesis.expectedHits).toBeCloseTo(36 / 49, 12);
  });

  it('reflects a freshly-evaluated prediction after evaluatePredictions invalidates the cache', async () => {
    const before = await request(app).get('/api/typer');
    expect(before.body.nullHypothesis.evaluatedCount).toBe(1);
    expect(before.body.current.prediction.hits).toBeNull();

    // Draw 11 lands and is scored -> the pending pick resolves; evaluate drops the cache.
    insertDraws(db, [{ drawNumber: 11, drawnAt: '2021-02-16', numbers: [5, 20, 36, 40, 41, 42] }]);
    const { evaluated } = evaluatePredictions(db);
    expect(evaluated).toBe(1);

    const after = await request(app).get('/api/typer');
    expect(after.body.nullHypothesis.evaluatedCount).toBe(2);
    expect(after.body.current.prediction.hits).toBe(3); // {5,20,36} shared with draw 11
    expect(after.body.current.prediction.resultNumbers).toEqual([5, 20, 36, 40, 41, 42]);
  });
});

describe('GET /api/typer — no predictions yet', () => {
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

  it('returns current: null with an empty history and a zeroed null hypothesis', async () => {
    const res = await request(app).get('/api/typer');
    expect(res.status).toBe(200);
    expect(res.body.current).toBeNull();
    expect(res.body.history).toEqual([]);
    expect(res.body.nullHypothesis.evaluatedCount).toBe(0);
    expect(res.body.nullHypothesis.totalHits).toBe(0);
  });
});
