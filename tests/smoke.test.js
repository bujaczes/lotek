import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.js';
import { openDatabase } from '../db/index.js';

describe('GET /api/health', () => {
  it('responds ok with the current draw count', async () => {
    const db = openDatabase(':memory:');
    const app = createApp(db);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, draws: 0 });

    db.close();
  });
});
