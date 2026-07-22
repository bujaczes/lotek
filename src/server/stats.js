import { cached } from './lib/cache.js';
import { readDraws } from './lib/rebuild-stats.js';
import { computeGapDistribution, geometricGapCurve, P_NUMBER_DRAWN } from './lib/gaps.js';

const GAME_TYPE = 'lotto';
const TOP_N = 10;

function readNumberStats(db) {
  return db
    .prepare('SELECT * FROM number_stat WHERE game_type = ? ORDER BY number ASC')
    .all(GAME_TYPE);
}

export function blanketStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:blanket', () =>
      readNumberStats(db).map((r) => ({
        number: r.number,
        total: r.total_count,
        last50: r.count_last50,
        last100: r.count_last100,
        currentGap: r.current_gap,
        zScore: r.z_score,
        lastDrawnAt: r.last_drawn_at,
      }))
    );
    res.json(payload);
  };
}

function topByCount(rows, countKey, order, n) {
  const sign = order === 'desc' ? -1 : 1;
  const sorted = [...rows].sort((a, b) => sign * (a[countKey] - b[countKey]) || a.number - b.number);
  return sorted.slice(0, n).map((r) => ({ number: r.number, count: r[countKey], zScore: r.z_score }));
}

export function rankingsStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:rankings', () => {
      const rows = readNumberStats(db).map((r) => ({
        number: r.number,
        z_score: r.z_score,
        all: r.total_count,
        last100: r.count_last100,
        currentYear: JSON.parse(r.year_counts || '{}')[String(new Date().getFullYear())] || 0,
      }));

      const windows = ['all', 'last100', 'currentYear'];
      const hot = Object.fromEntries(windows.map((w) => [w, topByCount(rows, w, 'desc', TOP_N)]));
      const cold = Object.fromEntries(windows.map((w) => [w, topByCount(rows, w, 'asc', TOP_N)]));

      return { hot, cold };
    });
    res.json(payload);
  };
}

function topByGapField(rows, field, n) {
  return rows
    .filter((r) => r[field] !== null)
    .sort((a, b) => b[field] - a[field] || a.number - b.number)
    .slice(0, n)
    .map((r) => ({ number: r.number, currentGap: r.current_gap, maxGap: r.max_gap, avgGap: r.avg_gap }));
}

export function gapsStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:gaps', () => {
      const rows = readNumberStats(db);

      const currentGapTop10 = topByGapField(rows, 'current_gap', TOP_N);
      const maxGapTop10 = topByGapField(rows, 'max_gap', TOP_N);

      const draws = readDraws(db, GAME_TYPE);
      const { histogram, total, maxGap } = computeGapDistribution(draws);
      const theoretical = geometricGapCurve(maxGap, total);

      return {
        currentGapTop10,
        maxGapTop10,
        gapDistribution: {
          p: P_NUMBER_DRAWN,
          totalObservations: total,
          observed: histogram,
          theoretical,
        },
      };
    });
    res.json(payload);
  };
}
