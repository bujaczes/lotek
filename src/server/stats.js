import { cached } from './lib/cache.js';
import { readDraws } from './lib/rebuild-stats.js';
import { computeGapDistribution, geometricGapCurve, P_NUMBER_DRAWN } from './lib/gaps.js';
import { computeTripleStats } from './lib/triple-stats.js';
import { numbersFromMask } from './lib/mask.js';
import {
  C,
  P_CONSECUTIVE,
  P_REPEAT_PREV,
  P_BIRTHDAY_SHARE,
  sumDistribution,
  evenOddDist,
  lowHighDist,
} from './lib/theory.js';

const GAME_TYPE = 'lotto';
const TOP_N = 10;
const TOP_PAIRS = 15;
const TOP_TRIPLES = 15;
const MIN_SUM = 21;
const MAX_SUM = 279;
const LOW_TOP = 10; // 1..10, "spóźnialscy"/drought range

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

/**
 * Top 15 pairs come straight off the materialized pair_stat table (rematerialized by
 * rebuildStats — cheap, 1176 rows). Triples are NOT materialized (C(49,3)=18424 possible,
 * per the brief "liczone on-the-fly z draws"): computeTripleStats walks the full draw
 * history once per (cache) miss and returns only observed triples, top 15 by cnt.
 */
export function pairsStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:pairs', () => {
      const pairs = db
        .prepare(
          `SELECT a, b, cnt, expected, lift FROM pair_stat
           WHERE game_type = @gameType ORDER BY cnt DESC, a ASC, b ASC LIMIT @limit`
        )
        .all({ gameType: GAME_TYPE, limit: TOP_PAIRS });

      const draws = readDraws(db, GAME_TYPE);
      const triples = computeTripleStats(draws, { top: TOP_TRIPLES });

      return { pairs, triples };
    });
    res.json(payload);
  };
}

// Precomputed once at module load — sumDistribution() is pure and independent of the db
// (a fixed property of C(49,6)), so there is no reason to recompute the DP on every
// request or even on every cache miss.
const SUM_DIST_ROWS = sumDistribution();
const SUM_DIST_TOTAL = SUM_DIST_ROWS.reduce((s, r) => s + r.count, 0); // === C(49,6)
const SUM_DIST_BY_SUM = new Map(SUM_DIST_ROWS.map((r) => [r.sum, r.count]));

/**
 * Sector labels for the last draw's sum, bucketed by its empirical percentile among all
 * historical sums. Thresholds (design decision, not specified by the brief beyond the
 * SPEC 6.5 example "suma 145 — sektor typowy, 62. percentyl"): <25th percentile = "niski",
 * >75th = "wysoki", the broad 50 p.p. middle band = "typowy".
 */
function sectorForPercentile(percentile) {
  if (percentile < 25) return 'niski';
  if (percentile > 75) return 'wysoki';
  return 'typowy';
}

export function sumsStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:sums', () => {
      const draws = readDraws(db, GAME_TYPE);
      const N = draws.length;
      const sums = draws.map((d) => d.numbers.reduce((s, n) => s + n, 0));

      const observedCounts = new Map();
      for (const s of sums) observedCounts.set(s, (observedCounts.get(s) || 0) + 1);

      const histogram = [];
      const theoretical = [];
      for (let s = MIN_SUM; s <= MAX_SUM; s++) {
        histogram.push({ sum: s, count: observedCounts.get(s) || 0 });
        const probability = (SUM_DIST_BY_SUM.get(s) || 0) / SUM_DIST_TOTAL;
        theoretical.push({ sum: s, expected: probability * N });
      }

      let lastSum = null;
      let percentile = null;
      let sector = null;
      if (N > 0) {
        lastSum = sums[N - 1];
        const countAtOrBelow = sums.filter((s) => s <= lastSum).length;
        percentile = (countAtOrBelow / N) * 100;
        sector = sectorForPercentile(percentile);
      }

      return { histogram, theoretical, lastSum, percentile, sector };
    });
    res.json(payload);
  };
}

