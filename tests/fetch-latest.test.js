import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/index.js';
import { importHistory } from '../scripts/import-history.js';
import { fetchLatest } from '../src/server/lib/fetch-latest.js';
import * as lottopl from '../src/server/providers/lottopl.js';
import * as mbnet from '../src/server/providers/mbnet.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';

const SEED_TEXT = [
  '1. 27.01.1957 8,12,31,39,43,45',
  '2. 03.02.1957 5,10,11,22,25,27',
  '3. 10.02.1957 18,19,20,26,45,49',
].join('\n');

function numberStatSnapshot(db) {
  return JSON.stringify(db.prepare('SELECT * FROM number_stat ORDER BY number').all());
}

function draw(drawNumber, drawnAt, numbers, source = 'test') {
  return { drawNumber, drawnAt, numbers, source };
}

function fakeProvider(source, impl) {
  return { SOURCE: source, fetchSince: vi.fn(impl) };
}

describe('fetchLatest', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
    importHistory(db, SEED_TEXT); // seeds draws 1-3, rebuilds stats
  });

  afterEach(() => {
    db.close();
  });

  it('nothing new: {status: "ok", added: 0}, lastNumber unchanged, no rebuild, but still logs the run', async () => {
    const before = numberStatSnapshot(db);
    const provider = fakeProvider('lottopl', async () => []);

    const result = await fetchLatest(db, { providers: [provider] });

    expect(result).toEqual({ status: 'ok', added: 0, lastNumber: 3, provider: 'lottopl' });
    expect(db.prepare('SELECT COUNT(*) AS c FROM draw').get().c).toBe(3);
    expect(numberStatSnapshot(db)).toBe(before); // unchanged: rebuildStats was NOT called

    const log = db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
    expect(log).toMatchObject({ source: 'lottopl', draws_added: 0, last_draw_number: 3, status: 'ok' });
  });

  it('adds new contiguous draws, computes the mask, tags the winning provider as source, and rebuilds stats', async () => {
    const before = numberStatSnapshot(db);
    const provider = fakeProvider('mbnet', async (since) =>
      [draw(4, '2026-07-14', [1, 2, 3, 4, 5, 6]), draw(5, '2026-07-16', [7, 8, 9, 10, 11, 12])].filter(
        (d) => d.drawNumber > since
      )
    );

    const result = await fetchLatest(db, { providers: [provider] });

    expect(result).toEqual({ status: 'ok', added: 2, lastNumber: 5, provider: 'mbnet' });

    const rows = db.prepare('SELECT * FROM draw WHERE draw_number IN (4, 5) ORDER BY draw_number').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      game_type: 'lotto',
      draw_number: 4,
      drawn_at: '2026-07-14',
      n1: 1, n2: 2, n3: 3, n4: 4, n5: 5, n6: 6,
      mask: maskFromNumbers([1, 2, 3, 4, 5, 6]),
      source: 'mbnet',
    });
    expect(numberStatSnapshot(db)).not.toBe(before); // rebuildStats WAS called
  });

  it('idempotence: invoking fetchLatest twice in a row only imports once, the second run is a clean "nothing new"', async () => {
    const pool = [draw(4, '2026-07-14', [1, 2, 3, 4, 5, 6]), draw(5, '2026-07-16', [7, 8, 9, 10, 11, 12])];
    const provider = fakeProvider('lottopl', async (since) => pool.filter((d) => d.drawNumber > since));

    const first = await fetchLatest(db, { providers: [provider] });
    expect(first).toEqual({ status: 'ok', added: 2, lastNumber: 5, provider: 'lottopl' });

    const second = await fetchLatest(db, { providers: [provider] });
    expect(second).toEqual({ status: 'ok', added: 0, lastNumber: 5, provider: 'lottopl' });

    expect(db.prepare('SELECT COUNT(*) AS c FROM draw').get().c).toBe(5);
    // 3 rows total: 1 from the beforeEach seed import + 1 per fetchLatest call below.
    const logs = db.prepare('SELECT * FROM import_log ORDER BY id').all();
    expect(logs).toHaveLength(3);
    expect(logs[1].draws_added).toBe(2); // the first fetchLatest call
    expect(logs[2].draws_added).toBe(0); // the second, idempotent no-op call
  });

  it('a gap between the DB and the provider\'s results imports only the contiguous prefix and logs status "partial"', async () => {
    // Provider skips draw 5 entirely (e.g. a stale cache): draws 4 and 6, no 5.
    const provider = fakeProvider('lottopl', async () => [draw(4, '2026-07-14', [1, 2, 3, 4, 5, 6]), draw(6, '2026-07-18', [7, 8, 9, 10, 11, 12])]);

    const result = await fetchLatest(db, { providers: [provider] });

    expect(result).toEqual({ status: 'partial', added: 1, lastNumber: 4, provider: 'lottopl' });
    expect(db.prepare('SELECT COUNT(*) AS c FROM draw').get().c).toBe(4); // only draw 4 landed, not 6
    expect(db.prepare('SELECT draw_number FROM draw WHERE draw_number = 6').get()).toBeUndefined();

    const log = db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
    expect(log).toMatchObject({ source: 'lottopl', draws_added: 1, last_draw_number: 4, status: 'partial' });
    expect(log.message).toMatch(/gap/i);
  });

  it('a gap right after the last DB draw (provider\'s first result already skips ahead) imports nothing but still reports "partial"', async () => {
    const provider = fakeProvider('lottopl', async () => [draw(5, '2026-07-16', [7, 8, 9, 10, 11, 12])]); // should have started at 4

    const result = await fetchLatest(db, { providers: [provider] });

    expect(result).toEqual({ status: 'partial', added: 0, lastNumber: 3, provider: 'lottopl' });
    expect(db.prepare('SELECT COUNT(*) AS c FROM draw').get().c).toBe(3);
  });

  it('writes a complete import_log row on every path: started/finished timestamps, source, counts, status, message', async () => {
    const provider = fakeProvider('mbnet', async () => [draw(4, '2026-07-14', [1, 2, 3, 4, 5, 6])]);

    await fetchLatest(db, { providers: [provider] });

    const log = db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
    expect(log.source).toBe('mbnet');
    expect(typeof log.started_at).toBe('number');
    expect(typeof log.finished_at).toBe('number');
    expect(log.finished_at).toBeGreaterThanOrEqual(log.started_at);
    expect(log.draws_added).toBe(1);
    expect(log.last_draw_number).toBe(4);
    expect(log.status).toBe('ok');
    expect(log.message).toBeTruthy();
  });

  it('every provider failing: throws, writes a status "failed" import_log row, and leaves the draw table untouched', async () => {
    const provider = fakeProvider('lottopl', async () => {
      throw new Error('lotto.pl is down');
    });

    await expect(fetchLatest(db, { providers: [provider] })).rejects.toThrow(/all providers failed/);

    expect(db.prepare('SELECT COUNT(*) AS c FROM draw').get().c).toBe(3);
    const log = db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
    expect(log.status).toBe('failed');
    expect(log.message).toMatch(/lotto\.pl is down/);
  });

  it('end-to-end fallback with the real providers: lottopl throws (network down) -> mbnet saves the day', async () => {
    const dlText = [
      '1. 27.01.1957 8,12,31,39,43,45',
      '2. 03.02.1957 5,10,11,22,25,27',
      '3. 10.02.1957 18,19,20,26,45,49',
      '4. 17.02.1957 2,11,14,37,40,45',
    ].join('\n');

    const fetchFn = vi.fn(async (url) => {
      if (String(url).includes('lotto.pl')) throw new Error('network unreachable');
      if (String(url).includes('mbnet.com.pl')) return { ok: true, status: 200, text: async () => dlText };
      throw new Error(`unexpected url in test: ${url}`);
    });

    const result = await fetchLatest(db, { providers: [lottopl, mbnet], fetchFn });

    expect(result).toEqual({ status: 'ok', added: 1, lastNumber: 4, provider: 'mbnet' });
    const row = db.prepare('SELECT * FROM draw WHERE draw_number = 4').get();
    expect(row).toMatchObject({ drawn_at: '1957-02-17', n1: 2, n2: 11, n3: 14, n4: 37, n5: 40, n6: 45, source: 'mbnet' });
  });
});
