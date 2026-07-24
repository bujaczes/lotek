import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { openDatabase } from '../db/index.js';
import { createApp } from '../src/server/app.js';
import { latestDrawHandler } from '../src/server/draws.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { invalidateCache } from '../src/server/lib/cache.js';

// 10-draw synthetic history, hand-designed so every field asked for in the brief has an
// exact, hand-verifiable expected value (see task-6-report.md for the full derivation):
//  - draws 1, 5, 6 all carry the exact same six numbers {1,2,3,4,5,6}: draw 1 is the
//    first-ever occurrence (premiere), draw 5 is deja-vu of draw 1, draw 6 is deja-vu of
//    draw 5 (the MOST RECENT prior occurrence, not the first) -- and simultaneously a
//    nearestNeighbor tie between draw 1 and draw 5 (both share all 6 numbers), broken to
//    the newer one (draw 5), per "remis -> nowsze".
//  - draw 3 = {1,2,3,7,8,9} ties nearestNeighbor between draw 1 (shares {1,2,3}=3) and
//    draw 2 (shares {7,8,9}=3) -- same tie-break, resolves to draw 2 (newer).
//  - draw 4 = {1,7,13,14,15,16} gives number 1 a clean two-prior-occurrence chip history
//    (draws 1 and 3) ahead of draw 5.
//  - draws 1-6 are dated 2020, draws 7-10 are dated 2021 (year filter); draws 7-10 use
//    disjoint filler numbers (no accidental extra deja-vu/overlap).
const DRAWS = [
  { drawNumber: 1, drawnAt: '2020-01-05', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 2, drawnAt: '2020-01-08', numbers: [7, 8, 9, 10, 11, 12] },
  { drawNumber: 3, drawnAt: '2020-01-12', numbers: [1, 2, 3, 7, 8, 9] },
  { drawNumber: 4, drawnAt: '2020-01-15', numbers: [1, 7, 13, 14, 15, 16] },
  { drawNumber: 5, drawnAt: '2020-01-19', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 6, drawnAt: '2020-01-22', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 7, drawnAt: '2021-02-02', numbers: [8, 9, 10, 17, 18, 19] },
  { drawNumber: 8, drawnAt: '2021-02-05', numbers: [20, 21, 22, 23, 24, 25] },
  { drawNumber: 9, drawnAt: '2021-02-09', numbers: [26, 27, 28, 29, 30, 31] },
  { drawNumber: 10, drawnAt: '2021-02-12', numbers: [32, 33, 34, 35, 36, 37] },
];

function seed(db) {
  const insert = db.prepare(
    `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
     VALUES ('lotto', @drawNumber, @drawnAt, @n1, @n2, @n3, @n4, @n5, @n6, @mask, 'manual', @createdAt)`
  );
  for (const d of DRAWS) {
    insert.run({
      drawNumber: d.drawNumber,
      drawnAt: d.drawnAt,
      n1: d.numbers[0],
      n2: d.numbers[1],
      n3: d.numbers[2],
      n4: d.numbers[3],
      n5: d.numbers[4],
      n6: d.numbers[5],
      mask: maskFromNumbers(d.numbers),
      createdAt: Date.now(),
    });
  }
}

