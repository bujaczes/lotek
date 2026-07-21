import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';

describe('draw schema constraints', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  const insertDraw = db_ =>
    db_
      .prepare(
        `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
         VALUES (@game_type, @draw_number, @drawn_at, @n1, @n2, @n3, @n4, @n5, @n6, @mask, @source, @created_at)`
      );

  const baseDraw = overrides => ({
    game_type: 'lotto',
    draw_number: 7380,
    drawn_at: '2026-07-18',
    n1: 5,
    n2: 6,
    n3: 12,
    n4: 38,
    n5: 41,
    n6: 43,
    mask: maskFromNumbers([5, 6, 12, 38, 41, 43]),
    source: 'manual',
    created_at: Date.now(),
    ...overrides,
  });

  it('inserts a valid draw and generates sum_numbers', () => {
    insertDraw(db).run(baseDraw());
    const row = db.prepare('SELECT * FROM draw WHERE draw_number = 7380').get();
    expect(row.sum_numbers).toBe(5 + 6 + 12 + 38 + 41 + 43);
    expect(row.game_type).toBe('lotto');
  });

  it('rejects a duplicate (game_type, draw_number)', () => {
    insertDraw(db).run(baseDraw());
    expect(() => insertDraw(db).run(baseDraw({ drawn_at: '2026-07-21' }))).toThrow();
  });

  it('allows the same draw_number for a different game_type', () => {
    insertDraw(db).run(baseDraw());
    expect(() =>
      insertDraw(db).run(baseDraw({ game_type: 'lotto_plus', mask: maskFromNumbers([1, 2, 3, 4, 5, 6]), n1: 1, n2: 2, n3: 3, n4: 4, n5: 5, n6: 6 }))
    ).not.toThrow();
  });

  it('rejects numbers that are not strictly increasing', () => {
    expect(() => insertDraw(db).run(baseDraw({ n5: 38, n4: 41 }))).toThrow();
  });

  it('rejects numbers outside the 1..49 range', () => {
    expect(() => insertDraw(db).run(baseDraw({ n6: 50 }))).toThrow();
    expect(() => insertDraw(db).run(baseDraw({ n1: 0 }))).toThrow();
  });

  it('rejects an unknown source', () => {
    expect(() => insertDraw(db).run(baseDraw({ source: 'other' }))).toThrow();
  });

  it('rejects an unknown game_type', () => {
    expect(() => insertDraw(db).run(baseDraw({ game_type: 'euromillions' }))).toThrow();
  });
});
