import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../db/index.js';
import { createApp } from '../src/server/app.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';
import { invalidateCache } from '../src/server/lib/cache.js';

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

// User picks {1, 2, 3, 33, 34, 46} -- deliberately includes numbers >=32 (bit positions
// 32-48, outside JS's native 32-bit `&` range) to guard against the mask-truncation bug
// class already found and fixed in Task 6 (nearestNeighbor.sharedNumbers).
const USER_NUMBERS = [1, 2, 3, 33, 34, 46];

// Hand-designed 6-draw history with hits computed by explicit set-intersection below:
const DRAWS = [
  // draw 1: {1,2,3,33,34,46} -- all 6 match -> hits=6
  { drawNumber: 1, drawnAt: '1957-01-27', numbers: [1, 2, 3, 33, 34, 46] },
  // draw 2: {1,2,3,4,5,6} -- shares {1,2,3} -> hits=3
  { drawNumber: 2, drawnAt: '1957-02-03', numbers: [1, 2, 3, 4, 5, 6] },
  // draw 3: {1,2,33,34,40,41} -- shares {1,2,33,34} -> hits=4
  { drawNumber: 3, drawnAt: '1957-02-10', numbers: [1, 2, 33, 34, 40, 41] },
  // draw 4: {1,2,3,33,40,41} -- shares {1,2,3,33} -> hits=4
  { drawNumber: 4, drawnAt: '1957-02-17', numbers: [1, 2, 3, 33, 40, 41] },
  // draw 5: {7,8,9,10,11,12} -- shares nothing -> hits=0
  { drawNumber: 5, drawnAt: '1957-02-24', numbers: [7, 8, 9, 10, 11, 12] },
  // draw 6: {1,2,3,33,34,47} -- shares {1,2,3,33,34} -> hits=5
  { drawNumber: 6, drawnAt: '1957-03-03', numbers: [1, 2, 3, 33, 34, 47] },
];

describe('POST /api/wehikul', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    insertDraws(db, DRAWS);
    app = createApp(db);
  });

  afterEach(() => db.close());

  it('computes hits per draw correctly for numbers >=33 (mask-safety regression)', async () => {
    const res = await request(app).post('/api/wehikul').send({ numbers: USER_NUMBERS });
    expect(res.status).toBe(200);
    expect(res.body.hits).toEqual({ 3: 1, 4: 2, 5: 1, 6: 1 }); // draw2=3, draw3&4=4, draw6=5, draw1=6
  });

  it('occurrences list every draw with hits>=3, in chronological order, each with drawNumber/date/hits', async () => {
    const res = await request(app).post('/api/wehikul').send({ numbers: USER_NUMBERS });
    expect(res.body.occurrences).toEqual([
      { drawNumber: 1, date: '1957-01-27', hits: 6 },
      { drawNumber: 2, date: '1957-02-03', hits: 3 },
      { drawNumber: 3, date: '1957-02-10', hits: 4 },
      { drawNumber: 4, date: '1957-02-17', hits: 4 },
      { drawNumber: 6, date: '1957-03-03', hits: 5 },
    ]);
  });

  it('balance: drawsPlayed=6, cost=6*3.00=18.00, winnings=24+200+200+6000+2000000=2006424, net=winnings-cost', async () => {
    const res = await request(app).post('/api/wehikul').send({ numbers: USER_NUMBERS });
    const { balance } = res.body;
    expect(balance.drawsPlayed).toBe(6);
    expect(balance.cost).toBeCloseTo(18.0, 10);
    // hits: draw2=3(24), draw3=4(200), draw4=4(200), draw6=5(6000), draw1=6(2000000)
    const expectedWinnings = 24 + 200 + 200 + 6000 + 2000000;
    expect(balance.winnings).toBe(expectedWinnings);
    expect(balance.net).toBeCloseTo(expectedWinnings - 18.0, 10);
  });

  it('echoes the configured stakes so the UI can spell out what the balance assumes', async () => {
    const res = await request(app).post('/api/wehikul').send({ numbers: USER_NUMBERS });
    expect(res.body.prizes).toEqual({ 3: 24, 4: 200, 5: 6000, 6: 2000000, betPrice: 3.0 });
  });

  it('includes a Polish disclaimer mentioning "szacunek edukacyjny"', async () => {
    const res = await request(app).post('/api/wehikul').send({ numbers: USER_NUMBERS });
    expect(res.body.disclaimer).toMatch(/szacunek edukacyjny/i);
  });

  it('numbers with 0 hits>=3 give empty occurrences and all-zero hits, but balance is still computed', async () => {
    const res = await request(app).post('/api/wehikul').send({ numbers: [40, 41, 42, 43, 44, 45] });
    expect(res.body.hits).toEqual({ 3: 0, 4: 0, 5: 0, 6: 0 });
    expect(res.body.occurrences).toEqual([]);
    expect(res.body.balance.winnings).toBe(0);
    expect(res.body.balance.drawsPlayed).toBe(6);
  });

  describe('validation (400 on malformed input)', () => {
    const cases = [
      ['wrong count (5 numbers)', { numbers: [1, 2, 3, 4, 5] }],
      ['wrong count (7 numbers)', { numbers: [1, 2, 3, 4, 5, 6, 7] }],
      ['duplicate numbers', { numbers: [1, 1, 2, 3, 4, 5] }],
      ['out of range (0)', { numbers: [0, 2, 3, 4, 5, 6] }],
      ['out of range (50)', { numbers: [1, 2, 3, 4, 5, 50] }],
      ['non-numeric entries (strings)', { numbers: ['1', '2', '3', '4', '5', '6'] }],
      ['non-numeric entries (mixed)', { numbers: [1, 2, 3, 4, 5, 'six'] }],
      ['non-integer (float)', { numbers: [1.5, 2, 3, 4, 5, 6] }],
      ['missing numbers field', {}],
      ['numbers not an array', { numbers: 'not-an-array' }],
      ['null numbers', { numbers: null }],
      ['empty body', undefined],
    ];

    for (const [label, body] of cases) {
      it(`rejects: ${label}`, async () => {
        const req = request(app).post('/api/wehikul');
        const res = body === undefined ? await req.send() : await req.send(body);
        expect(res.status).toBe(400);
      });
    }
  });
});
