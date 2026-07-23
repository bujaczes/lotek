import { cached } from './lib/cache.js';
import { loadPrizes } from './lib/config.js';
import { buildScorecard } from './lib/scorecard.js';

// GET /api/typer/scorecard — the "Sprawdzam!" self-accounting (SPEC §8.5) over every
// EVALUATED prediction (result_draw_id set): cumulative hits vs the expected 0,7347/coupon
// with a ±2σ noise band, the observed vs hypergeometric hit distribution, and the
// hypothetical balance. Cached under its own key; evaluatePredictions() clears the whole
// cache when it scores a draw, so the scorecard never serves stale results.

const selectEvaluatedSql = `
  SELECT p.for_draw_number AS forDrawNumber, p.numbers AS numbers,
         p.hits AS hits, p.prize_tier AS prizeTier, d.drawn_at AS date
  FROM prediction p
  JOIN draw d ON d.id = p.result_draw_id
  WHERE p.result_draw_id IS NOT NULL
  ORDER BY p.for_draw_number ASC
`;

export function scorecardHandler(db) {
  const prizes = loadPrizes();

  return (req, res) => {
    const payload = cached('typer:scorecard', () => {
      const rows = db.prepare(selectEvaluatedSql).all();
      const predictions = rows.map((r) => ({
        forDrawNumber: r.forDrawNumber,
        date: r.date,
        numbers: JSON.parse(r.numbers),
        hits: r.hits,
        prizeTier: r.prizeTier,
      }));
      return buildScorecard(predictions, prizes);
    });

    res.json(payload);
  };
}
