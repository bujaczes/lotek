import { invalidateCache } from './cache.js';

// TODO(Faza 5): move HALF_LIFE_DRAWS into config/typer.json once the config loader
// exists; for now it is a plain module constant, per Task 5 brief.
export const HALF_LIFE_DRAWS = 300;

const LAMBDA = Math.pow(0.5, 1 / HALF_LIFE_DRAWS);
const MAX_NUMBER = 49;
const NUMBERS_PER_DRAW = 6;
const WINDOW_SIZES = [50, 100, 300];

/**
 * Pure computation (no db) over an array of draws sorted ascending by drawNumber:
 * `{drawNumber, drawnAt, numbers: number[6]}`. Returns 49 rows, one per number 1..49,
 * with camelCase keys mirroring the `number_stat` schema.
 *
 * Design decisions for numbers with zero occurrences (only reachable with a short
 * synthetic history — the real ~7380-draw history has all 49 numbers present):
 * `last_drawn_at`/`last_draw_number`/`current_gap` are `null` ("never seen", not "0
 * draws ago" which would be misleading), `max_gap`/`avg_gap` are `null` when there are
 * fewer than 2 occurrences (no *completed* gap exists yet), `longest_streak` is 0.
 */
export function computeNumberStats(draws) {
  const N = draws.length;
  const maxDrawNumber = N > 0 ? draws[N - 1].drawNumber : 0;

  const occurrencesByNumber = new Map();
  for (let n = 1; n <= MAX_NUMBER; n++) occurrencesByNumber.set(n, []);
  for (const draw of draws) {
    for (const n of draw.numbers) {
      occurrencesByNumber.get(n).push(draw);
    }
  }

  const zDenominator =
    N > 0 ? Math.sqrt(N * NUMBERS_PER_DRAW * (1 / MAX_NUMBER) * ((MAX_NUMBER - 1) / MAX_NUMBER)) : 0;

  const rows = [];
  for (let number = 1; number <= MAX_NUMBER; number++) {
    const occ = occurrencesByNumber.get(number); // ascending by drawNumber (draws iterated ascending)
    const totalCount = occ.length;

    const [countLast50, countLast100, countLast300] = WINDOW_SIZES.map(
      (w) => occ.filter((d) => d.drawNumber > maxDrawNumber - w).length
    );

    let decayedCount = 0;
    for (const d of occ) {
      decayedCount += Math.pow(LAMBDA, maxDrawNumber - d.drawNumber);
    }

    const zScore = N > 0 ? (totalCount - (N * NUMBERS_PER_DRAW) / MAX_NUMBER) / zDenominator : null;

    const last = totalCount > 0 ? occ[totalCount - 1] : null;

    // Completed gaps: for consecutive occurrence draw_numbers p_k, p_{k+1}, the gap is
    // the count of draws strictly between them. Ties on max_gap keep the earliest one
    // (house convention: earlier wins ties), so we only replace on strictly-greater.
    let maxGap = null;
    let maxGapEndedAt = null;
    let gapSum = 0;
    let gapCount = 0;
    for (let i = 1; i < occ.length; i++) {
      const gap = occ[i].drawNumber - occ[i - 1].drawNumber - 1;
      gapSum += gap;
      gapCount += 1;
      if (maxGap === null || gap > maxGap) {
        maxGap = gap;
        maxGapEndedAt = occ[i].drawnAt;
      }
    }
    const avgGap = gapCount > 0 ? gapSum / gapCount : null;

    let longestStreak = 0;
    if (totalCount > 0) {
      let run = 1;
      longestStreak = 1;
      for (let i = 1; i < occ.length; i++) {
        run = occ[i].drawNumber === occ[i - 1].drawNumber + 1 ? run + 1 : 1;
        if (run > longestStreak) longestStreak = run;
      }
    }

    const yearCounts = {};
    for (const d of occ) {
      const year = d.drawnAt.slice(0, 4);
      yearCounts[year] = (yearCounts[year] || 0) + 1;
    }

    rows.push({
      number,
      totalCount,
      countLast50,
      countLast100,
      countLast300,
      decayedCount,
      zScore,
      lastDrawnAt: last ? last.drawnAt : null,
      lastDrawNumber: last ? last.drawNumber : null,
      currentGap: last ? maxDrawNumber - last.drawNumber : null,
      maxGap,
      maxGapEndedAt,
      avgGap,
      longestStreak,
      yearCounts: JSON.stringify(yearCounts),
    });
  }

  return rows;
}

