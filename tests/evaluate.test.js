import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { prepareInsertDraw } from '../src/server/lib/draw-writer.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { evaluatePredictions } from '../src/server/lib/evaluate.js';

function insertDraw(db, drawNumber, numbers, drawnAt = '2026-07-14') {
  const insert = prepareInsertDraw(db);
  insert.run({
    gameType: 'lotto',
    drawNumber,
    drawnAt,
    n1: numbers[0], n2: numbers[1], n3: numbers[2], n4: numbers[3], n5: numbers[4], n6: numbers[5],
    mask: maskFromNumbers(numbers),
    source: 'mbnet',
    createdAt: Date.now(),
  });
  return db.prepare('SELECT id FROM draw WHERE game_type = ? AND draw_number = ?').get('lotto', drawNumber).id;
}

const insertPredictionSql = `
  INSERT INTO prediction (for_draw_number, numbers, mask, model_version, created_at)
  VALUES (@forDrawNumber, @numbers, @mask, @modelVersion, @createdAt)
`;

function insertPrediction(db, forDrawNumber, numbers) {
  db.prepare(insertPredictionSql).run({
    forDrawNumber,
    numbers: JSON.stringify(numbers),
    mask: maskFromNumbers(numbers),
    modelVersion: 'test-v1',
    createdAt: Date.now(),
  });
  return db.prepare('SELECT * FROM prediction WHERE for_draw_number = ?').get(forDrawNumber);
}

describe('evaluatePredictions(db)', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('does nothing when there are no pending predictions', () => {
    const result = evaluatePredictions(db);
    expect(result).toEqual({ evaluated: 0 });
  });

  it('leaves a prediction untouched when its for_draw_number has no matching draw yet', () => {
    insertPrediction(db, 42, [1, 2, 3, 4, 5, 6]);
    const result = evaluatePredictions(db);
    expect(result).toEqual({ evaluated: 0 });
    const row = db.prepare('SELECT * FROM prediction WHERE for_draw_number = 42').get();
    expect(row.result_draw_id).toBeNull();
    expect(row.hits).toBeNull();
    expect(row.prize_tier).toBeNull();
  });

  it('does not re-evaluate a prediction that already has a result_draw_id', () => {
    const drawId = insertDraw(db, 10, [1, 2, 3, 4, 5, 6]);
    db.prepare(insertPredictionSql).run({
      forDrawNumber: 10,
      numbers: JSON.stringify([1, 2, 3, 4, 5, 6]),
      mask: maskFromNumbers([1, 2, 3, 4, 5, 6]),
      modelVersion: 'test-v1',
      createdAt: Date.now(),
    });
    // Pre-mark it as already evaluated, with a deliberately wrong hits value, to prove a
    // second evaluatePredictions() run does not touch it again.
    db.prepare('UPDATE prediction SET result_draw_id = ?, hits = 99 WHERE for_draw_number = 10').run(drawId);

    const result = evaluatePredictions(db);
    expect(result).toEqual({ evaluated: 0 });
    const row = db.prepare('SELECT hits FROM prediction WHERE for_draw_number = 10').get();
    expect(row.hits).toBe(99); // untouched
  });

  it.each([
    // [predicted, drawn, expectedHits, expectedTier]
    [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], 0, null],
    [[1, 2, 3, 4, 5, 6], [1, 8, 9, 10, 11, 12], 1, null],
    [[1, 2, 3, 4, 5, 6], [1, 2, 9, 10, 11, 12], 2, null],
    [[1, 2, 3, 4, 5, 6], [1, 2, 3, 10, 11, 12], 3, 4], // IV stopień = 3 trafienia
    [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 11, 12], 4, 3], // III stopień = 4 trafienia
    [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 12], 5, 2], // II stopień = 5 trafień
    [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], 6, 1], // I stopień = 6 trafień
  ])('hits=%s numbers -> drawn=%s => hits=%i, prize_tier=%s', (predicted, drawn, expectedHits, expectedTier) => {
    const drawId = insertDraw(db, 100, drawn);
    insertPrediction(db, 100, predicted);

    const result = evaluatePredictions(db);
    expect(result).toEqual({ evaluated: 1 });

    const row = db.prepare('SELECT * FROM prediction WHERE for_draw_number = 100').get();
    expect(row.result_draw_id).toBe(drawId);
    expect(row.hits).toBe(expectedHits);
    expect(row.prize_tier).toBe(expectedTier);
  });

  it('is 49-bit-safe: a shared high bit (numbers >= 33, beyond JS 32-bit bitwise range) counts correctly, never via JS `&`', () => {
    // 33..38 and 44..49 both live above bit index 32 — a naive `pred.mask & draw.mask`
    // in JS would silently truncate both operands to 32 bits first (Number.prototype
    // bitwise ops), losing every one of these matches. Only the SQL bit_count() path
    // (SQLite's native 64-bit `&`) counts them correctly.
    const predicted = [33, 34, 35, 44, 45, 49];
    const drawn = [33, 34, 35, 44, 45, 46]; // 5 of 6 shared, all high bits
    const drawId = insertDraw(db, 200, drawn);
    insertPrediction(db, 200, predicted);

    evaluatePredictions(db);

    const row = db.prepare('SELECT * FROM prediction WHERE for_draw_number = 200').get();
    expect(row.result_draw_id).toBe(drawId);
    expect(row.hits).toBe(5);
    expect(row.prize_tier).toBe(2); // II stopień = 5 trafień
  });

  it('evaluates multiple pending predictions in one call', () => {
    insertDraw(db, 300, [1, 2, 3, 4, 5, 6]);
    insertDraw(db, 301, [10, 20, 30, 40, 41, 42]);
    insertPrediction(db, 300, [1, 2, 3, 7, 8, 9]); // 3 hits
    insertPrediction(db, 301, [10, 20, 30, 41, 42, 49]); // 5 hits

    const result = evaluatePredictions(db);
    expect(result).toEqual({ evaluated: 2 });

    expect(db.prepare('SELECT hits, prize_tier FROM prediction WHERE for_draw_number = 300').get()).toEqual({
      hits: 3,
      prize_tier: 4,
    });
    expect(db.prepare('SELECT hits, prize_tier FROM prediction WHERE for_draw_number = 301').get()).toEqual({
      hits: 5,
      prize_tier: 2,
    });
  });
});