describe('GET /api/draws/:nr', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    seed(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it('draw 1 (first ever): premiere verdict, all chips at countBefore=0, no neighbor, no prev, next=2', async () => {
    const res = await request(app).get('/api/draws/1');
    expect(res.status).toBe(200);
    expect(res.body.drawNumber).toBe(1);
    expect(res.body.date).toBe('2020-01-05');
    expect(res.body.numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(res.body.sum).toBe(21);
    expect(res.body.verdict).toEqual({ type: 'premiera' });
    expect(res.body.chips).toHaveLength(6);
    for (const chip of res.body.chips) {
      expect(chip.countBefore).toBe(0);
      expect(chip.lastSeenBefore).toBeNull();
    }
    expect(res.body.nearestNeighbor).toBeNull();
    expect(res.body.prev).toBeNull();
    expect(res.body.next).toEqual({ drawNumber: 2, date: '2020-01-08' });
  });

  it('nearestNeighbor.sharedNumbers is correct for numbers >=33 (bit positions 32-48, outside JS 32-bit bitwise range)', async () => {
    // draw 10 = {32,33,34,35,36,37}; a later draw sharing 34,35,36 with it must report
    // exactly those numbers, not a JS `&`-truncated subset.
    const extra = db.prepare(
      `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
       VALUES ('lotto', 11, '2021-02-16', 34, 35, 36, 46, 47, 48, @mask, 'manual', @createdAt)`
    );
    extra.run({ mask: maskFromNumbers([34, 35, 36, 46, 47, 48]), createdAt: Date.now() });
    invalidateCache();

    const res = await request(app).get('/api/draws/11');
    expect(res.status).toBe(200);
    expect(res.body.nearestNeighbor).toMatchObject({ drawNumber: 10, shared: 3 });
    expect(res.body.nearestNeighbor.sharedNumbers.sort((a, b) => a - b)).toEqual([34, 35, 36]);
  });

  it('draw 3: nearestNeighbor tie between draw 1 and draw 2 (both share 3) resolves to draw 2 (newer)', async () => {
    const res = await request(app).get('/api/draws/3');
    expect(res.status).toBe(200);
    expect(res.body.nearestNeighbor).toMatchObject({ drawNumber: 2, shared: 3 });
    expect(res.body.nearestNeighbor.sharedNumbers.sort((a, b) => a - b)).toEqual([7, 8, 9]);
  });

  it('draw 5: deja-vu of draw 1; chips computed excluding draw 5 itself', async () => {
    const res = await request(app).get('/api/draws/5');
    expect(res.status).toBe(200);
    expect(res.body.verdict).toEqual({ type: 'dejavu', priorDrawNumber: 1, priorDate: '2020-01-05' });

    const chipByNumber = Object.fromEntries(res.body.chips.map((c) => [c.number, c]));
    expect(chipByNumber[1]).toEqual({ number: 1, countBefore: 3, lastSeenBefore: { drawNumber: 4, date: '2020-01-15' } });
    expect(chipByNumber[2]).toEqual({ number: 2, countBefore: 2, lastSeenBefore: { drawNumber: 3, date: '2020-01-12' } });
    expect(chipByNumber[3]).toEqual({ number: 3, countBefore: 2, lastSeenBefore: { drawNumber: 3, date: '2020-01-12' } });
    expect(chipByNumber[4]).toEqual({ number: 4, countBefore: 1, lastSeenBefore: { drawNumber: 1, date: '2020-01-05' } });
    expect(chipByNumber[5]).toEqual({ number: 5, countBefore: 1, lastSeenBefore: { drawNumber: 1, date: '2020-01-05' } });
    expect(chipByNumber[6]).toEqual({ number: 6, countBefore: 1, lastSeenBefore: { drawNumber: 1, date: '2020-01-05' } });

    // deja-vu implies a perfect (shared=6) neighbor; draw 1 is the only earlier occurrence at this point.
    expect(res.body.nearestNeighbor).toMatchObject({ drawNumber: 1, shared: 6 });
    expect(res.body.nearestNeighbor.sharedNumbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('draw 6: deja-vu references the MOST RECENT prior occurrence (draw 5), not the first (draw 1)', async () => {
    const res = await request(app).get('/api/draws/6');
    expect(res.status).toBe(200);
    expect(res.body.verdict).toEqual({ type: 'dejavu', priorDrawNumber: 5, priorDate: '2020-01-19' });
    // nearestNeighbor: draw 1 and draw 5 tie at shared=6 -> newer (draw 5) wins.
    expect(res.body.nearestNeighbor).toMatchObject({ drawNumber: 5, shared: 6 });
  });

  it('draw 10 (last draw): next=null, prev=draw 9', async () => {
    const res = await request(app).get('/api/draws/10');
    expect(res.status).toBe(200);
    expect(res.body.next).toBeNull();
    expect(res.body.prev).toEqual({ drawNumber: 9, date: '2021-02-09' });
    expect(res.body.verdict).toEqual({ type: 'premiera' });
  });

  it('404 for a well-formed but non-existent draw number', async () => {
    const res = await request(app).get('/api/draws/9999');
    expect(res.status).toBe(404);
  });

  it('400 for a non-numeric draw number', async () => {
    const res = await request(app).get('/api/draws/abc');
    expect(res.status).toBe(400);
  });

  it('400 for draw number 0 or negative', async () => {
    expect((await request(app).get('/api/draws/0')).status).toBe(400);
    expect((await request(app).get('/api/draws/-5')).status).toBe(400);
  });
});

describe('GET /api/draws/latest', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    seed(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns draw 10 (the highest draw_number) with the same hero field set plus nextDraw', async () => {
    const res = await request(app).get('/api/draws/latest');
    expect(res.status).toBe(200);
    expect(res.body.drawNumber).toBe(10);
    expect(res.body.date).toBe('2021-02-12');
    expect(res.body.numbers).toEqual([32, 33, 34, 35, 36, 37]);
    expect(res.body.verdict).toEqual({ type: 'premiera' });
    expect(res.body.chips).toHaveLength(6);
    expect(res.body.nearestNeighbor).not.toBeNull();

    expect(res.body.nextDraw.drawNumber).toBe(11);
    const nextDrawDate = new Date(res.body.nextDraw.date);
    expect(nextDrawDate.getTime()).toBeGreaterThan(Date.now());

    // /latest has no prev/next archive-navigation fields (that's the :nr detail's job).
    expect(res.body.prev).toBeUndefined();
    expect(res.body.next).toBeUndefined();
  });

  it('recomputes nextDraw live per request instead of freezing it in the cache', async () => {
    // Inject the clock so we can advance time across draw slots without importing
    // anything (which would invalidate the cache and mask the bug).
    let clock = new Date('2026-07-24T07:08:00.000Z'); // a Friday, the day after a Thursday draw
    const liveApp = express();
    liveApp.get('/api/draws/latest', latestDrawHandler(db, { now: () => clock }));

    const friday = await request(liveApp).get('/api/draws/latest');
    expect(friday.status).toBe(200);
    // nextDraw must be in the future relative to "now", never a past slot.
    expect(new Date(friday.body.nextDraw.date).getTime()).toBeGreaterThan(clock.getTime());

    // Advance several days past more draws — the cache still holds the same draw
    // payload, but nextDraw must have moved forward with the clock.
    clock = new Date('2026-07-28T21:00:00.000Z'); // the following Tuesday, after that day's draw
    const tuesday = await request(liveApp).get('/api/draws/latest');
    expect(new Date(tuesday.body.nextDraw.date).getTime()).toBeGreaterThan(clock.getTime());

    expect(tuesday.body.nextDraw.date).not.toBe(friday.body.nextDraw.date);
    // The cached (non-time) payload stayed identical across both requests.
    expect(tuesday.body.drawNumber).toBe(friday.body.drawNumber);
    expect(tuesday.body.nextDraw.drawNumber).toBe(friday.body.nextDraw.drawNumber);
  });

  it('404 when the database has no draws at all', async () => {
    const emptyDb = openDatabase(':memory:');
    const emptyApp = createApp(emptyDb);
    const res = await request(emptyApp).get('/api/draws/latest');
    expect(res.status).toBe(404);
    emptyDb.close();
  });
});

describe('GET /api/draws (archive, paginated + filtered)', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    seed(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it('defaults: newest first, full total', async () => {
    const res = await request(app).get('/api/draws');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.draws[0].drawNumber).toBe(10);
    expect(res.body.draws.at(-1).drawNumber).toBeLessThan(res.body.draws[0].drawNumber);
  });

  it('pagination: page 1..4 of perPage=3 partitions all 10 draws newest-first, page 5 is empty', async () => {
    const page1 = await request(app).get('/api/draws?page=1&perPage=3');
    expect(page1.body.draws.map((d) => d.drawNumber)).toEqual([10, 9, 8]);
    expect(page1.body.totalPages).toBe(4);

    const page2 = await request(app).get('/api/draws?page=2&perPage=3');
    expect(page2.body.draws.map((d) => d.drawNumber)).toEqual([7, 6, 5]);

    const page4 = await request(app).get('/api/draws?page=4&perPage=3');
    expect(page4.body.draws.map((d) => d.drawNumber)).toEqual([1]);

    const page5 = await request(app).get('/api/draws?page=5&perPage=3');
    expect(page5.status).toBe(200);
    expect(page5.body.draws).toEqual([]);
    expect(page5.body.total).toBe(10);
  });

  it('year filter: 2020 -> 6 draws, 2021 -> 4 draws', async () => {
    const y2020 = await request(app).get('/api/draws?year=2020');
    expect(y2020.body.total).toBe(6);
    expect(y2020.body.draws.map((d) => d.drawNumber).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);

    const y2021 = await request(app).get('/api/draws?year=2021');
    expect(y2021.body.total).toBe(4);
  });

  it('contains filter (AND across all given numbers): contains=1,2 matches draws 1,3,5,6 only', async () => {
    const res = await request(app).get('/api/draws?contains=1,2');
    expect(res.body.total).toBe(4);
    expect(res.body.draws.map((d) => d.drawNumber).sort((a, b) => a - b)).toEqual([1, 3, 5, 6]);
  });

  it('contains filter de-dupes repeated numbers instead of corrupting the mask (contains=1,1 behaves like contains=1)', async () => {
    const deduped = await request(app).get('/api/draws?contains=1,1');
    const plain = await request(app).get('/api/draws?contains=1');
    expect(deduped.body.total).toBe(plain.body.total);
    expect(deduped.body.draws.map((d) => d.drawNumber)).toEqual(plain.body.draws.map((d) => d.drawNumber));
  });

  it('number filter: exact draw_number match', async () => {
    const res = await request(app).get('/api/draws?number=3');
    expect(res.body.total).toBe(1);
    expect(res.body.draws[0].drawNumber).toBe(3);
  });

  it('400 for invalid page/perPage/year/contains/number', async () => {
    expect((await request(app).get('/api/draws?page=0')).status).toBe(400);
    expect((await request(app).get('/api/draws?page=abc')).status).toBe(400);
    expect((await request(app).get('/api/draws?perPage=0')).status).toBe(400);
    expect((await request(app).get('/api/draws?perPage=10000')).status).toBe(400);
    expect((await request(app).get('/api/draws?year=abc')).status).toBe(400);
    expect((await request(app).get('/api/draws?year=99')).status).toBe(400);
    expect((await request(app).get('/api/draws?contains=1,50')).status).toBe(400);
    expect((await request(app).get('/api/draws?contains=x')).status).toBe(400);
    expect((await request(app).get('/api/draws?number=-1')).status).toBe(400);
    expect((await request(app).get('/api/draws?number=abc')).status).toBe(400);
  });
});

describe('GET /api/draws — cache invalidation wiring', () => {
  it('a new draw is visible after rebuildStats (which invalidates the cache), not stuck on the first cached response', async () => {
    const { rebuildStats } = await import('../src/server/lib/rebuild-stats.js');
    invalidateCache();
    const db = openDatabase(':memory:');
    seed(db);
    const app = createApp(db);

    const before = await request(app).get('/api/draws/latest');
    expect(before.body.drawNumber).toBe(10);

    db.prepare(
      `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
       VALUES ('lotto', 11, '2021-02-16', 40, 41, 42, 43, 44, 45, @mask, 'manual', @createdAt)`
    ).run({ mask: maskFromNumbers([40, 41, 42, 43, 44, 45]), createdAt: Date.now() });
    rebuildStats(db);

    const after = await request(app).get('/api/draws/latest');
    expect(after.body.drawNumber).toBe(11);

    db.close();
  });
});