/**
 * Pure computation (no db) of all 1176 unordered pairs (a<b) in 1..49: `cnt` (times both
 * appeared in the same draw), `expected = N*5/392`, `lift = cnt/expected` (0 when
 * expected is 0, i.e. N=0). Always returns all 1176 rows, including cnt=0 pairs.
 */
export function computePairStats(draws) {
  const N = draws.length;
  const counts = new Map();

  for (const draw of draws) {
    const nums = draw.numbers;
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const key = nums[i] * 100 + nums[j]; // a<b, both <=49, collision-free encoding
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }

  const expected = N > 0 ? (N * 5) / 392 : 0;

  const rows = [];
  for (let a = 1; a <= MAX_NUMBER; a++) {
    for (let b = a + 1; b <= MAX_NUMBER; b++) {
      const cnt = counts.get(a * 100 + b) || 0;
      rows.push({ a, b, cnt, expected, lift: expected > 0 ? cnt / expected : 0 });
    }
  }
  return rows;
}

export function readDraws(db, gameType) {
  return db
    .prepare(
      `SELECT draw_number AS drawNumber, drawn_at AS drawnAt, n1, n2, n3, n4, n5, n6
       FROM draw WHERE game_type = ? ORDER BY draw_number ASC`
    )
    .all(gameType)
    .map((r) => ({
      drawNumber: r.drawNumber,
      drawnAt: r.drawnAt,
      numbers: [r.n1, r.n2, r.n3, r.n4, r.n5, r.n6],
    }));
}

const insertNumberStatSql = `
  INSERT INTO number_stat (
    game_type, number, total_count, count_last50, count_last100, count_last300,
    decayed_count, z_score, last_drawn_at, last_draw_number, current_gap,
    max_gap, max_gap_ended_at, avg_gap, longest_streak, year_counts
  ) VALUES (
    @gameType, @number, @totalCount, @countLast50, @countLast100, @countLast300,
    @decayedCount, @zScore, @lastDrawnAt, @lastDrawNumber, @currentGap,
    @maxGap, @maxGapEndedAt, @avgGap, @longestStreak, @yearCounts
  )
`;

const insertPairStatSql = `
  INSERT INTO pair_stat (game_type, a, b, cnt, expected, lift)
  VALUES (@gameType, @a, @b, @cnt, @expected, @lift)
`;

/**
 * Full rebuild of `number_stat` and `pair_stat` for `gameType`: reads all draws for that
 * game (ascending by draw_number), computes both tables in memory, then replaces the
 * on-disk rows in a single transaction (DELETE then re-insert — no incremental logic,
 * per brief; at 49+1176 rows this is a fraction of a second even on the full history).
 */
export function rebuildStats(db, { gameType = 'lotto' } = {}) {
  const draws = readDraws(db, gameType);
  const numberRows = computeNumberStats(draws);
  const pairRows = computePairStats(draws);

  const deleteNumberStat = db.prepare('DELETE FROM number_stat WHERE game_type = ?');
  const deletePairStat = db.prepare('DELETE FROM pair_stat WHERE game_type = ?');
  const insertNumberStat = db.prepare(insertNumberStatSql);
  const insertPairStat = db.prepare(insertPairStatSql);

  const rebuild = db.transaction(() => {
    deleteNumberStat.run(gameType);
    deletePairStat.run(gameType);
    for (const row of numberRows) insertNumberStat.run({ gameType, ...row });
    for (const row of pairRows) insertPairStat.run({ gameType, ...row });
  });

  rebuild();

  // Cache is only invalidated once the transaction above has actually committed — every
  // draw/number_stat/pair_stat-derived API response (src/server/draws.js, stats.js)
  // routes through `cached()`, so this is the single choke point that keeps them from
  // serving stale data after an import or a manual `npm run stats:rebuild`.
  invalidateCache();

  return {
    gameType,
    drawsCount: draws.length,
    numberStatRows: numberRows.length,
    pairStatRows: pairRows.length,
  };
}
