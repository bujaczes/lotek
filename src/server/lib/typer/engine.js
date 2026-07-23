import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { readDraws } from '../rebuild-stats.js';
import { maskFromNumbers } from '../mask.js';
import { nextDrawDate, warsawDateIso } from '../schedule.js';
import { invalidateCache } from '../cache.js';
import { decayedCounts, biasZ, chi2Stat } from './bias.js';
import {
  numberWeights,
  buildPenaltyParams,
  popularity,
  penaltyBreakdown,
} from './popularity.js';
import { enumerateTopK } from './enumerate.js';
import { buildCommentary } from './commentary.js';

const GAME_TYPE = 'lotto';
const REJECTED_EXAMPLE = [1, 2, 3, 4, 5, 6]; // the canonical "everybody plays it" coupon
const WORKER_URL = new URL('./worker.js', import.meta.url);

/**
 * Reads `db` and builds the fully-deterministic enumeration inputs plus the surrounding
 * context needed to assemble the result. Split out from runPrediction() so tests can drive
 * the pure enumeration (enumerateTopK) directly without the worker plumbing.
 */
export function buildEnumerationInputs(db, cfg) {
  const draws = readDraws(db, GAME_TYPE);
  const maxDrawNumber = draws.length ? draws[draws.length - 1].drawNumber : 0;
  const forDrawNumber = maxDrawNumber + 1;

  const { counts, effectiveN, sumSqWeights } = decayedCounts(draws, cfg.halfLifeDraws);
  const Z = biasZ(counts, effectiveN, sumSqWeights);
  const chi2 = chi2Stat(counts, effectiveN);

  const W = numberWeights(cfg);
  const P = buildPenaltyParams(cfg);
  const winnerMasks = new Set(
    db.prepare(`SELECT mask FROM draw WHERE game_type = ?`).all(GAME_TYPE).map((r) => r.mask)
  );
  const targetPop = popularity(REJECTED_EXAMPLE, cfg, winnerMasks, W);

  const params = {
    W,
    Z,
    wA: cfg.weights.wA,
    wB: cfg.weights.wB,
    P,
    winnerMasks: [...winnerMasks], // structured-clone-friendly for the worker
    targetPop,
  };

  return {
    params,
    context: { forDrawNumber, counts, Z, chi2, W, winnerMasks, targetPop, drawsCount: draws.length },
  };
}

// Runs enumerateTopK on a worker_thread, resolving with its result. Rejects on a worker
// error or a non-zero exit before a message arrives.
function runEnumerationWorker(params) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: params });
    let settled = false;
    worker.once('message', (msg) => {
      settled = true;
      resolve(msg);
      worker.terminate();
    });
    worker.once('error', (err) => {
      if (!settled) reject(err);
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`typer worker exited with code ${code}`));
    });
  });
}

function buildBiasReport(counts, Z) {
  const report = [];
  for (let n = 1; n <= 49; n++) {
    report.push({ number: n, decayed: counts[n - 1], z: Z[n - 1] });
  }
  // Most-elevated first; deterministic tie-break on the number itself.
  report.sort((a, b) => b.z - a.z || a.number - b.number);
  return report;
}

function assembleResult({ top, popRankGreater }, context, cfg) {
  const { forDrawNumber, counts, Z, chi2, W, winnerMasks, targetPop } = context;
  const winner = top[0];
  const numbers = winner.numbers;

  const alternatives = top.slice(1).map((t) => ({ numbers: t.numbers, totalScore: t.totalScore }));

  const winnerWeights = numbers.map((n) => ({ number: n, weight: W[n - 1] }));
  const winnerPenalties = penaltyBreakdown(numbers, cfg, winnerMasks);

  return {
    forDrawNumber,
    numbers,
    alternatives,
    scores: {
      bias: winner.bias, // Σ z̃(n_i)
      popularity: winner.popularity, // (Σ w) · Π penalties
      total: winner.totalScore, // wA·bias − wB·popularity
    },
    chi2,
    biasReport: buildBiasReport(counts, Z),
    popularityReport: {
      winnerWeights,
      winnerPenalties,
      rejectedExample: {
        numbers: REJECTED_EXAMPLE,
        popularity: targetPop,
        rank: popRankGreater + 1,
      },
    },
  };
}

const insertPredictionSql = `
  INSERT INTO prediction (
    for_draw_number, numbers, mask, model_version,
    bias_score, popularity_score, total_score, alternatives, commentary, created_at
  ) VALUES (
    @forDrawNumber, @numbers, @mask, @modelVersion,
    @biasScore, @popularityScore, @totalScore, @alternatives, @commentary, @createdAt
  )
  ON CONFLICT(for_draw_number) DO UPDATE SET
    numbers = excluded.numbers,
    mask = excluded.mask,
    model_version = excluded.model_version,
    bias_score = excluded.bias_score,
    popularity_score = excluded.popularity_score,
    total_score = excluded.total_score,
    alternatives = excluded.alternatives,
    commentary = excluded.commentary,
    created_at = excluded.created_at
`;

