import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/index.js';
import { prepareInsertDraw } from '../src/server/lib/draw-writer.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import {
  runFetchCycle,
  reconcile,
  runWatchdog,
  startScheduler,
  shouldStartScheduler,
} from '../src/server/lib/scheduler.js';

function insertDraw(db, drawNumber, numbers, drawnAt) {
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
}

function fakeFetchResult({ status = 'ok', added = 0, lastNumber = 0, provider = 'mbnet' } = {}) {
  return { status, added, lastNumber, provider };
}

function textResponse(text, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => text };
}

// ---------------------------------------------------------------------------
// runFetchCycle
// ---------------------------------------------------------------------------
describe('runFetchCycle(db, options)', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('success on the first attempt: calls evaluate + the predict hook exactly once, never schedules a retry', async () => {
    const fetchLatestFn = vi.fn(async () => fakeFetchResult({ added: 2, lastNumber: 5 }));
    const evaluateFn = vi.fn(() => ({ evaluated: 1 }));
    const predict = vi.fn(async () => {});
    const scheduleRetry = vi.fn();

    const result = await runFetchCycle(db, {
      hooks: { predict },
      fetchLatestFn,
      evaluateFn,
      scheduleRetry,
    });

    expect(fetchLatestFn).toHaveBeenCalledTimes(1);
    expect(evaluateFn).toHaveBeenCalledTimes(1);
    expect(evaluateFn).toHaveBeenCalledWith(db);
    expect(predict).toHaveBeenCalledTimes(1);
    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ok', added: 2, lastNumber: 5, provider: 'mbnet', attempts: 1 });
  });

  it('success with no predict hook at all: does not throw, evaluate still runs', async () => {
    const fetchLatestFn = vi.fn(async () => fakeFetchResult({ added: 1, lastNumber: 4 }));
    const evaluateFn = vi.fn(() => ({ evaluated: 1 }));

    const result = await runFetchCycle(db, { fetchLatestFn, evaluateFn, scheduleRetry: vi.fn() });

    expect(evaluateFn).toHaveBeenCalledTimes(1);
    expect(result.added).toBe(1);
  });

  it('nothing new, then success on a retry: schedules exactly as many retries as needed, then runs evaluate + hook once', async () => {
    const fetchLatestFn = vi
      .fn()
      .mockResolvedValueOnce(fakeFetchResult({ added: 0, lastNumber: 3 }))
      .mockResolvedValueOnce(fakeFetchResult({ added: 0, lastNumber: 3 }))
      .mockResolvedValueOnce(fakeFetchResult({ added: 1, lastNumber: 4 }));
    const evaluateFn = vi.fn(() => ({ evaluated: 1 }));
    const predict = vi.fn(async () => {});
    const scheduleRetry = vi.fn((fn) => fn()); // synchronous stand-in: run the retry immediately

    const result = await runFetchCycle(db, {
      hooks: { predict },
      fetchLatestFn,
      evaluateFn,
      scheduleRetry,
    });

    expect(fetchLatestFn).toHaveBeenCalledTimes(3);
    expect(scheduleRetry).toHaveBeenCalledTimes(2);
    expect(evaluateFn).toHaveBeenCalledTimes(1);
    expect(predict).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ok', added: 1, lastNumber: 4, attempts: 3 });

    const failedLogs = db.prepare("SELECT * FROM import_log WHERE status = 'failed'").all();
    expect(failedLogs).toHaveLength(0);
  });

  it('schedules retries with the configured interval (10 min by default from config/schedule.json)', async () => {
    const fetchLatestFn = vi
      .fn()
      .mockResolvedValueOnce(fakeFetchResult({ added: 0 }))
      .mockResolvedValueOnce(fakeFetchResult({ added: 1, lastNumber: 1 }));
    const scheduleRetry = vi.fn((fn) => fn());

    await runFetchCycle(db, { fetchLatestFn, evaluateFn: vi.fn(), scheduleRetry });

    expect(scheduleRetry).toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000);
  });

  it('a custom retryIntervalMs/maxRetryAttempts override the config defaults', async () => {
    const fetchLatestFn = vi.fn(async () => fakeFetchResult({ added: 0 }));
    const scheduleRetry = vi.fn(); // never invoke the retry callback — deliberately fire-and-forget below

    // Not awaited: with scheduleRetry never calling back, the returned promise never
    // settles. Only the call args recorded so far (up to the first retry decision)
    // matter for this test, so let one macrotask tick flush the async chain instead.
    runFetchCycle(db, {
      fetchLatestFn,
      evaluateFn: vi.fn(),
      scheduleRetry,
      maxRetryAttempts: 2,
      retryIntervalMs: 5000,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchLatestFn).toHaveBeenCalledTimes(1);
    expect(scheduleRetry).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it('exhausts all retries (max 12) without ever finding a new draw: writes a single "failed" import_log row and never calls evaluate/hook', async () => {
    const fetchLatestFn = vi.fn(async () => fakeFetchResult({ added: 0, lastNumber: 7380 }));
    const evaluateFn = vi.fn();
    const predict = vi.fn();
    const scheduleRetry = vi.fn((fn) => fn()); // run every retry synchronously, no real delay

    const result = await runFetchCycle(db, {
      hooks: { predict },
      fetchLatestFn,
      evaluateFn,
      scheduleRetry,
    });

    expect(fetchLatestFn).toHaveBeenCalledTimes(13); // 1 initial + 12 retries
    expect(scheduleRetry).toHaveBeenCalledTimes(12);
    expect(evaluateFn).not.toHaveBeenCalled();
    expect(predict).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ok', added: 0, exhausted: true, attempts: 13 });

    const log = db.prepare("SELECT * FROM import_log WHERE status = 'failed' ORDER BY id DESC LIMIT 1").get();
    expect(log).toBeTruthy();
    expect(log.message).toBe('brak wyniku do 00:05');
  });

  it('a fetchLatestFn rejection propagates (does not retry, does not evaluate)', async () => {
    const fetchLatestFn = vi.fn(async () => {
      throw new Error('all providers failed: boom');
    });
    const evaluateFn = vi.fn();
    const scheduleRetry = vi.fn();

    await expect(runFetchCycle(db, { fetchLatestFn, evaluateFn, scheduleRetry })).rejects.toThrow(/boom/);
    expect(evaluateFn).not.toHaveBeenCalled();
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it('end-to-end with the real fetchLatest + real evaluatePredictions (only the provider chain is faked): a new draw flows all the way through to a scored prediction and the predict hook', async () => {
    insertDraw(db, 7380, [5, 6, 12, 38, 41, 43], '2026-07-18'); // seed, matches CONVENTIONS.md control fact
    db.prepare(
      `INSERT INTO prediction (for_draw_number, numbers, mask, model_version, created_at)
       VALUES (7381, '[4,16,23,27,29,33]', ?, 'test-v1', ?)`
    ).run(maskFromNumbers([4, 16, 23, 27, 29, 33]), Date.now());

    const fakeProvider = {
      SOURCE: 'mbnet',
      fetchSince: vi.fn(async (since) =>
        since < 7381 ? [{ drawNumber: 7381, drawnAt: '2026-07-21', numbers: [4, 16, 23, 27, 29, 33], source: 'mbnet' }] : []
      ),
    };
    const predict = vi.fn(async () => {});

    const result = await runFetchCycle(db, {
      providers: [fakeProvider],
      hooks: { predict },
      scheduleRetry: vi.fn(),
    });

    expect(result).toMatchObject({ status: 'ok', added: 1, lastNumber: 7381, provider: 'mbnet', attempts: 1 });
    expect(predict).toHaveBeenCalledTimes(1);

    const draw = db.prepare('SELECT * FROM draw WHERE draw_number = 7381').get();
    expect(draw).toMatchObject({ n1: 4, n2: 16, n3: 23, n4: 27, n5: 29, n6: 33, source: 'mbnet' });

    // The prediction was an exact 6/6 match against the newly-imported draw — real
    // evaluatePredictions() ran (not a mock), driven off the real bit_count() SQL path.
    const prediction = db.prepare('SELECT * FROM prediction WHERE for_draw_number = 7381').get();
    expect(prediction.result_draw_id).toBe(draw.id);
    expect(prediction.hits).toBe(6);
    expect(prediction.prize_tier).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------
describe('reconcile(db, options) — full dl.txt diff vs the DB, report-only', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('identical: DB matches dl.txt exactly -> status "ok", "0 rozjazdów", no missing/divergent', async () => {
    insertDraw(db, 1, [8, 12, 31, 39, 43, 45], '1957-01-27');
    insertDraw(db, 2, [5, 10, 11, 22, 25, 27], '1957-02-03');
    const dlText = ['1. 27.01.1957 8,12,31,39,43,45', '2. 03.02.1957 5,10,11,22,25,27'].join('\n');
    const fetchFn = vi.fn(async () => textResponse(dlText));

    const result = await reconcile(db, { fetchFn });

    expect(result).toEqual({ status: 'ok', checked: 2, missing: [], divergent: [] });
    const log = db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
    expect(log).toMatchObject({ source: 'mbnet', status: 'ok', message: '0 rozjazdów' });
  });

  it('a draw present in dl.txt but missing from the DB is reported, never auto-inserted', async () => {
    insertDraw(db, 1, [8, 12, 31, 39, 43, 45], '1957-01-27');
    const dlText = ['1. 27.01.1957 8,12,31,39,43,45', '2. 03.02.1957 5,10,11,22,25,27'].join('\n');
    const fetchFn = vi.fn(async () => textResponse(dlText));

    const result = await reconcile(db, { fetchFn });

    expect(result.status).toBe('partial');
    expect(result.missing).toEqual([2]);
    expect(result.divergent).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS c FROM draw').get().c).toBe(1); // still not inserted

    const log = db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
    expect(log.status).toBe('partial');
    expect(log.message).toMatch(/brakując/i);
  });

  it('a draw present in both with different numbers is reported as divergent, and the DB row is left untouched', async () => {
    insertDraw(db, 1, [1, 2, 3, 4, 5, 6], '1957-01-27'); // DB disagrees with dl.txt
    const dlText = '1. 27.01.1957 8,12,31,39,43,45';
    const fetchFn = vi.fn(async () => textResponse(dlText));

    const result = await reconcile(db, { fetchFn });

    expect(result.status).toBe('partial');
    expect(result.missing).toEqual([]);
    expect(result.divergent).toEqual([{ drawNumber: 1, db: [1, 2, 3, 4, 5, 6], mbnet: [8, 12, 31, 39, 43, 45] }]);

    const row = db.prepare('SELECT n1 FROM draw WHERE draw_number = 1').get();
    expect(row.n1).toBe(1); // NOT overwritten by reconcile

    const log = db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
    expect(log.status).toBe('partial');
    expect(log.message).toMatch(/rozbież/i);
  });

  it('draws only in the DB (newer than dl.txt — mbnet is known to lag) are not treated as a divergence', async () => {
    insertDraw(db, 1, [8, 12, 31, 39, 43, 45], '1957-01-27');
    insertDraw(db, 2, [5, 10, 11, 22, 25, 27], '1957-02-03'); // ahead of the dl.txt snapshot below
    const dlText = '1. 27.01.1957 8,12,31,39,43,45';
    const fetchFn = vi.fn(async () => textResponse(dlText));

    const result = await reconcile(db, { fetchFn });

    expect(result).toEqual({ status: 'ok', checked: 1, missing: [], divergent: [] });
  });

  it('an HTTP failure fetching dl.txt writes a "failed" import_log row and rethrows', async () => {
    const fetchFn = vi.fn(async () => textResponse('', { ok: false, status: 503 }));

    await expect(reconcile(db, { fetchFn })).rejects.toThrow(/503/);

    const log = db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
    expect(log.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// runWatchdog
// ---------------------------------------------------------------------------
describe('runWatchdog(db, options) — >24h past the last expected draw with no entry -> failed', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('not yet stale (well within 24h of the last expected slot): no import_log write', () => {
    // 2026-07-23 is a Thursday; last expected slot is Tue 2026-07-21 22:00 Warsaw.
    // "now" here is chosen close to that slot (well under 24h later).
    const now = () => new Date('2026-07-22T10:00:00Z');

    const result = runWatchdog(db, { now });

    expect(result.status).toBe('skipped');
    expect(db.prepare('SELECT COUNT(*) AS c FROM import_log').get().c).toBe(0);
  });

  it('stale (>24h past the expected slot) but the DB already has a draw for that date: status "ok", no failed log', () => {
    insertDraw(db, 7381, [4, 16, 23, 27, 29, 33], '2026-07-21');
    const now = () => new Date('2026-07-23T10:00:00Z'); // >24h after Tue 2026-07-21 20:00Z

    const result = runWatchdog(db, { now });

    expect(result.status).toBe('ok');
    expect(db.prepare('SELECT COUNT(*) AS c FROM import_log').get().c).toBe(0);
  });

  it('stale (>24h past the expected slot) with no matching draw row: writes a "failed" import_log row', () => {
    const now = () => new Date('2026-07-23T10:00:00Z'); // >24h after Tue 2026-07-21 20:00Z, no draw for it

    const result = runWatchdog(db, { now });

    expect(result.status).toBe('failed');
    const log = db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
    expect(log).toMatchObject({ status: 'failed', message: 'watchdog: brak losowania' });
  });
});

// ---------------------------------------------------------------------------
// shouldStartScheduler
// ---------------------------------------------------------------------------
describe('shouldStartScheduler({nodeEnv, schedulerEnabled}) — pure gate used by server.js', () => {
  it('does not start under NODE_ENV=test', () => {
    expect(shouldStartScheduler({ nodeEnv: 'test', schedulerEnabled: undefined })).toBe(false);
  });

  it('does not start when SCHEDULER_ENABLED=0, even outside test', () => {
    expect(shouldStartScheduler({ nodeEnv: 'production', schedulerEnabled: '0' })).toBe(false);
  });

  it('does not start under NODE_ENV=test even if SCHEDULER_ENABLED is truthy', () => {
    expect(shouldStartScheduler({ nodeEnv: 'test', schedulerEnabled: '1' })).toBe(false);
  });

  it('starts in dev/production when SCHEDULER_ENABLED is unset or not "0"', () => {
    expect(shouldStartScheduler({ nodeEnv: 'development', schedulerEnabled: undefined })).toBe(true);
    expect(shouldStartScheduler({ nodeEnv: 'production', schedulerEnabled: undefined })).toBe(true);
    expect(shouldStartScheduler({ nodeEnv: 'production', schedulerEnabled: '1' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// startScheduler
// ---------------------------------------------------------------------------
describe('startScheduler(db, options) — wires the three cron jobs + in-process overlap guard', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  function FakeCron(pattern, options, fn) {
    return { pattern, options, fn, nextRun: () => null, stop: vi.fn() };
  }

  it('registers exactly 3 jobs with the cron patterns/timezone derived from config/schedule.json', () => {
    const handle = startScheduler(db, { CronImpl: FakeCron });

    expect(handle.jobs.fetch.pattern).toBe('5 22 * * 2,4,6');
    expect(handle.jobs.fetch.options).toMatchObject({ timezone: 'Europe/Warsaw' });

    expect(handle.jobs.reconcile.pattern).toBe('0 8 * * 0');
    expect(handle.jobs.reconcile.options).toMatchObject({ timezone: 'Europe/Warsaw' });

    expect(handle.jobs.watchdog.pattern).toBe('0 12 * * *');
    expect(handle.jobs.watchdog.options).toMatchObject({ timezone: 'Europe/Warsaw' });
  });

  it('overlap guard: triggering the fetch cycle again while one is still in flight does not start a second one', async () => {
    const resolvers = [];
    const runFetchCycleFn = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const handle = startScheduler(db, { CronImpl: FakeCron, runFetchCycleFn });

    const first = handle.triggerFetchCycle();
    const second = handle.triggerFetchCycle(); // should be a no-op: previous still running

    expect(runFetchCycleFn).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();

    resolvers[0]({ status: 'ok', added: 0 });
    await first;
    await second;

    // Now that the first cycle finished, a fresh trigger is allowed again.
    const third = handle.triggerFetchCycle();
    expect(runFetchCycleFn).toHaveBeenCalledTimes(2);
    resolvers[1]({ status: 'ok', added: 0 });
    await third;

    warnSpy.mockRestore();
  });

  it('stop() stops every registered job', () => {
    const handle = startScheduler(db, { CronImpl: FakeCron });
    handle.stop();

    expect(handle.jobs.fetch.stop).toHaveBeenCalled();
    expect(handle.jobs.reconcile.stop).toHaveBeenCalled();
    expect(handle.jobs.watchdog.stop).toHaveBeenCalled();
  });
});
