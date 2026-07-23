import { cached } from './lib/cache.js';
import { readDraws } from './lib/rebuild-stats.js';
import { generateFact } from './lib/facts.js';

const GAME_TYPE = 'lotto';

/**
 * GET /api/facts/latest -> { fact: { type, text } | null }. The "ciekawostka dnia" for the
 * most recent draw. Memoized under `facts:latest`; since every import ends in
 * `rebuildStats` -> `invalidateCache()`, the fact is recomputed on the first request after
 * new draws land (no separate invalidation wiring needed).
 */
export function factsLatestHandler(db) {
  return (req, res) => {
    const payload = cached('facts:latest', () => ({
      fact: generateFact(readDraws(db, GAME_TYPE)),
    }));
    res.json(payload);
  };
}
