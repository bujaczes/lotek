import { cached } from './lib/cache.js';

const GAME_TYPE = 'lotto';

// Every record is "the max of one draw_prize column", with ties kept (same {value, draws}
// shape as /api/stats/records). `where` narrows the candidates: the jackpot records only
// look at draws where somebody actually hit six. Column names come from this table only,
// never from the request, so interpolating them is safe.
const RECORDS = {
  topJackpot: { column: 'amount_6', hits: 6, money: true, where: 'p.winners_6 > 0' },
  mostSixes: { column: 'winners_6', hits: 6, money: false, where: 'p.winners_6 > 0' },
  maxFive: { column: 'amount_5', hits: 5, money: true, where: '1 = 1' },
  maxFour: { column: 'amount_4', hits: 4, money: true, where: '1 = 1' },
  mostThrees: { column: 'winners_3', hits: 3, money: false, where: '1 = 1' },
};

function record(db, { column, hits, money, where }) {
  const rows = db
    .prepare(
      `SELECT p.draw_number, d.drawn_at, d.n1, d.n2, d.n3, d.n4, d.n5, d.n6,
              p.winners_${hits} AS winners, p.amount_${hits} AS amount, p.${column} AS value
       FROM draw_prize p
       JOIN draw d ON d.game_type = p.game_type AND d.draw_number = p.draw_number
       WHERE p.game_type = @gameType AND p.status = 'ok' AND ${where}
         AND p.${column} = (SELECT MAX(p.${column}) FROM draw_prize p
                            WHERE p.game_type = @gameType AND p.status = 'ok' AND ${where})
       ORDER BY p.draw_number`
    )
    .all({ gameType: GAME_TYPE });
  if (rows.length === 0) return null;
  return {
    value: money ? rows[0].value / 100 : rows[0].value,
    draws: rows.map((r) => ({
      drawNumber: r.draw_number,
      date: r.drawn_at,
      numbers: [r.n1, r.n2, r.n3, r.n4, r.n5, r.n6],
      winners: r.winners,
      amount: r.amount / 100,
    })),
  };
}

/**
 * GET /api/stats/prizes — prize records and the trójka amount over time, from `draw_prize`.
 * `threeAmount` is a step series: the first draw, every draw where the amount changed, and
 * the last draw (so the chart's last step reaches today).
 */
export function prizesStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:prizes', () => {
      const rows = db
        .prepare(
          `SELECT p.draw_number, d.drawn_at, p.amount_3
           FROM draw_prize p
           JOIN draw d ON d.game_type = p.game_type AND d.draw_number = p.draw_number
           WHERE p.game_type = ? AND p.status = 'ok'
           ORDER BY p.draw_number`
        )
        .all(GAME_TYPE);

      if (rows.length === 0) return { coverage: null, records: null, threeAmount: [] };

      const threeAmount = rows
        .filter((r, i) => i === 0 || i === rows.length - 1 || r.amount_3 !== rows[i - 1].amount_3)
        .map((r) => ({ drawNumber: r.draw_number, date: r.drawn_at, amount: r.amount_3 / 100 }));

      const records = Object.fromEntries(Object.entries(RECORDS).map(([key, spec]) => [key, record(db, spec)]));

      return {
        coverage: { fromDrawNumber: rows[0].draw_number, fromDate: rows[0].drawn_at, draws: rows.length },
        records,
        threeAmount,
      };
    });
    res.json(payload);
  };
}
