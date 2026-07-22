import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { importHistory } from '../scripts/import-history.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(TESTS_DIR, '..', 'data', 'fixtures', 'dl_snapshot.txt.gz');

describe('importHistory', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  const smallFixture = [
    '1. 27.01.1957 8,12,31,39,43,45',
    '2. 03.02.1957 5,10,11,22,25,27',
    '3. 10.02.1957 18,19,20,26,45,49',
  ].join('\n');

  it('imports a well-formed small fixture: rows land in the db with correct masks and source', () => {
    const result = importHistory(db, smallFixture);

    expect(result.status).toBe('ok');
    expect(result.drawsAdded).toBe(3);
    expect(result.lastDrawNumber).toBe(3);

    const rows = db.prepare('SELECT * FROM draw ORDER BY draw_number').all();
    expect(rows).toHaveLength(3);

    expect(rows[0]).toMatchObject({
      game_type: 'lotto',
      draw_number: 1,
      drawn_at: '1957-01-27',
      n1: 8,
      n2: 12,
      n3: 31,
      n4: 39,
      n5: 43,
      n6: 45,
      mask: maskFromNumbers([8, 12, 31, 39, 43, 45]),
      source: 'mbnet',
    });
    expect(typeof rows[0].created_at).toBe('number');

    for (const row of rows) {
      const numbers = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
      expect(row.mask).toBe(maskFromNumbers(numbers));
    }
  });

  it('is idempotent: running the same text twice adds 0 rows on the second run and leaves the count unchanged', () => {
    const first = importHistory(db, smallFixture);
    expect(first.drawsAdded).toBe(3);

    const countAfterFirst = db.prepare('SELECT COUNT(*) AS c FROM draw').get().c;
    expect(countAfterFirst).toBe(3);

    const second = importHistory(db, smallFixture);
    expect(second.status).toBe('ok');
    expect(second.drawsAdded).toBe(0);

    const countAfterSecond = db.prepare('SELECT COUNT(*) AS c FROM draw').get().c;
    expect(countAfterSecond).toBe(3);
  });

  it('fails on a gap in draw numbering: status failed, database left untouched', () => {
    const textWithGap = [
      '1. 27.01.1957 8,12,31,39,43,45',
      '2. 03.02.1957 5,10,11,22,25,27',
      // draw 3 missing
      '4. 17.02.1957 2,11,14,37,40,45',
    ].join('\n');

    const result = importHistory(db, textWithGap);

    expect(result.status).toBe('failed');
    expect(result.missing).toEqual([3]);

    const count = db.prepare('SELECT COUNT(*) AS c FROM draw').get().c;
    expect(count).toBe(0);
  });

  it('does not clobber pre-existing rows when a later import has a numbering gap', () => {
    importHistory(db, smallFixture);
    const countBefore = db.prepare('SELECT COUNT(*) AS c FROM draw').get().c;
    expect(countBefore).toBe(3);

    const textWithGap = [
      '1. 27.01.1957 8,12,31,39,43,45',
      // draw 2 missing this time
      '3. 10.02.1957 18,19,20,26,45,49',
    ].join('\n');

    const result = importHistory(db, textWithGap);
    expect(result.status).toBe('failed');

    const countAfter = db.prepare('SELECT COUNT(*) AS c FROM draw').get().c;
    expect(countAfter).toBe(3);
  });

  it('writes an import_log row on success with started/finished timestamps, counts and status ok', () => {
    importHistory(db, smallFixture);

    const rows = db.prepare('SELECT * FROM import_log').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'mbnet',
      draws_added: 3,
      last_draw_number: 3,
      status: 'ok',
    });
    expect(typeof rows[0].started_at).toBe('number');
    expect(typeof rows[0].finished_at).toBe('number');
    expect(rows[0].finished_at).toBeGreaterThanOrEqual(rows[0].started_at);
    expect(rows[0].message).toBeTruthy();
  });

  it('writes an import_log row on a continuity failure with status failed and no draws_added', () => {
    const textWithGap = [
      '1. 27.01.1957 8,12,31,39,43,45',
      '4. 17.02.1957 2,11,14,37,40,45',
    ].join('\n');

    importHistory(db, textWithGap);

    const rows = db.prepare('SELECT * FROM import_log').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'mbnet',
      draws_added: 0,
      status: 'failed',
    });
    expect(rows[0].message).toBeTruthy();
  });

  it('records a second import_log row for a second run (idempotent import still gets logged)', () => {
    importHistory(db, smallFixture);
    importHistory(db, smallFixture);

    const rows = db.prepare('SELECT * FROM import_log').all();
    expect(rows).toHaveLength(2);
    expect(rows[1].draws_added).toBe(0);
    expect(rows[1].status).toBe('ok');
  });

  it('returns {draws: [] semantics} gracefully for an empty file: ok, 0 added, no gap', () => {
    const result = importHistory(db, '');
    expect(result.status).toBe('ok');
    expect(result.drawsAdded).toBe(0);

    const count = db.prepare('SELECT COUNT(*) AS c FROM draw').get().c;
    expect(count).toBe(0);
  });

  it('fails when every line fails to parse (e.g. mbnet serving an HTML maintenance page): status failed, no writes, no gap reported', () => {
    const garbage = [
      '<!DOCTYPE html>',
      '<html><body>Service temporarily unavailable</body></html>',
    ].join('\n');

    const result = importHistory(db, garbage);

    expect(result.status).toBe('failed');
    expect(result.drawsAdded).toBe(0);
    expect(result.lastDrawNumber).toBeNull();
    expect(result.totalParsed).toBe(0);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);

    const count = db.prepare('SELECT COUNT(*) AS c FROM draw').get().c;
    expect(count).toBe(0);

    const log = db.prepare('SELECT * FROM import_log').get();
    expect(log.status).toBe('failed');
    expect(log.draws_added).toBe(0);
    expect(log.message).toMatch(/no draws parsed/i);
  });

  it('writes a failed import_log row and re-throws when the insert transaction itself throws mid-batch', () => {
    // Real SQLite mechanism (not a JS mock): a BEFORE INSERT trigger that RAISEs
    // for draw_number 3 only, so draws 1 and 2 insert successfully first and then
    // the batch aborts mid-transaction — exactly the "disk full / SQLITE_BUSY"
    // shape the review asked to cover, without stubbing better-sqlite3 itself.
    db.exec(`
      CREATE TRIGGER forbid_draw_3
      BEFORE INSERT ON draw
      WHEN NEW.draw_number = 3
      BEGIN
        SELECT RAISE(ABORT, 'forced failure for test');
      END;
    `);

    expect(() => importHistory(db, smallFixture)).toThrow(/forced failure for test/);

    // better-sqlite3 auto-rolls-back the whole transaction on throw, so even the
    // draws inserted before the trigger fired (1 and 2) are gone.
    const count = db.prepare('SELECT COUNT(*) AS c FROM draw').get().c;
    expect(count).toBe(0);

    const log = db.prepare('SELECT * FROM import_log').get();
    expect(log.status).toBe('failed');
    expect(log.draws_added).toBe(0);
    expect(log.message).toMatch(/insert transaction failed/i);
    expect(log.message).toMatch(/forced failure for test/);
  });
});

