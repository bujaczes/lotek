import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(MODULE_DIR, '..', '..', 'dist');

export function createApp(db) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM draw').get();
    res.json({ ok: true, draws: count });
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(join(DIST_DIR, 'index.html'));
    });
  }

  return app;
}
