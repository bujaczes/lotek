import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../db/index.js';
import { createApp } from '../src/server/app.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { invalidateCache } from '../src/server/lib/cache.js';
import { rebuildStats, computePairStats } from '../src/server/lib/rebuild-stats.js';
import { computeTripleStats } from '../src/server/lib/triple-stats.js';
import { C, P_CONSECUTIVE, P_REPEAT_PREV, evenOddDist, lowHighDist } from '../src/server/lib/theory.js';

function insertDraws(db, draws) {
  const insert = db.prepare(
    `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
     VALUES ('lotto', @drawNumber, @drawnAt, @n1, @n2, @n3, @n4, @n5, @n6, @mask, 'manual', @createdAt)`
  );
  for (const d of draws) {
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

function seedApp(draws) {
  invalidateCache();
  const db = openDatabase(':memory:');
  insertDraws(db, draws);
  rebuildStats(db);
  const app = createApp(db);
  return { db, app };
}

// ---------------------------------------------------------------------------------------
// Fixture A: 6 draws with hand-derivable consecutive/repeats/structure properties. See
// inline per-draw annotations; the full derivation is repeated in each describe block that
// uses a specific field, so each test is self-explanatory without needing to jump around.
// ---------------------------------------------------------------------------------------
const FIXTURE_A = [
  { drawNumber: 1, drawnAt: '2020-01-01', numbers: [1, 2, 3, 4, 5, 6] }, // sum 21, all consecutive, all low
  { drawNumber: 2, drawnAt: '2020-01-04', numbers: [1, 2, 3, 4, 5, 7] }, // sum 22, consecutive (1-5), shares {1..5} with #1
  { drawNumber: 3, drawnAt: '2020-01-08', numbers: [7, 20, 30, 40, 44, 49] }, // sum 190, no consecutive pair, shares {7} with #2
  { drawNumber: 4, drawnAt: '2020-01-11', numbers: [10, 20, 30, 40, 45, 49] }, // sum 194, no consecutive, shares {20,30,40,49} with #3
  { drawNumber: 5, drawnAt: '2020-01-15', numbers: [5, 6, 12, 38, 41, 43] }, // sum 145, consecutive (5,6), shares nothing with #4
  { drawNumber: 6, drawnAt: '2020-01-18', numbers: [1, 3, 5, 25, 27, 29] }, // sum 90, no consecutive, shares {5} with #5
];

describe('GET /api/stats/consecutive', () => {
  let db, app;
  beforeEach(() => ({ db, app } = seedApp(FIXTURE_A)));
  afterEach(() => db.close());

  it('empiricalShare = 3/6 (draws 1,2,5 contain an adjacent pair; 3,4,6 do not), theoretical = P_CONSECUTIVE', async () => {
    const res = await request(app).get('/api/stats/consecutive');
    expect(res.status).toBe(200);
    expect(res.body.empiricalShare).toBeCloseTo(3 / 6, 12);
    expect(res.body.theoretical).toBeCloseTo(P_CONSECUTIVE, 12);
    expect(res.body.draws).toBe(6);
  });
});

describe('GET /api/stats/repeats', () => {
  let db, app;
  beforeEach(() => ({ db, app } = seedApp(FIXTURE_A)));
  afterEach(() => db.close());

  it('empiricalShare = 4/5 (draws 2,3,4,6 share >=1 number with their immediate predecessor; draw 5 does not), theoretical = P_REPEAT_PREV', async () => {
    const res = await request(app).get('/api/stats/repeats');
    expect(res.status).toBe(200);
    expect(res.body.empiricalShare).toBeCloseTo(4 / 5, 12);
    expect(res.body.theoretical).toBeCloseTo(P_REPEAT_PREV, 12);
  });
});

describe('GET /api/stats/structure', () => {
  let db, app;
  beforeEach(() => ({ db, app } = seedApp(FIXTURE_A)));
  afterEach(() => db.close());

  it('even histogram: k=0->1(#6), k=2->1(#2... wait see below), matches hand-derived per-draw even counts', async () => {
    // per-draw even counts: #1={1,2,3,4,5,6}->3, #2={1,2,3,4,5,7}->2, #3={7,20,30,40,44,49}->4,
    // #4={10,20,30,40,45,49}->4, #5={5,6,12,38,41,43}->3, #6={1,3,5,25,27,29}->0
    const res = await request(app).get('/api/stats/structure');
    expect(res.status).toBe(200);
    const byK = Object.fromEntries(res.body.even.map((r) => [r.k, r]));
    expect(byK[0].empiricalCount).toBe(1); // #6
    expect(byK[2].empiricalCount).toBe(1); // #2
    expect(byK[3].empiricalCount).toBe(2); // #1, #5
    expect(byK[4].empiricalCount).toBe(2); // #3, #4
    expect(byK[1].empiricalCount).toBe(0);
    expect(byK[5].empiricalCount).toBe(0);
    expect(byK[6].empiricalCount).toBe(0);
    const totalShare = res.body.even.reduce((s, r) => s + r.empiricalShare, 0);
    expect(totalShare).toBeCloseTo(1, 12);
  });

  it('low(<=24) histogram: k=2->2(#3,#4), k=3->2(#5,#6), k=6->2(#1,#2)', async () => {
    const res = await request(app).get('/api/stats/structure');
    const byK = Object.fromEntries(res.body.low.map((r) => [r.k, r]));
    expect(byK[2].empiricalCount).toBe(2);
    expect(byK[3].empiricalCount).toBe(2);
    expect(byK[6].empiricalCount).toBe(2);
    expect(byK[0].empiricalCount + byK[1].empiricalCount + byK[4].empiricalCount + byK[5].empiricalCount).toBe(0);
  });

  it('theoretical field matches theory.evenOddDist()/lowHighDist() exactly', async () => {
    const res = await request(app).get('/api/stats/structure');
    const evenTheory = evenOddDist();
    const lowTheory = lowHighDist();
    for (const row of res.body.even) {
      expect(row.theoretical).toBeCloseTo(evenTheory.find((r) => r.evens === row.k).probability, 15);
    }
    for (const row of res.body.low) {
      expect(row.theoretical).toBeCloseTo(lowTheory.find((r) => r.low === row.k).probability, 15);
    }
  });
});

describe('GET /api/stats/sums — typical sector (50th percentile)', () => {
  let db, app;
  beforeEach(() => ({ db, app } = seedApp(FIXTURE_A)));
  afterEach(() => db.close());

  it('lastSum=90 (draw 6), percentile=count(sum<=90)/6=50%, sector="typowy"', async () => {
    const res = await request(app).get('/api/stats/sums');
    expect(res.status).toBe(200);
    expect(res.body.lastSum).toBe(90);
    expect(res.body.percentile).toBeCloseTo(50, 6);
    expect(res.body.sector).toBe('typowy');
  });

  it('histogram covers 21..279 zero-filled, matching the fixture sums exactly', async () => {
    const res = await request(app).get('/api/stats/sums');
    expect(res.body.histogram).toHaveLength(279 - 21 + 1);
    const byS = Object.fromEntries(res.body.histogram.map((r) => [r.sum, r.count]));
    expect(byS[21]).toBe(1);
    expect(byS[22]).toBe(1);
    expect(byS[190]).toBe(1);
    expect(byS[194]).toBe(1);
    expect(byS[145]).toBe(1);
    expect(byS[90]).toBe(1);
    const total = res.body.histogram.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(6);
  });

  it('theoretical curve sums to ~N (6) over its full domain', async () => {
    const res = await request(app).get('/api/stats/sums');
    expect(res.body.theoretical).toHaveLength(279 - 21 + 1);
    const total = res.body.theoretical.reduce((s, r) => s + r.expected, 0);
    expect(total).toBeCloseTo(6, 6);
  });
});

describe('GET /api/stats/sums — extreme sectors (wysoki/niski)', () => {
  it('last draw sum=279, 100th percentile -> sector "wysoki"', async () => {
    const draws = [
      { drawNumber: 1, drawnAt: '2020-01-01', numbers: [15, 45, 46, 47, 48, 49] }, // sum 250
      { drawNumber: 2, drawnAt: '2020-01-04', numbers: [1, 29, 46, 47, 48, 49] }, // sum 220
      { drawNumber: 3, drawnAt: '2020-01-08', numbers: [1, 2, 43, 47, 48, 49] }, // sum 190
      { drawNumber: 4, drawnAt: '2020-01-11', numbers: [1, 2, 3, 4, 5, 6] }, // sum 21
      { drawNumber: 5, drawnAt: '2020-01-15', numbers: [44, 45, 46, 47, 48, 49] }, // sum 279 (last)
    ];
    const { db, app } = seedApp(draws);
    const res = await request(app).get('/api/stats/sums');
    expect(res.body.lastSum).toBe(279);
    expect(res.body.percentile).toBeCloseTo(100, 6);
    expect(res.body.sector).toBe('wysoki');
    db.close();
  });

  it('last draw sum=21, 20th percentile -> sector "niski"', async () => {
    const draws = [
      { drawNumber: 1, drawnAt: '2020-01-01', numbers: [44, 45, 46, 47, 48, 49] }, // sum 279
      { drawNumber: 2, drawnAt: '2020-01-04', numbers: [15, 45, 46, 47, 48, 49] }, // sum 250
      { drawNumber: 3, drawnAt: '2020-01-08', numbers: [1, 29, 46, 47, 48, 49] }, // sum 220
      { drawNumber: 4, drawnAt: '2020-01-11', numbers: [1, 2, 43, 47, 48, 49] }, // sum 190
      { drawNumber: 5, drawnAt: '2020-01-15', numbers: [1, 2, 3, 4, 5, 6] }, // sum 21 (last)
    ];
    const { db, app } = seedApp(draws);
    const res = await request(app).get('/api/stats/sums');
    expect(res.body.lastSum).toBe(21);
    expect(res.body.percentile).toBeCloseTo(20, 6);
    expect(res.body.sector).toBe('niski');
    db.close();
  });
});

// ---------------------------------------------------------------------------------------
// Pairs/triples
// ---------------------------------------------------------------------------------------
const PAIR_DRAWS = [
  { drawNumber: 1, drawnAt: '2020-01-01', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 2, drawnAt: '2020-01-04', numbers: [1, 2, 7, 8, 9, 10] },
  { drawNumber: 3, drawnAt: '2020-01-08', numbers: [1, 2, 3, 11, 12, 13] },
  { drawNumber: 4, drawnAt: '2020-01-11', numbers: [1, 2, 14, 15, 16, 17] },
  { drawNumber: 5, drawnAt: '2020-01-15', numbers: [3, 4, 18, 19, 20, 21] },
];

describe('GET /api/stats/pairs', () => {
  let db, app;
  beforeEach(() => ({ db, app } = seedApp(PAIR_DRAWS)));
  afterEach(() => db.close());

  it('pairs: exactly 15 rows, sorted desc by cnt, top is (1,2) with cnt=4 (appears in draws 1-4)', async () => {
    const res = await request(app).get('/api/stats/pairs');
    expect(res.status).toBe(200);
    expect(res.body.pairs).toHaveLength(15);
    expect(res.body.pairs[0]).toMatchObject({ a: 1, b: 2, cnt: 4 });
    for (let i = 1; i < res.body.pairs.length; i++) {
      expect(res.body.pairs[i - 1].cnt).toBeGreaterThanOrEqual(res.body.pairs[i].cnt);
    }
  });

  it('pairs matches computePairStats(draws) top 15 exactly (handler is a faithful passthrough of pair_stat)', async () => {
    const res = await request(app).get('/api/stats/pairs');
    const allPairs = computePairStats(PAIR_DRAWS);
    const expectedTop15 = [...allPairs]
      .sort((r1, r2) => r2.cnt - r1.cnt || r1.a - r2.a || r1.b - r2.b)
      .slice(0, 15);
    expect(res.body.pairs).toEqual(expectedTop15);
  });

  it('triples: top triple is (1,2,3) with cnt=2 (only draws 1 and 3 share all three)', async () => {
    const res = await request(app).get('/api/stats/pairs');
    expect(res.body.triples[0]).toMatchObject({ numbers: [1, 2, 3], cnt: 2 });
    expect(res.body.triples.length).toBeLessThanOrEqual(15);
  });

  it('triples matches computeTripleStats(draws, {top:15}) exactly', async () => {
    const res = await request(app).get('/api/stats/pairs');
    expect(res.body.triples).toEqual(computeTripleStats(PAIR_DRAWS, { top: 15 }));
  });
});

// ---------------------------------------------------------------------------------------
// Duplicate sixes
// ---------------------------------------------------------------------------------------
const DUP_DRAWS = [
  { drawNumber: 1, drawnAt: '2020-01-01', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 2, drawnAt: '2020-01-04', numbers: [7, 8, 9, 10, 11, 12] },
  { drawNumber: 3, drawnAt: '2020-01-08', numbers: [1, 2, 3, 4, 5, 6] }, // repeat of #1
  { drawNumber: 4, drawnAt: '2020-01-11', numbers: [13, 14, 15, 16, 17, 18] },
  { drawNumber: 5, drawnAt: '2020-01-15', numbers: [7, 8, 9, 10, 11, 12] }, // repeat of #2
  { drawNumber: 6, drawnAt: '2020-01-18', numbers: [7, 8, 9, 10, 11, 12] }, // 3rd occurrence of #2's mask
];

describe('GET /api/stats/duplicate-sixes', () => {
  let db, app;
  beforeEach(() => ({ db, app } = seedApp(DUP_DRAWS)));
  afterEach(() => db.close());

  it('finds exactly 2 groups: {7,8,9,10,11,12} x3 and {1,2,3,4,5,6} x2, sorted by occurrence count desc', async () => {
    const res = await request(app).get('/api/stats/duplicate-sixes');
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(2);

    expect(res.body.groups[0].numbers).toEqual([7, 8, 9, 10, 11, 12]);
    expect(res.body.groups[0].occurrences).toEqual([
      { drawNumber: 2, date: '2020-01-04' },
      { drawNumber: 5, date: '2020-01-15' },
      { drawNumber: 6, date: '2020-01-18' },
    ]);

    expect(res.body.groups[1].numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(res.body.groups[1].occurrences).toEqual([
      { drawNumber: 1, date: '2020-01-01' },
      { drawNumber: 3, date: '2020-01-08' },
    ]);
  });

  it('expectedCollisions = C(6,2)/13983816', async () => {
    const res = await request(app).get('/api/stats/duplicate-sixes');
    expect(res.body.expectedCollisions).toBeCloseTo(C(6, 2) / 13983816, 15);
  });

  it('no duplicates in a fixture with all-distinct masks -> empty groups', async () => {
    const distinct = { db: openDatabase(':memory:') };
    invalidateCache();
    insertDraws(distinct.db, [
      { drawNumber: 1, drawnAt: '2020-01-01', numbers: [1, 2, 3, 4, 5, 6] },
      { drawNumber: 2, drawnAt: '2020-01-04', numbers: [7, 8, 9, 10, 11, 12] },
    ]);
    rebuildStats(distinct.db);
    const distinctApp = createApp(distinct.db);
    const res = await request(distinctApp).get('/api/stats/duplicate-sixes');
    expect(res.body.groups).toEqual([]);
    distinct.db.close();
  });
});

// ---------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------
const RECORDS_DRAWS = [
  { drawNumber: 1, drawnAt: '2020-01-01', numbers: [1, 2, 3, 4, 5, 6] }, // sum 21 (MIN), run length 6 (MAX run)
  { drawNumber: 2, drawnAt: '2020-01-04', numbers: [10, 20, 30, 31, 32, 40] }, // sum 163, run 3, has <=10 (10)
  { drawNumber: 3, drawnAt: '2020-01-08', numbers: [7, 8, 9, 25, 26, 49] }, // sum 124, run 3, has <=10
  { drawNumber: 4, drawnAt: '2020-01-11', numbers: [15, 16, 17, 18, 44, 45] }, // sum 155, run 4, no <=10 [drought starts]
  { drawNumber: 5, drawnAt: '2020-01-15', numbers: [20, 30, 35, 44, 47, 49] }, // sum 225 (MAX), run 1, no <=10
  { drawNumber: 6, drawnAt: '2020-01-18', numbers: [15, 22, 33, 41, 47, 49] }, // sum 207, run 1, no <=10
  { drawNumber: 7, drawnAt: '2020-01-22', numbers: [11, 23, 35, 40, 45, 48] }, // sum 202, run 1, no <=10 [drought: draws 4-7, length 4]
  { drawNumber: 8, drawnAt: '2020-01-26', numbers: [3, 5, 9, 10, 44, 46] }, // sum 117, run 2, has <=10 [drought breaks]
  { drawNumber: 9, drawnAt: '2020-01-29', numbers: [12, 18, 25, 31, 38, 49] }, // sum 173, run 1, no <=10
  { drawNumber: 10, drawnAt: '2020-02-02', numbers: [13, 19, 26, 32, 39, 44] }, // sum 173, run 1, no <=10
  { drawNumber: 11, drawnAt: '2020-02-05', numbers: [14, 21, 27, 33, 40, 45] }, // sum 180 (LAST), run 1, no <=10 [drought: draws 9-11, length 3]
];

describe('GET /api/stats/records', () => {
  let db, app;
  beforeEach(() => ({ db, app } = seedApp(RECORDS_DRAWS)));
  afterEach(() => db.close());

  it('maxSum=225 (draw 5), minSum=21 (draw 1)', async () => {
    const res = await request(app).get('/api/stats/records');
    expect(res.status).toBe(200);
    expect(res.body.maxSum.value).toBe(225);
    expect(res.body.maxSum.draws.map((d) => d.drawNumber)).toEqual([5]);
    expect(res.body.minSum.value).toBe(21);
    expect(res.body.minSum.draws.map((d) => d.drawNumber)).toEqual([1]);
  });

  it('longestRun.length=6 on draw 1 (the full 1-2-3-4-5-6 run)', async () => {
    const res = await request(app).get('/api/stats/records');
    expect(res.body.longestRun.length).toBe(6);
    expect(res.body.longestRun.draws.map((d) => d.drawNumber)).toEqual([1]);
  });

  it('longestDrought.length=4, spanning draws 4-7 (the longest streak with no number 1-10)', async () => {
    const res = await request(app).get('/api/stats/records');
    expect(res.body.longestDrought.length).toBe(4);
    expect(res.body.longestDrought.from).toEqual({ drawNumber: 4, date: '2020-01-11' });
    expect(res.body.longestDrought.to).toEqual({ drawNumber: 7, date: '2020-01-22' });
  });

  it('birthdayness: last draw (11) = {14,21,27,33,40,45} has 3 numbers <=31, share=0.5, theoretical=31/49', async () => {
    const res = await request(app).get('/api/stats/records');
    expect(res.body.birthdayness.lastDrawNumber).toBe(11);
    expect(res.body.birthdayness.count).toBe(3);
    expect(res.body.birthdayness.share).toBeCloseTo(0.5, 12);
    expect(res.body.birthdayness.theoretical).toBeCloseTo(31 / 49, 12);
  });

  it('recordAbsence is present with a number/gap/type shape', async () => {
    const res = await request(app).get('/api/stats/records');
    expect(typeof res.body.recordAbsence.number).toBe('number');
    expect(typeof res.body.recordAbsence.gap).toBe('number');
    expect(['ongoing', 'historical']).toContain(res.body.recordAbsence.type);
  });
});

describe('GET /api/stats/records — recordAbsence, precise fixture (same as tests/gaps.test.js)', () => {
  // number 1: completed gaps [0,1,2] -> max_gap=2; numbers 2-6: last seen draw 1, never
  // again -> current_gap = 7-1 = 6 (tied, the fixture's overall record: 6 > any max_gap).
  // Lowest-number tie-break -> number 2.
  const GAP_DRAWS = [
    { drawNumber: 1, drawnAt: '2022-01-01', numbers: [1, 2, 3, 4, 5, 6] },
    { drawNumber: 2, drawnAt: '2022-01-04', numbers: [1, 7, 8, 9, 10, 11] },
    { drawNumber: 3, drawnAt: '2022-01-08', numbers: [12, 13, 14, 15, 16, 17] },
    { drawNumber: 4, drawnAt: '2022-01-11', numbers: [1, 18, 19, 20, 21, 22] },
    { drawNumber: 5, drawnAt: '2022-01-15', numbers: [23, 24, 25, 26, 27, 28] },
    { drawNumber: 6, drawnAt: '2022-01-18', numbers: [23, 29, 30, 31, 32, 33] },
    { drawNumber: 7, drawnAt: '2022-01-22', numbers: [1, 34, 35, 36, 37, 38] },
  ];

  let db, app;
  beforeEach(() => ({ db, app } = seedApp(GAP_DRAWS)));
  afterEach(() => db.close());

  it('recordAbsence = {number: 2, gap: 6, type: "ongoing"} — the highest gap in the fixture, ongoing not historical', async () => {
    const res = await request(app).get('/api/stats/records');
    expect(res.body.recordAbsence).toMatchObject({ number: 2, gap: 6, type: 'ongoing' });
  });
});

// ---------------------------------------------------------------------------------------
// Carpet
// ---------------------------------------------------------------------------------------
const CARPET_DRAWS = [
  { drawNumber: 1, drawnAt: '2021-01-01', numbers: [1, 2, 3, 4, 5, 6] },
  { drawNumber: 2, drawnAt: '2021-01-04', numbers: [10, 20, 30, 40, 45, 49] },
  { drawNumber: 3, drawnAt: '2021-01-08', numbers: [7, 8, 9, 11, 12, 13] },
];

describe('GET /api/stats/carpet', () => {
  let db, app;
  beforeEach(() => ({ db, app } = seedApp(CARPET_DRAWS)));
  afterEach(() => db.close());

  it('dates = 3 draw dates ascending, points = 18 [drawIndex, number] pairs in draw order', async () => {
    const res = await request(app).get('/api/stats/carpet');
    expect(res.status).toBe(200);
    expect(res.body.dates).toEqual(['2021-01-01', '2021-01-04', '2021-01-08']);
    expect(res.body.points).toHaveLength(18);
    expect(res.body.points.slice(0, 6)).toEqual([
      [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
    ]);
    expect(res.body.points.slice(6, 12)).toEqual([
      [1, 10], [1, 20], [1, 30], [1, 40], [1, 45], [1, 49],
    ]);
    expect(res.body.points.slice(12, 18)).toEqual([
      [2, 7], [2, 8], [2, 9], [2, 11], [2, 12], [2, 13],
    ]);
  });
});