describe('importHistory — integration on the committed dl_snapshot fixture', () => {
  let db;
  let text;

  beforeEach(() => {
    db = openDatabase(':memory:');
    const gz = readFileSync(SNAPSHOT_PATH);
    text = gunzipSync(gz).toString('utf8');
  });

  afterEach(() => {
    db.close();
  });

  it('imports the full committed snapshot into :memory: with a consistent, gap-free history', () => {
    const result = importHistory(db, text);

    expect(result.status).toBe('ok');

    const { count, maxDrawNumber } = db
      .prepare('SELECT COUNT(*) AS count, MAX(draw_number) AS maxDrawNumber FROM draw')
      .get();

    expect(count).toBe(maxDrawNumber);
    expect(count).toBeGreaterThanOrEqual(7380);
  });

  it('matches the control fact: draw 7380 on 2026-07-18 = {5,6,12,38,41,43}', () => {
    importHistory(db, text);

    const row = db.prepare('SELECT * FROM draw WHERE draw_number = 7380').get();
    expect(row).toBeTruthy();
    expect(row.drawn_at).toBe('2026-07-18');
    expect([row.n1, row.n2, row.n3, row.n4, row.n5, row.n6]).toEqual([5, 6, 12, 38, 41, 43]);
    expect(row.mask).toBe(maskFromNumbers([5, 6, 12, 38, 41, 43]));
  });

  it('has no duplicate rows per (game_type, draw_number) — one row, one mask, per draw_number', () => {
    importHistory(db, text);

    const dupes = db
      .prepare(
        `SELECT draw_number, COUNT(*) AS c
         FROM draw
         GROUP BY game_type, draw_number
         HAVING COUNT(*) > 1`
      )
      .all();
    expect(dupes).toEqual([]);

    const { total, distinctDrawNumbers } = db
      .prepare('SELECT COUNT(*) AS total, COUNT(DISTINCT draw_number) AS distinctDrawNumbers FROM draw')
      .get();
    expect(total).toBe(distinctDrawNumbers);
  });
});