export function structureStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:structure', () => {
      const draws = readDraws(db, GAME_TYPE);
      const N = draws.length;

      const evenCounts = new Array(7).fill(0);
      const lowCounts = new Array(7).fill(0);
      for (const d of draws) {
        evenCounts[d.numbers.filter((n) => n % 2 === 0).length]++;
        lowCounts[d.numbers.filter((n) => n <= 24).length]++;
      }

      const even = evenOddDist().map((row) => ({
        k: row.evens,
        empiricalCount: evenCounts[row.evens],
        empiricalShare: N > 0 ? evenCounts[row.evens] / N : 0,
        theoretical: row.probability,
      }));
      const low = lowHighDist().map((row) => ({
        k: row.low,
        empiricalCount: lowCounts[row.low],
        empiricalShare: N > 0 ? lowCounts[row.low] / N : 0,
        theoretical: row.probability,
      }));

      return { even, low };
    });
    res.json(payload);
  };
}

function hasConsecutivePair(numbers) {
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] - numbers[i - 1] === 1) return true;
  }
  return false;
}

export function consecutiveStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:consecutive', () => {
      const draws = readDraws(db, GAME_TYPE);
      const N = draws.length;
      const withConsecutive = draws.filter((d) => hasConsecutivePair(d.numbers)).length;
      return {
        empiricalShare: N > 0 ? withConsecutive / N : 0,
        theoretical: P_CONSECUTIVE,
        draws: N,
      };
    });
    res.json(payload);
  };
}

export function repeatsStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:repeats', () => {
      const draws = readDraws(db, GAME_TYPE); // ascending by draw_number
      let withRepeat = 0;
      for (let i = 1; i < draws.length; i++) {
        const prevSet = new Set(draws[i - 1].numbers);
        if (draws[i].numbers.some((n) => prevSet.has(n))) withRepeat++;
      }
      const comparedDraws = Math.max(draws.length - 1, 0);
      return {
        empiricalShare: comparedDraws > 0 ? withRepeat / comparedDraws : 0,
        theoretical: P_REPEAT_PREV,
        comparedDraws,
      };
    });
    res.json(payload);
  };
}

export function duplicateSixesStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:duplicate-sixes', () => {
      const dupMasks = db
        .prepare(
          `SELECT mask, COUNT(*) AS cnt FROM draw WHERE game_type = @gameType
           GROUP BY mask HAVING cnt >= 2`
        )
        .all({ gameType: GAME_TYPE });

      const occurrenceStmt = db.prepare(
        `SELECT draw_number, drawn_at FROM draw
         WHERE game_type = @gameType AND mask = @mask ORDER BY draw_number ASC`
      );

      const groups = dupMasks
        .map((row) => {
          const occurrences = occurrenceStmt
            .all({ gameType: GAME_TYPE, mask: row.mask })
            .map((o) => ({ drawNumber: o.draw_number, date: o.drawn_at }));
          return { numbers: numbersFromMask(row.mask), occurrences };
        })
        // Most-repeated group first; ties broken by the group's lowest number (arbitrary
        // but deterministic — matches the "lower wins ties" convention used elsewhere).
        .sort((g1, g2) => g2.occurrences.length - g1.occurrences.length || g1.numbers[0] - g2.numbers[0]);

      const { total } = db.prepare('SELECT COUNT(*) AS total FROM draw WHERE game_type = ?').get(GAME_TYPE);
      const expectedCollisions = C(total, 2) / 13983816;

      return { groups, expectedCollisions };
    });
    res.json(payload);
  };
}

/** Longest run of consecutive integers within a single draw's sorted 6 numbers. */
function longestRunInDraw(numbers) {
  let bestLength = 1;
  let bestEnd = numbers.length - 1;
  let runLength = 1;
  for (let i = 1; i < numbers.length; i++) {
    runLength = numbers[i] === numbers[i - 1] + 1 ? runLength + 1 : 1;
    if (runLength > bestLength) {
      bestLength = runLength;
      bestEnd = i;
    }
  }
  return { length: bestLength, run: numbers.slice(bestEnd - bestLength + 1, bestEnd + 1) };
}

