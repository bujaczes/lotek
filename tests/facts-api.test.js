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
      n1: d.numbers[0], n2: d.numbers[1], n3: d.numbers[2],
      n4: d.numbers[3], n5: d.numbers[4], n6: d.numbers[5],
      mask: maskFromNumbers(d.numbers),
      createdAt: Date.now(),
    });
  }
}

describe('GET /api/facts/latest', () => {
  let db;
  let app;

  beforeEach(() => {
    invalidateCache();
    db = openDatabase(':memory:');
    app = createApp(db);
  });

  afterEach(() => db.close());

  it('returns { fact: null } when there are no draws', async () => {
    const res = await request(app).get('/api/facts/latest');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fact: null });
  });

  it('returns a { type, text } fact for the latest draw', async () => {
    insertDraws(db, [
      { drawNumber: 1, drawnAt: '2020-01-01', numbers: [1, 2, 3, 4, 5, 6] },
      { drawNumber: 2, drawnAt: '2020-01-04', numbers: [44, 45, 46, 47, 48, 49] },
    ]);
    const res = await request(app).get('/api/facts/latest');
    expect(res.status).toBe(200);
    expect(res.body.fact.type).toBe('sum_record'); // 279 is a new all-time max
    expect(typeof res.body.fact.text).toBe('string');
    expect(res.body.fact.text.length).toBeGreaterThan(0);
  });

  it('recomputes after the cache is invalidated by a new import', async () => {
    insertDraws(db, [{ drawNumber: 1, drawnAt: '2020-01-01', numbers: [3, 17, 22, 31, 38, 44] }]);
    const first = await request(app).get('/api/facts/latest');
    expect(first.body.fact.text).toContain('nr 1');

    insertDraws(db, [{ drawNumber: 2, drawnAt: '2020-01-04', numbers: [1, 2, 3, 4, 5, 6] }]);
    invalidateCache(); // rebuildStats does this after every real import
    const second = await request(app).get('/api/facts/latest');
    expect(second.body.fact.text).toContain('nr 2');
  });
});
