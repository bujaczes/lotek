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

describe('draw_prize schema', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  const insertPrize = (db_, overrides = {}) =>
    db_
      .prepare(
        `INSERT INTO draw_prize (game_type, draw_number, status, winners_6, amount_6, winners_5, amount_5,
                                 winners_4, amount_4, winners_3, amount_3, fetched_at)
         VALUES (@game_type, @draw_number, @status, @winners_6, @amount_6, @winners_5, @amount_5,
                 @winners_4, @amount_4, @winners_3, @amount_3, @fetched_at)`
      )
      .run({
        game_type: 'lotto',
        draw_number: 7407,
        status: 'ok',
        winners_6: 1,
        amount_6: 4479485500,
        winners_5: 107,
        amount_5: 887400,
        winners_4: 6221,
        amount_4: 20070,
        winners_3: 110146,
        amount_3: 3500,
        fetched_at: Date.now(),
        ...overrides,
      });

  it('stores one row per draw with amounts in grosze', () => {
    insertPrize(db);
    const row = db.prepare('SELECT * FROM draw_prize WHERE draw_number = 7407').get();
    expect(row).toMatchObject({ status: 'ok', winners_6: 1, amount_6: 4479485500, amount_3: 3500 });
  });

  it('accepts an empty row with NULL tiers', () => {
    insertPrize(db, {
      draw_number: 5047,
      status: 'empty',
      winners_6: null, amount_6: null, winners_5: null, amount_5: null,
      winners_4: null, amount_4: null, winners_3: null, amount_3: null,
    });
    expect(db.prepare('SELECT status FROM draw_prize WHERE draw_number = 5047').get().status).toBe('empty');
  });

  it('rejects an unknown status', () => {
    expect(() => insertPrize(db, { status: 'pending' })).toThrow(/CHECK constraint/);
  });

  it('rejects a second row for the same draw', () => {
    insertPrize(db);
    expect(() => insertPrize(db)).toThrow(/UNIQUE|PRIMARY KEY/);
  });
});
