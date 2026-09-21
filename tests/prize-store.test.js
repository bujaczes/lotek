import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { prepareInsertDraw } from '../src/server/lib/draw-writer.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import {
  FIRST_PRIZE_DRAW,
  selectDrawsNeedingPrizes,
  upsertPrizes,
  prizeStatus,
  prizesView,
  latestDrawPrizesSettled,
} from '../src/server/lib/prize-store.js';

const NOW = new Date('2026-09-21T10:00:00Z');
const OK = {
  status: 'ok',
  tiers: {
    6: { winners: 1, amount: 4479485500 },
    5: { winners: 107, amount: 887400 },
    4: { winners: 6221, amount: 20070 },
    3: { winners: 110146, amount: 3500 },
  },
};

function insertDraw(db, drawNumber, drawnAt, numbers = [3, 6, 9, 22, 40, 48]) {
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

describe('prize-store', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('FIRST_PRIZE_DRAW is the first draw the OpenAPI has prizes for (25.08.2011)', () => {
    expect(FIRST_PRIZE_DRAW).toBe(5048);
  });

  it('selectDrawsNeedingPrizes: from 5048 on, newest first, skipping ok rows and old empties', () => {
    insertDraw(db, 5047, '2011-08-23');
    insertDraw(db, 5048, '2011-08-25');
    insertDraw(db, 5049, '2011-08-27');
    insertDraw(db, 7405, '2026-09-15');
    insertDraw(db, 7406, '2026-09-17');
    insertDraw(db, 7407, '2026-09-19');
    upsertPrizes(db, 5049, { status: 'empty' }, 1); // old empty: final
    upsertPrizes(db, 7406, { status: 'empty' }, 1); // recent empty: may not be announced yet
    upsertPrizes(db, 7407, OK, 1);

    expect(selectDrawsNeedingPrizes(db, { now: NOW })).toEqual([7406, 7405, 5048]);
  });

  it('upsertPrizes overwrites an earlier empty row', () => {
    insertDraw(db, 7407, '2026-09-19');
    upsertPrizes(db, 7407, { status: 'empty' }, 1);
    upsertPrizes(db, 7407, OK, 2);

    const row = db.prepare('SELECT * FROM draw_prize WHERE draw_number = 7407').get();
    expect(row).toMatchObject({ status: 'ok', winners_6: 1, amount_6: 4479485500, amount_4: 20070, fetched_at: 2 });
  });

  it.each([
    ['ok row', { drawNumber: 7407, drawnAt: '2026-09-19', row: { status: 'ok' } }, 'ok'],
    ['before 5048, no row', { drawNumber: 5047, drawnAt: '2011-08-23', row: undefined }, 'unavailable'],
    ['5048+, no row yet', { drawNumber: 7407, drawnAt: '2026-09-19', row: undefined }, 'pending'],
    ['recent empty row', { drawNumber: 7407, drawnAt: '2026-09-19', row: { status: 'empty' } }, 'pending'],
    ['empty row older than 7 days', { drawNumber: 7400, drawnAt: '2026-09-03', row: { status: 'empty' } }, 'unavailable'],
  ])('prizeStatus: %s -> %s', (_, input, expected) => {
    expect(prizeStatus({ ...input, now: NOW })).toBe(expected);
  });

  it('prizesView returns tiers 6..3 in złoty for an ok row', () => {
    insertDraw(db, 7407, '2026-09-19');
    upsertPrizes(db, 7407, OK, 1);

    expect(prizesView(db, { drawNumber: 7407, drawnAt: '2026-09-19' }, { now: NOW })).toEqual({
      status: 'ok',
      tiers: [
        { hits: 6, winners: 1, amount: 44794855 },
        { hits: 5, winners: 107, amount: 8874 },
        { hits: 4, winners: 6221, amount: 200.7 },
        { hits: 3, winners: 110146, amount: 35 },
      ],
    });
  });

  it('prizesView returns only the status otherwise', () => {
    insertDraw(db, 5047, '2011-08-23');
    expect(prizesView(db, { drawNumber: 5047, drawnAt: '2011-08-23' }, { now: NOW })).toEqual({ status: 'unavailable' });
  });

  it('latestDrawPrizesSettled: false while the newest draw is pending, true once it has prizes', () => {
    insertDraw(db, 7406, '2026-09-17');
    insertDraw(db, 7407, '2026-09-19');
    upsertPrizes(db, 7406, OK, 1);
    expect(latestDrawPrizesSettled(db, { now: NOW })).toBe(false);

    upsertPrizes(db, 7407, OK, 2);
    expect(latestDrawPrizesSettled(db, { now: NOW })).toBe(true);
  });

  it('latestDrawPrizesSettled: true on an empty DB (nothing to wait for)', () => {
    expect(latestDrawPrizesSettled(db, { now: NOW })).toBe(true);
  });
});
