import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { importHistory } from '../scripts/import-history.js';
import { loadTyperConfig } from '../src/server/lib/typer/config.js';
import {
  runPrediction,
  runPredictionSync,
  buildEnumerationInputs,
  predictHook,
} from '../src/server/lib/typer/engine.js';
import { enumerateTopK } from '../src/server/lib/typer/enumerate.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(TESTS_DIR, '..', 'data', 'fixtures', 'dl_snapshot.txt.gz');
const TOTAL_COMBOS = 13983816;
const LONG = 120000; // enumeration budget per the SPEC

const cfg = loadTyperConfig();

// ---------------------------------------------------------------------------
// Deterministic LCG (Numerical Recipes) — same generator as typer-bias.test.js. NO
// Math.random: a fixed seed makes the planted-bias history a reproducible fixture.
// ---------------------------------------------------------------------------
function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
function sixDistinct(rand, forced = null) {
  const chosen = new Set();
  if (forced !== null) chosen.add(forced);
  while (chosen.size < 6) chosen.add(Math.floor(rand() * 49) + 1);
  return [...chosen].sort((a, b) => a - b);
}
function generateDraws(seed, n, { biasNumber = null, forceProb = 0 } = {}) {
  const rand = makeLcg(seed);
  const draws = [];
  for (let k = 1; k <= n; k++) {
    const forced = biasNumber !== null && rand() < forceProb ? biasNumber : null;
    draws.push({ drawNumber: k, numbers: sixDistinct(rand, forced) });
  }
  return draws;
}

function insertSyntheticDraws(db, draws) {
  const stmt = db.prepare(
    `INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
     VALUES ('lotto', @drawNumber, '2020-01-01', @n1, @n2, @n3, @n4, @n5, @n6, @mask, 'manual', 0)`
  );
  const tx = db.transaction((rows) => {
    for (const d of rows) {
      const [n1, n2, n3, n4, n5, n6] = d.numbers;
      stmt.run({ drawNumber: d.drawNumber, n1, n2, n3, n4, n5, n6, mask: maskFromNumbers(d.numbers) });
    }
  });
  tx(draws);
}

function loadFixtureDb() {
  const db = openDatabase(':memory:');
  const text = gunzipSync(readFileSync(SNAPSHOT_PATH)).toString('utf8');
  importHistory(db, text);
  return db;
}

function withoutTiming(result) {
  const { timing, ...rest } = result;
  return rest;
}

// Shared read-only-ish fixture DB (predictions upsert into it, draws are never mutated).
let fixtureDb;
beforeAll(() => {
  fixtureDb = loadFixtureDb();
});
afterAll(() => {
  fixtureDb?.close();
});

describe('runPrediction — determinism (SPEC §8.3: same input -> bit-identical output)', () => {
  it('two runs on the same DB produce a deep-equal result (excluding wall-clock timing)', async () => {
    const a = await runPrediction(fixtureDb, cfg);
    const b = await runPrediction(fixtureDb, cfg);
    expect(withoutTiming(a)).toEqual(withoutTiming(b));
  }, LONG);

  it('the worker path and the inline path agree on the winner, alternatives and scores', async () => {
    const viaWorker = await runPrediction(fixtureDb, cfg);
    const inline = runPredictionSync(fixtureDb, cfg);
    expect(withoutTiming(inline)).toEqual(withoutTiming(viaWorker));
  }, LONG);

  it('the stored commentary is byte-identical across two runs on the frozen fixture DB', async () => {
    const a = await runPrediction(fixtureDb, cfg);
    const b = await runPrediction(fixtureDb, cfg);
    expect(typeof a.commentary).toBe('string');
    expect(a.commentary.length).toBeGreaterThan(0);
    expect(a.commentary).toBe(b.commentary);
  }, LONG);
});

describe('runPrediction — enumeration completeness and wall-clock', () => {
  it('scores every one of the 13 983 816 combinations in well under 120s', async () => {
    const start = Date.now();
    const result = await runPrediction(fixtureDb, cfg);
    const wallMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(
      `[typer-engine] enumeration: ${result.timing.combosProcessed.toLocaleString('en-US')} combos, ` +
        `worker ${result.timing.enumerationMs.toFixed(0)}ms, wall ${wallMs}ms`
    );
    expect(result.timing.combosProcessed).toBe(TOTAL_COMBOS);
    expect(result.timing.enumerationMs).toBeLessThan(LONG);
    expect(wallMs).toBeLessThan(LONG);
  }, LONG);
});