function hasNumberInRange(numbers, lo, hi) {
  return numbers.some((n) => n >= lo && n <= hi);
}

/**
 * "Record absence" = the single longest gap any number has EVER had, whether that record
 * is a completed historical gap (max_gap) or a still-ongoing one (current_gap) that has
 * already surpassed every completed gap in the table. Ties keep the FIRST row that
 * reached the value (rows are iterated number-ascending, comparison is strict `>`), i.e.
 * the lowest number wins — same "earlier/lower wins ties" convention as
 * computeNumberStats' max_gap tie-break.
 */
function computeRecordAbsence(numberStatRows) {
  let best = null;
  for (const r of numberStatRows) {
    const candidates = [];
    if (r.max_gap !== null) candidates.push({ gap: r.max_gap, type: 'historical', endedAt: r.max_gap_ended_at });
    if (r.current_gap !== null) candidates.push({ gap: r.current_gap, type: 'ongoing', endedAt: null });
    for (const c of candidates) {
      if (!best || c.gap > best.gap) {
        best = { number: r.number, gap: c.gap, type: c.type, endedAt: c.endedAt };
      }
    }
  }
  return best;
}

export function recordsStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:records', () => {
      const draws = readDraws(db, GAME_TYPE);
      const N = draws.length;

      let maxSum = { value: null, draws: [] };
      let minSum = { value: null, draws: [] };
      let longestRun = { length: 0, draws: [] };

      for (const d of draws) {
        const sum = d.numbers.reduce((s, n) => s + n, 0);
        const view = { drawNumber: d.drawNumber, date: d.drawnAt, numbers: d.numbers };

        if (maxSum.value === null || sum > maxSum.value) maxSum = { value: sum, draws: [view] };
        else if (sum === maxSum.value) maxSum.draws.push(view);

        if (minSum.value === null || sum < minSum.value) minSum = { value: sum, draws: [view] };
        else if (sum === minSum.value) minSum.draws.push(view);

        const { length, run } = longestRunInDraw(d.numbers);
        const runView = { ...view, run };
        if (length > longestRun.length) longestRun = { length, draws: [runView] };
        else if (length === longestRun.length && length > 0) longestRun.draws.push(runView);
      }

      // Longest streak of consecutive draws (by draw_number — continuous per CONVENTIONS)
      // where NONE of the 6 numbers is in 1..10.
      let longestDrought = { length: 0, from: null, to: null };
      let runStart = null;
      let runLen = 0;
      for (const d of draws) {
        if (!hasNumberInRange(d.numbers, 1, LOW_TOP)) {
          if (runLen === 0) runStart = d;
          runLen++;
          if (runLen > longestDrought.length) {
            longestDrought = {
              length: runLen,
              from: { drawNumber: runStart.drawNumber, date: runStart.drawnAt },
              to: { drawNumber: d.drawNumber, date: d.drawnAt },
            };
          }
        } else {
          runLen = 0;
          runStart = null;
        }
      }

      const recordAbsence = computeRecordAbsence(readNumberStats(db));

      let birthdayness = null;
      if (N > 0) {
        const last = draws[N - 1];
        const count = last.numbers.filter((n) => n <= 31).length;
        birthdayness = { lastDrawNumber: last.drawNumber, count, share: count / 6, theoretical: P_BIRTHDAY_SHARE };
      }

      return { maxSum, minSum, longestRun, longestDrought, recordAbsence, birthdayness };
    });
    res.json(payload);
  };
}

export function carpetStatsHandler(db) {
  return (req, res) => {
    const payload = cached('stats:carpet', () => {
      const draws = readDraws(db, GAME_TYPE);
      const dates = draws.map((d) => d.drawnAt);
      const points = [];
      draws.forEach((d, i) => {
        for (const n of d.numbers) points.push([i, n]);
      });
      return { dates, points };
    });
    res.json(payload);
  };
}
