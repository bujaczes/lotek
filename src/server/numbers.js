import { cached } from './lib/cache.js';
import { readDraws } from './lib/rebuild-stats.js';
import { numberGapHistogram, zScoreCheckpoints } from './lib/number-career.js';
import { numberToCell } from './lib/blanket.js';

const GAME_TYPE = 'lotto';
const N_RE = /^\d+$/;

/** number_stat -> camelCase career view (same field set computeNumberStats produces). */
function toStatsView(row) {
  return {
    totalCount: row.total_count,
    countLast50: row.count_last50,
    countLast100: row.count_last100,
    countLast300: row.count_last300,
    decayedCount: row.decayed_count,
    zScore: row.z_score,
    lastDrawnAt: row.last_drawn_at,
    lastDrawNumber: row.last_draw_number,
    currentGap: row.current_gap,
    maxGap: row.max_gap,
    maxGapEndedAt: row.max_gap_ended_at,
    avgGap: row.avg_gap,
    longestStreak: row.longest_streak,
  };
}

export function numberCareerHandler(db) {
  return (req, res) => {
    const raw = req.params.n;
    if (!N_RE.test(raw)) return res.status(400).json({ error: 'invalid number' });
    const n = Number(raw);
    if (n < 1 || n > 49) return res.status(400).json({ error: 'invalid number' });

    const payload = cached(`numbers:${n}`, () => {
      const row = db.prepare('SELECT * FROM number_stat WHERE game_type = ? AND number = ?').get(GAME_TYPE, n);
      const draws = readDraws(db, GAME_TYPE);

      return {
        number: n,
        stats: row
          ? toStatsView(row)
          : toStatsView({
              total_count: 0,
              count_last50: 0,
              count_last100: 0,
              count_last300: 0,
              decayed_count: 0,
              z_score: null,
              last_drawn_at: null,
              last_draw_number: null,
              current_gap: null,
              max_gap: null,
              max_gap_ended_at: null,
              avg_gap: null,
              longest_streak: 0,
            }),
        yearCounts: row ? JSON.parse(row.year_counts || '{}') : {},
        gapHistogram: numberGapHistogram(draws, n),
        zScoreSeries: zScoreCheckpoints(draws, n),
        blanket: numberToCell(n),
      };
    });

    res.json(payload);
  };
}