describe('runPrediction — result shape and persistence', () => {
  it('predicts for MAX(draw_number)+1 and persists winner + 3 alternatives (upsert)', async () => {
    const db = loadFixtureDb();
    try {
      const maxDraw = db.prepare('SELECT MAX(draw_number) m FROM draw').get().m;
      const result = await runPrediction(db, cfg);

      expect(result.forDrawNumber).toBe(maxDraw + 1);
      expect(result.numbers).toHaveLength(6);
      expect(result.alternatives).toHaveLength(3);
      expect(result.scores).toEqual({
        bias: expect.any(Number),
        popularity: expect.any(Number),
        total: expect.any(Number),
      });
      expect(result.chi2).toMatchObject({ df: 48 });
      expect(result.biasReport).toHaveLength(49);
      expect(result.popularityReport.winnerWeights).toHaveLength(6);
      expect(result.popularityReport.rejectedExample.numbers).toEqual([1, 2, 3, 4, 5, 6]);

      // total = wA·bias − wB·popularity
      expect(result.scores.total).toBeCloseTo(
        cfg.weights.wA * result.scores.bias - cfg.weights.wB * result.scores.popularity,
        9
      );

      const row = db.prepare('SELECT * FROM prediction WHERE for_draw_number = ?').get(maxDraw + 1);
      expect(JSON.parse(row.numbers)).toEqual(result.numbers);
      expect(row.mask).toBe(maskFromNumbers(result.numbers));
      expect(row.model_version).toBe(cfg.modelVersion);
      // Task 16 fills the deterministic "dlaczego te liczby" narrative.
      expect(typeof row.commentary).toBe('string');
      expect(row.commentary).toContain(`Typ na losowanie nr ${maxDraw + 1}`);
      expect(row.commentary).toContain('1 : 13 983 816');
      expect(JSON.parse(row.alternatives)).toHaveLength(3);

      // Re-run overwrites in place (ON CONFLICT DO UPDATE) — still a single row.
      await runPrediction(db, cfg);
      const count = db.prepare('SELECT COUNT(*) c FROM prediction').get().c;
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  }, LONG);

  it('predictHook returns a zero-arg async hook that runs a prediction', async () => {
    const db = loadFixtureDb();
    try {
      const hook = predictHook(db, cfg);
      expect(typeof hook).toBe('function');
      await hook();
      const count = db.prepare('SELECT COUNT(*) c FROM prediction').get().c;
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  }, LONG);
});

describe('runPrediction — winner profile on real (fixture) data is sane', () => {
  it('winner sum is 140..220 and at most 2 numbers are <= 31 (wide sanity bounds)', async () => {
    const result = await runPrediction(fixtureDb, cfg);
    const sum = result.numbers.reduce((a, b) => a + b, 0);
    const low = result.numbers.filter((n) => n <= 31).length;
    expect(sum).toBeGreaterThanOrEqual(140);
    expect(sum).toBeLessThanOrEqual(220);
    expect(low).toBeLessThanOrEqual(2);
  }, LONG);

  it('chi2 finds no machine bias on real data (p is high) — component A is neutral', async () => {
    const result = await runPrediction(fixtureDb, cfg);
    expect(result.chi2.p).toBeGreaterThan(cfg.chi2Alpha);
  }, LONG);
});

describe('popularity rank — 1-2-3-4-5-6 sits in the top 0.01% most-popular combos', () => {
  it('its popularity rank (full enumeration) is within the top 0.01%', async () => {
    // A dedicated popularity-only pass: enumerateTopK counts, in one sweep, how many of
    // all C(49,6) combos have popularity strictly greater than 1-2-3-4-5-6. Bias is zeroed
    // (rank is a property of popularity alone), winnerMasks are the fixture's real winners.
    const { params } = buildEnumerationInputs(fixtureDb, cfg);
    const enumParams = { ...params, Z: new Array(49).fill(0) };
    const { popRankGreater } = enumerateTopK(enumParams);
    const rank = popRankGreater + 1;
    const topCut = Math.ceil(TOTAL_COMBOS * 0.0001); // 0.01% = 1399 combos
    // eslint-disable-next-line no-console
    console.log(`[typer-engine] popularity rank of 1-2-3-4-5-6 = #${rank} (top 0.01% cut = ${topCut})`);
    expect(rank).toBeLessThanOrEqual(topCut);
  }, LONG);
});

describe('detectability — planted 1.3x+ bias on number 17 surfaces in the winner', () => {
  it('with wA boosted and a synthetic biased history, the winner contains 17', () => {
    const db = openDatabase(':memory:');
    try {
      // Force number 17 into ~half the draws (a strong, fresh, single-number signal) via a
      // fixed LCG — deterministic fixture. 1500 recent draws dominate the decay window.
      const draws = generateDraws(20260722, 1500, { biasNumber: 17, forceProb: 0.5 });
      insertSyntheticDraws(db, draws);

      // Boost wA so the (planted) bias term dominates the anti-popularity term.
      const boosted = { ...cfg, weights: { wA: 8, wB: 1 } };
      const result = runPredictionSync(db, boosted);
      expect(result.numbers).toContain(17);

      // Sanity: the biased number is the single most-elevated in the bias report.
      expect(result.biasReport[0].number).toBe(17);
      expect(result.chi2.p).toBeLessThan(0.05); // omnibus test also rejects H0
    } finally {
      db.close();
    }
  }, LONG);
});
