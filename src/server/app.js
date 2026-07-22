import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestDrawHandler, drawDetailHandler, drawsListHandler } from './draws.js';
import { blanketStatsHandler, rankingsStatsHandler, gapsStatsHandler } from './stats.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(MODULE_DIR, '..', '..', 'dist');

export function createApp(db) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM draw').get();
    res.json({ ok: true, draws: count });
  });

  // /draws/latest must be registered before the /draws/:nr param route, or Express
  // would try to parse "latest" as a draw number and 400 it.
  app.get('/api/draws/latest', latestDrawHandler(db));
  app.get('/api/draws/:nr', drawDetailHandler(db));
  app.get('/api/draws', drawsListHandler(db));

  app.get('/api/stats/blanket', blanketStatsHandler(db));
  app.get('/api/stats/rankings', rankingsStatsHandler(db));
  app.get('/api/stats/gaps', gapsStatsHandler(db));

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(join(DIST_DIR, 'index.html'));
    });
  }

  return app;
}
