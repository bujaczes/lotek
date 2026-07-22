import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../db/index.js';
import { createApp } from '../src/server/app.js';
import { importHistory } from '../scripts/import-history.js';
import { invalidateCache } from '../src/server/lib/cache.js';
import { C, P_CONSECUTIVE, P_REPEAT_PREV } from '../src/server/lib/theory.js';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(TESTS_DIR, '..', 'data', 'fixtures', 'dl_snapshot.txt.gz');

// Full history integration test (task-7-brief item 2): the empirical values below must
// land near the CONVENTIONS anchors on the REAL ~7380-draw dataset, not just a synthetic
// fixture — this is the actual "does the math hold up on real data" check.
describe('Task 7 integration — empirical anchors on the real dl_snapshot fixture', () => {
  let db;
  let app;

  beforeAll(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    const gz = readFileSync(SNAPSHOT_PATH);
    const text = gunzipSync(gz).toString('utf8');
    importHistory(db, text); // parses, inserts, and rebuilds number_stat/pair_stat
    app = createApp(db);
  });

  afterAll(() => db.close());

  it('has at least 7380 draws (the committed snapshot baseline)', async () => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM draw').get();
    expect(count).toBeGreaterThanOrEqual(7380);
  });

  it('/api/stats/consecutive: empiricalShare within ±2 p.p. of the theoretical 49.52%', async () => {
    const res = await request(app).get('/api/stats/consecutive');
    expect(res.status).toBe(200);
    expect(res.body.theoretical).toBeCloseTo(P_CONSECUTIVE, 12);
    expect(Math.abs(res.body.empiricalShare - P_CONSECUTIVE)).toBeLessThan(0.02);
    expect(Math.abs(res.body.empiricalShare - 0.4952)).toBeLessThan(0.02);
  });

  it('/api/stats/repeats: empiricalShare within ±2 p.p. of the theoretical 56.4%', async () => {
    const res = await request(app).get('/api/stats/repeats');
    expect(res.status).toBe(200);
    expect(res.body.theoretical).toBeCloseTo(P_REPEAT_PREV, 12);
    expect(Math.abs(res.body.empiricalShare - P_REPEAT_PREV)).toBeLessThan(0.02);
    expect(Math.abs(res.body.empiricalShare - 0.564)).toBeLessThan(0.02);
  });

  it('/api/stats/sums: mean empirical sum is within 150 ± 2', async () => {
    const res = await request(app).get('/api/stats/sums');
    expect(res.status).toBe(200);
    const total = res.body.histogram.reduce((s, r) => s + r.count, 0);
    const weightedSum = res.body.histogram.reduce((s, r) => s + r.sum * r.count, 0);
    const mean = weightedSum / total;
    expect(Math.abs(mean - 150)).toBeLessThan(2);
  });

  it('/api/stats/duplicate-sixes: expectedCollisions ≈ C(7380,2)/13983816 ≈ 1.95', async () => {
    const res = await request(app).get('/api/stats/duplicate-sixes');
    expect(res.status).toBe(200);
    const { count: N } = db.prepare('SELECT COUNT(*) AS count FROM draw').get();
    const expected = C(N, 2) / 13983816;
    expect(res.body.expectedCollisions).toBeCloseTo(expected, 10);
    expect(res.body.expectedCollisions).toBeGreaterThan(1.8);
    expect(res.body.expectedCollisions).toBeLessThan(2.2);
    // Every group's numbers must actually be a 6-length array and every occurrence
    // must correspond to a real row (sanity, not just the count math).
    for (const group of res.body.groups) {
      expect(group.numbers).toHaveLength(6);
      expect(group.occurrences.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('/api/stats/pairs, /api/stats/structure, /api/stats/records, /api/stats/carpet all respond 200 with sane shapes', async () => {
    const pairs = await request(app).get('/api/stats/pairs');
    expect(pairs.status).toBe(200);
    expect(pairs.body.pairs).toHaveLength(15);
    expect(pairs.body.triples.length).toBeGreaterThan(0);
    expect(pairs.body.triples.length).toBeLessThanOrEqual(15);

    const structure = await request(app).get('/api/stats/structure');
    expect(structure.status).toBe(200);
    const evenShareSum = structure.body.even.reduce((s, r) => s + r.empiricalShare, 0);
    expect(evenShareSum).toBeCloseTo(1, 6);

    const records = await request(app).get('/api/stats/records');
    expect(records.status).toBe(200);
    expect(records.body.maxSum.value).toBeGreaterThan(records.body.minSum.value);
    expect(records.body.recordAbsence).not.toBeNull();
    expect(records.body.birthdayness.theoretical).toBeCloseTo(31 / 49, 10);

    const carpet = await request(app).get('/api/stats/carpet');
    expect(carpet.status).toBe(200);
    expect(carpet.body.dates.length).toBeGreaterThanOrEqual(7380);
    expect(carpet.body.points.length).toBe(carpet.body.dates.length * 6);
  });

  it('/api/numbers/1 and /api/wehikul (real known draw 7380 = {5,6,12,38,41,43}) respond correctly', async () => {
    const career = await request(app).get('/api/numbers/1');
    expect(career.status).toBe(200);
    expect(career.body.stats.totalCount).toBeGreaterThan(0);
    expect(career.body.zScoreSeries.length).toBeGreaterThan(70); // 7380/100 checkpoints

    const wehikul = await request(app).post('/api/wehikul').send({ numbers: [5, 6, 12, 38, 41, 43] });
    expect(wehikul.status).toBe(200);
    // this exact combination is draw 7380 itself -> hits=6 exactly once (per CONVENTIONS'
    // control fact) and drawsPlayed equals the total draw count.
    expect(wehikul.body.hits[6]).toBe(1);
    const { count: N } = db.prepare('SELECT COUNT(*) AS count FROM draw').get();
    expect(wehikul.body.balance.drawsPlayed).toBe(N);
  });
});
