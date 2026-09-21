// Reads and writes `draw_prize` (docs/superpowers/specs/2026-09-21-wygrane-design.md).
// Amounts are stored in grosze and handed out in złoty. The status rules below are the
// single source for both the API (`prizesView`) and the sync (`selectDrawsNeedingPrizes`):
// a draw the sync still wants is exactly a draw the API reports as `pending`.

const GAME_TYPE = 'lotto';
const DAY_MS = 86400000;

/** First Lotto draw the OpenAPI has prize data for (2011-08-25, found by bisection 2026-09-21). */
export const FIRST_PRIZE_DRAW = 5048;

/** An `empty` answer for a draw younger than this may just mean "not announced yet". */
export const RECHECK_EMPTY_DAYS = 7;

export const HITS = [6, 5, 4, 3];

function recheckCutoffIso(now) {
  return new Date(now.getTime() - RECHECK_EMPTY_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/** Draw numbers whose prizes are still `pending`, newest first (the latest draw matters most). */
export function selectDrawsNeedingPrizes(db, { now = new Date() } = {}) {
  return db
    .prepare(
      `SELECT d.draw_number AS drawNumber
       FROM draw d
       LEFT JOIN draw_prize p ON p.game_type = d.game_type AND p.draw_number = d.draw_number
       WHERE d.game_type = @gameType AND d.draw_number >= @first
         AND (p.draw_number IS NULL OR (p.status = 'empty' AND d.drawn_at >= @cutoff))
       ORDER BY d.draw_number DESC`
    )
    .all({ gameType: GAME_TYPE, first: FIRST_PRIZE_DRAW, cutoff: recheckCutoffIso(now) })
    .map((r) => r.drawNumber);
}

/** Insert or replace one draw's row from a `fetchPrizes` result. */
export function upsertPrizes(db, drawNumber, result, fetchedAt) {
  const params = { gameType: GAME_TYPE, drawNumber, status: result.status, fetchedAt };
  for (const hits of HITS) {
    const tier = result.status === 'ok' ? result.tiers[hits] : null;
    params[`w${hits}`] = tier ? tier.winners : null;
    params[`a${hits}`] = tier ? tier.amount : null;
  }
  db.prepare(
    `INSERT INTO draw_prize (game_type, draw_number, status, winners_6, amount_6, winners_5, amount_5,
                             winners_4, amount_4, winners_3, amount_3, fetched_at)
     VALUES (@gameType, @drawNumber, @status, @w6, @a6, @w5, @a5, @w4, @a4, @w3, @a3, @fetchedAt)
     ON CONFLICT (game_type, draw_number) DO UPDATE SET
       status = excluded.status,
       winners_6 = excluded.winners_6, amount_6 = excluded.amount_6,
       winners_5 = excluded.winners_5, amount_5 = excluded.amount_5,
       winners_4 = excluded.winners_4, amount_4 = excluded.amount_4,
       winners_3 = excluded.winners_3, amount_3 = excluded.amount_3,
       fetched_at = excluded.fetched_at`
  ).run(params);
}

/** 'ok' | 'pending' | 'unavailable' for one draw, given its `draw_prize` row (or undefined). */
export function prizeStatus({ drawNumber, drawnAt, row, now = new Date() }) {
  if (row?.status === 'ok') return 'ok';
  if (drawNumber < FIRST_PRIZE_DRAW) return 'unavailable';
  if (row?.status === 'empty' && drawnAt < recheckCutoffIso(now)) return 'unavailable';
  return 'pending';
}

/** The `prizes` field of the draw API payloads. */
export function prizesView(db, { drawNumber, drawnAt }, { now = new Date() } = {}) {
  const row = db
    .prepare('SELECT * FROM draw_prize WHERE game_type = ? AND draw_number = ?')
    .get(GAME_TYPE, drawNumber);
  const status = prizeStatus({ drawNumber, drawnAt, row, now });
  if (status !== 'ok') return { status };
  return {
    status,
    tiers: HITS.map((hits) => ({ hits, winners: row[`winners_${hits}`], amount: row[`amount_${hits}`] / 100 })),
  };
}

/** True unless the newest draw's prizes are still `pending` — the scheduler's "stop retrying" test. */
export function latestDrawPrizesSettled(db, { now = new Date() } = {}) {
  const latest = db
    .prepare('SELECT draw_number, drawn_at FROM draw WHERE game_type = ? ORDER BY draw_number DESC LIMIT 1')
    .get(GAME_TYPE);
  if (!latest) return true;
  return prizesView(db, { drawNumber: latest.draw_number, drawnAt: latest.drawn_at }, { now }).status !== 'pending';
}