/**
 * Reads the surrounding facts the commentary (SPEC §8.4) is assembled from — the scheduled
 * draw date, per-number `number_stat` rows for the six chosen numbers, and one example
 * historical winning six the model did NOT pick (the most recent draw, the freshest one
 * people replay). Pure reads; `buildCommentary` itself stays db-free and deterministic.
 */
function buildStatsContext(db, result, cfg) {
  const numbers = result.numbers;
  const placeholders = numbers.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT number, total_count, z_score, last_drawn_at, last_draw_number, current_gap
       FROM number_stat WHERE game_type = ? AND number IN (${placeholders})`
    )
    .all(GAME_TYPE, ...numbers);
  const numberStats = {};
  for (const r of rows) {
    numberStats[r.number] = {
      totalCount: r.total_count,
      zScore: r.z_score,
      lastDrawnAt: r.last_drawn_at,
      lastDrawNumber: r.last_draw_number,
      currentGap: r.current_gap,
    };
  }

  const last = db
    .prepare(
      `SELECT draw_number, drawn_at, n1, n2, n3, n4, n5, n6 FROM draw
       WHERE game_type = ? ORDER BY draw_number DESC LIMIT 1`
    )
    .get(GAME_TYPE);
  const skippedWinner = last
    ? {
        numbers: [last.n1, last.n2, last.n3, last.n4, last.n5, last.n6],
        drawNumber: last.draw_number,
        date: last.drawn_at,
      }
    : null;

  return {
    drawDate: warsawDateIso(nextDrawDate(new Date())),
    numberStats,
    skippedWinner,
    chi2Alpha: cfg.chi2Alpha,
  };
}

function persistPrediction(db, result, cfg) {
  db.prepare(insertPredictionSql).run({
    forDrawNumber: result.forDrawNumber,
    numbers: JSON.stringify(result.numbers),
    mask: maskFromNumbers(result.numbers),
    modelVersion: cfg.modelVersion,
    biasScore: result.scores.bias,
    popularityScore: result.scores.popularity,
    totalScore: result.scores.total,
    alternatives: JSON.stringify(result.alternatives),
    commentary: result.commentary,
    createdAt: Date.now(),
  });
}

function finalize(db, cfg, context, workerResult, wallStart) {
  const result = assembleResult(workerResult, context, cfg);
  // Deterministic "dlaczego te liczby" narrative, assembled from the result + db facts and
  // stored alongside the pick (SPEC §8.4). buildCommentary is pure; the only clock-dependent
  // input is the scheduled draw date, which genuinely IS the next draw.
  result.commentary = buildCommentary(result, buildStatsContext(db, result, cfg));
  persistPrediction(db, result, cfg);
  // A written prediction invalidates the /api/typer cache, mirroring rebuildStats' choke
  // point for the stats/draws caches (src/server/lib/rebuild-stats.js).
  invalidateCache();
  result.timing = {
    enumerationMs: workerResult.elapsedMs,
    combosProcessed: workerResult.combosProcessed,
    wallMs: performance.now() - wallStart,
  };
  return result;
}

/**
 * The Typer engine (SPEC §8.3): globally-optimal, fully-deterministic prediction for the
 * next draw. Reads `db`, standardizes the bias signal, enumerates ALL C(49,6) combinations
 * on a worker_thread scoring score(S) = wA·Σ z̃ − wB·popularity(S), keeps the top-4
 * (lexicographic tie-break), persists the winner + 3 alternatives to `prediction`
 * (ON CONFLICT DO UPDATE — a newer model overwrites before the draw), and returns the full
 * result object. `commentary` is left empty for Task 16.
 *
 * Returns the deterministic result object plus a `timing` field ({enumerationMs,
 * combosProcessed, wallMs}) — timing is the ONLY non-deterministic part and is explicitly
 * not part of the prediction; determinism tests compare everything except `timing`.
 */
export async function runPrediction(db, cfg) {
  const wallStart = performance.now();
  const { params, context } = buildEnumerationInputs(db, cfg);
  const workerResult = await runEnumerationWorker(params);
  return finalize(db, cfg, context, workerResult, wallStart);
}

/**
 * Synchronous variant that runs the enumeration inline (no worker) — used where a worker
 * is undesirable (some test setups) and as the reference the worker result must match.
 * Same result shape as runPrediction (including `timing`).
 */
export function runPredictionSync(db, cfg) {
  const wallStart = performance.now();
  const { params, context } = buildEnumerationInputs(db, cfg);
  const workerResult = enumerateTopK(params);
  return finalize(db, cfg, context, workerResult, wallStart);
}

/**
 * Factory for the scheduler's `hooks.predict` (see scheduler.js `runFetchCycle`, which
 * calls `await hooks.predict?.()` with no arguments after new draws land). Wire as:
 *   startScheduler(db, { hooks: { predict: predictHook(db, cfg) } })
 */
export function predictHook(db, cfg) {
  return async () => {
    await runPrediction(db, cfg);
  };
}
