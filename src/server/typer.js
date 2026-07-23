import { cached } from './lib/cache.js';
import { nextDrawDate, warsawDateIso } from './lib/schedule.js';

const GAME_TYPE = 'lotto';
const EXPECTED_HITS_PER_COUPON = 36 / 49; // 0.7347… — E[trafienia kuponu], SPEC §8.5 / CONVENTIONS
const HISTORY_LIMIT = 60;

function parseNumbers(json) {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function parseAlternatives(json) {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    // Persisted as [{numbers, totalScore}] (engine.assembleResult) — expose the bare sets.
    return arr.map((a) => (Array.isArray(a) ? a : a?.numbers)).filter(Array.isArray);
  } catch {
    return [];
  }
}

function resultNumbersOf(row) {
  if (row.r_n1 == null) return null;
  return [row.r_n1, row.r_n2, row.r_n3, row.r_n4, row.r_n5, row.r_n6];
}

function buildCurrent(db, row) {
  const numbers = parseNumbers(row.numbers);
  const placeholders = numbers.map(() => '?').join(', ');
  const statRows = numbers.length
    ? db
        .prepare(
          `SELECT number, total_count, z_score, last_drawn_at, last_draw_number, current_gap
           FROM number_stat WHERE game_type = ? AND number IN (${placeholders})`
        )
        .all(GAME_TYPE, ...numbers)
    : [];
  const byNumber = new Map(statRows.map((r) => [r.number, r]));
  const numberStats = [...numbers]
    .sort((a, b) => a - b)
    .map((n) => {
      const s = byNumber.get(n);
      return {
        number: n,
        total: s ? s.total_count : null,
        zScore: s ? s.z_score : null,
        lastDrawnAt: s ? s.last_drawn_at : null,
        lastDrawNumber: s ? s.last_draw_number : null,
        currentGap: s ? s.current_gap : null,
      };
    });

  // Scheduled date for the pick: the result draw's date once it has happened, else the next
  // scheduled slot. (The commentary header already carries the date baked in at predict time.)
  const drawDate = row.result_drawn_at || warsawDateIso(nextDrawDate(new Date()));

  return {
    prediction: {
      forDrawNumber: row.for_draw_number,
      numbers,
      drawDate,
      alternatives: parseAlternatives(row.alternatives),
      scores: { bias: row.bias_score, popularity: row.popularity_score, total: row.total_score },
      modelVersion: row.model_version,
      createdAt: row.created_at,
      hits: row.hits,
      prizeTier: row.prize_tier,
      resultNumbers: resultNumbersOf(row),
      numberStats,
    },
    commentary: row.commentary,
  };
}

const selectPredictionSql = `
  SELECT p.for_draw_number, p.numbers, p.alternatives, p.commentary, p.model_version,
         p.bias_score, p.popularity_score, p.total_score, p.created_at,
         p.hits, p.prize_tier, p.result_draw_id,
         d.drawn_at AS result_drawn_at,
         d.n1 AS r_n1, d.n2 AS r_n2, d.n3 AS r_n3, d.n4 AS r_n4, d.n5 AS r_n5, d.n6 AS r_n6
  FROM prediction p
  LEFT JOIN draw d ON d.id = p.result_draw_id
`;

/**
 * GET /api/typer — the whole Typer page payload in one cached call:
 *   { current: {prediction, commentary} | null, history: [...newest first], nullHypothesis }
 * `current` is the highest for_draw_number (the pick for the next draw while pending).
 * `history` is every earlier prediction with its evaluated result. `nullHypothesis` carries
 * the SPEC §8.5 self-scorecard reference (cumulative hits vs the expected 0,7347/coupon).
 * Cached; the cache is dropped when a prediction is written (engine) or scored (evaluate).
 */
export function typerHandler(db) {
  return (req, res) => {
    const payload = cached('typer:current', () => {
      const currentRow = db
        .prepare(`${selectPredictionSql} ORDER BY p.for_draw_number DESC LIMIT 1`)
        .get();

      if (!currentRow) {
        return {
          current: null,
          history: [],
          nullHypothesis: {
            expectedPerCoupon: EXPECTED_HITS_PER_COUPON,
            evaluatedCount: 0,
            totalHits: 0,
            expectedHits: 0,
          },
        };
      }

      const current = buildCurrent(db, currentRow);

      const historyRows = db
        .prepare(
          `${selectPredictionSql}
           WHERE p.for_draw_number < ?
           ORDER BY p.for_draw_number DESC LIMIT ?`
        )
        .all(currentRow.for_draw_number, HISTORY_LIMIT);

      const history = historyRows.map((row) => ({
        forDrawNumber: row.for_draw_number,
        numbers: parseNumbers(row.numbers),
        createdAt: row.created_at,
        hits: row.hits,
        prizeTier: row.prize_tier,
        resultNumbers: resultNumbersOf(row),
      }));

      // Cumulative self-scorecard over every EVALUATED prediction (hits not null).
      const agg = db
        .prepare(
          `SELECT COUNT(*) AS n, COALESCE(SUM(hits), 0) AS totalHits
           FROM prediction WHERE hits IS NOT NULL`
        )
        .get();
      const nullHypothesis = {
        expectedPerCoupon: EXPECTED_HITS_PER_COUPON,
        evaluatedCount: agg.n,
        totalHits: agg.totalHits,
        expectedHits: agg.n * EXPECTED_HITS_PER_COUPON,
      };

      return { current, history, nullHypothesis };
    });

    res.json(payload);
  };
}
