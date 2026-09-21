import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/index.js';
import { prepareInsertDraw } from '../src/server/lib/draw-writer.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { upsertPrizes } from '../src/server/lib/prize-store.js';
import { syncPrizes } from '../src/server/lib/prizes-sync.js';
import { PrizesShapeError } from '../src/server/providers/openapi-prizes.js';

const NOW = () => new Date('2026-09-21T10:00:00Z');
const OK = {
  status: 'ok',
  tiers: {
    6: { winners: 0, amount: 0 },
    5: { winners: 32, amount: 721800 },
    4: { winners: 1744, amount: 40460 },
    3: { winners: 34020, amount: 2000 },
  },
};

function insertDraw(db, drawNumber, drawnAt) {
  const numbers = [3, 6, 9, 22, 40, 48];
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

const rowOf = (db, nr) => db.prepare('SELECT * FROM draw_prize WHERE draw_number = ?').get(nr);

describe('syncPrizes(db, options)', () => {
  let db;
  let sleep;
  let log;
  let invalidate;

  const run = (fetchPrizesFn, extra = {}) =>
    syncPrizes(db, { fetchPrizesFn, apiKey: 'k', sleep, log, invalidate, now: NOW, throttleMs: 1000, ...extra });

  beforeEach(() => {
    db = openDatabase(':memory:');
    sleep = vi.fn(async () => {});
    log = vi.fn();
    invalidate = vi.fn();
    insertDraw(db, 5047, '2011-08-23');
    insertDraw(db, 5048, '2011-08-25');
    insertDraw(db, 5049, '2011-08-27');
    insertDraw(db, 5050, '2011-08-30');
  });

  afterEach(() => {
    db.close();
  });

  it('fetches every draw from 5048 on, newest first, and stores each result', async () => {
    const fetchPrizesFn = vi.fn(async () => OK);

    const result = await run(fetchPrizesFn);

    expect(fetchPrizesFn.mock.calls.map((c) => c[0])).toEqual([5050, 5049, 5048]);
    expect(fetchPrizesFn).toHaveBeenCalledWith(5050, expect.objectContaining({ apiKey: 'k' }));
    expect(result).toEqual({ checked: 3, ok: 3, empty: 0, skipped: 0, stopped: false });
    expect(rowOf(db, 5050)).toMatchObject({ status: 'ok', winners_5: 32, amount_3: 2000 });
    expect(rowOf(db, 5047)).toBeUndefined();
  });

  it('waits throttleMs between requests (never before the first)', async () => {
    await run(vi.fn(async () => OK));
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('stores an empty answer as an empty row', async () => {
    const result = await run(vi.fn(async () => ({ status: 'empty' })), { limit: 1 });
    expect(result).toMatchObject({ checked: 1, ok: 0, empty: 1 });
    expect(rowOf(db, 5050).status).toBe('empty');
  });

  it('an HTTP/network error stops the batch but keeps what was already saved', async () => {
    const fetchPrizesFn = vi
      .fn()
      .mockResolvedValueOnce(OK)
      .mockRejectedValueOnce(new Error('openapi-prizes: HTTP 403 fetching …'));

    const result = await run(fetchPrizesFn);

    expect(fetchPrizesFn).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ checked: 1, ok: 1, stopped: true, error: expect.stringMatching(/403/) });
    expect(rowOf(db, 5050).status).toBe('ok');
    expect(rowOf(db, 5049)).toBeUndefined();
  });

  it('a malformed answer skips just that draw (no row, so it is retried next time)', async () => {
    const fetchPrizesFn = vi
      .fn()
      .mockResolvedValueOnce(OK)
      .mockRejectedValueOnce(new PrizesShapeError('openapi-prizes: draw 5049 — missing tier 3'))
      .mockResolvedValueOnce(OK);

    const result = await run(fetchPrizesFn);

    expect(result).toMatchObject({ checked: 2, ok: 2, skipped: 1, stopped: false });
    expect(rowOf(db, 5049)).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('5049'));
  });

  it('skips draws that already have prizes', async () => {
    upsertPrizes(db, 5050, OK, 1);
    const fetchPrizesFn = vi.fn(async () => OK);

    await run(fetchPrizesFn);

    expect(fetchPrizesFn.mock.calls.map((c) => c[0])).toEqual([5049, 5048]);
  });

  it('clears the response cache after the first new ok and at the end, not after an empty-only batch', async () => {
    await run(vi.fn(async () => OK));
    expect(invalidate).toHaveBeenCalledTimes(2);

    invalidate.mockClear();
    db.prepare('DELETE FROM draw_prize').run();
    await run(vi.fn(async () => ({ status: 'empty' })));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('limit caps how many draws one batch checks', async () => {
    const fetchPrizesFn = vi.fn(async () => OK);
    await run(fetchPrizesFn, { limit: 1 });
    expect(fetchPrizesFn.mock.calls.map((c) => c[0])).toEqual([5050]);
  });

  it('does nothing without an API key (local dev) and says so', async () => {
    const fetchPrizesFn = vi.fn();
    const result = await run(fetchPrizesFn, { apiKey: '' });
    expect(result).toMatchObject({ checked: 0, disabled: true });
    expect(fetchPrizesFn).not.toHaveBeenCalled();
  });
});
