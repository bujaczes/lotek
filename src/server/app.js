import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestDrawHandler, drawDetailHandler, drawsListHandler } from './draws.js';
import {
  blanketStatsHandler,
  rankingsStatsHandler,
  gapsStatsHandler,
  pairsStatsHandler,
  sumsStatsHandler,
  structureStatsHandler,
  consecutiveStatsHandler,
  repeatsStatsHandler,
  duplicateSixesStatsHandler,
  recordsStatsHandler,
  carpetStatsHandler,
} from './stats.js';
import { numberCareerHandler } from './numbers.js';
import { wehikulHandler } from './wehikul.js';
import { typerHandler } from './typer.js';

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
  app.get('/api/stats/pairs', pairsStatsHandler(db));
  app.get('/api/stats/sums', sumsStatsHandler(db));
  app.get('/api/stats/structure', structureStatsHandler(db));
  app.get('/api/stats/consecutive', consecutiveStatsHandler(db));
  app.get('/api/stats/repeats', repeatsStatsHandler(db));
  app.get('/api/stats/duplicate-sixes', duplicateSixesStatsHandler(db));
  app.get('/api/stats/records', recordsStatsHandler(db));
  app.get('/api/stats/carpet', carpetStatsHandler(db));

  app.get('/api/numbers/:n', numberCareerHandler(db));

  app.get('/api/typer', typerHandler(db));

  app.post('/api/wehikul', wehikulHandler(db));

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(join(DIST_DIR, 'index.html'));
    });
  }

  return app;
}
