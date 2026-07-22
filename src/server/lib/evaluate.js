const GAME_TYPE = 'lotto';

// One statement does the whole job entirely inside SQLite: `prediction.mask & draw.mask`
// is SQLite's own bitwise AND, which operates on 64-bit signed integers (not JS's 32-bit
// bitwise ops), so it is exact across the full 49-bit mask range. `bit_count()` (the
// custom function registered in db/index.js, backed by src/server/lib/mask.js's
// popcount()) then counts the set bits of that AND result. JS `&` never touches a mask
// anywhere in this path — see CONVENTIONS.md's "49-bit-safe" requirement.
//
// prize_tier follows the CONVENTIONS.md correction to SPEC §6.14: I stopień = 6
// trafień, II = 5, III = 4, IV = 3, i.e. `prize_tier = 7 - hits` for hits >= 3, else NULL
// (fewer than 3 hits wins nothing).
const evaluateSql = `
  UPDATE prediction
  SET
    hits = bit_count(prediction.mask & draw.mask),
    prize_tier = CASE WHEN bit_count(prediction.mask & draw.mask) >= 3
                       THEN 7 - bit_count(prediction.mask & draw.mask)
                       ELSE NULL END,
    result_draw_id = draw.id
  FROM draw
  WHERE draw.game_type = @gameType
    AND draw.draw_number = prediction.for_draw_number
    AND prediction.result_draw_id IS NULL
`;

/**
 * Resolves every pending prediction (`result_draw_id IS NULL`) whose `for_draw_number`
 * now has a matching draw: sets `hits`, `prize_tier`, and `result_draw_id` in one SQL
 * statement (see `evaluateSql` above). Predictions for a draw number that hasn't
 * happened yet, or that were already evaluated, are left untouched.
 *
 * Returns `{evaluated}` — the number of prediction rows just resolved by this call.
 */
export function evaluatePredictions(db, { gameType = GAME_TYPE } = {}) {
  const result = db.prepare(evaluateSql).run({ gameType });
  return { evaluated: result.changes };
}
