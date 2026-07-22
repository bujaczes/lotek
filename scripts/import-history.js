import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/index.js';
import { parseDlFile, validateContinuity } from '../src/server/lib/parse-dl.js';
import { rebuildStats } from '../src/server/lib/rebuild-stats.js';

const DEFAULT_URL = 'http://www.mbnet.com.pl/dl.txt';
const SOURCE = 'mbnet';
const GAME_TYPE = 'lotto';

const insertSql = `
  INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
  VALUES (@gameType, @drawNumber, @drawnAt, @n1, @n2, @n3, @n4, @n5, @n6, @mask, @source, @createdAt)
  ON CONFLICT(game_type, draw_number) DO NOTHING
`;

const logSql = `
  INSERT INTO import_log (source, started_at, finished_at, draws_added, last_draw_number, status, message)
  VALUES (@source, @startedAt, @finishedAt, @drawsAdded, @lastDrawNumber, @status, @message)
`;

function writeImportLog(db, entry) {
  db.prepare(logSql).run(entry);
}

function failImport(db, { startedAt, totalParsed, parseErrors, missing, message }) {
  const finishedAt = Date.now();
  writeImportLog(db, {
    source: SOURCE,
    startedAt,
    finishedAt,
    drawsAdded: 0,
    lastDrawNumber: null,
    status: 'failed',
    message,
  });

  return {
    status: 'failed',
    drawsAdded: 0,
    lastDrawNumber: null,
    totalParsed,
    parseErrors,
    missing,
    message,
  };
}

/**
 * Pure (network-free) import: parse dl.txt-formatted `text`, validate draw-number
 * continuity, and — if continuous — insert new draws into `db` in one transaction
 * (existing (game_type, draw_number) rows are left untouched). Always records a
 * row in import_log, on every path: a clean run, a rejected run (no parseable
 * draws, or a numbering gap — both leave the draw table untouched and return a
 * `status: 'failed'` result without throwing), and even a run where the insert
 * transaction itself throws (e.g. disk full, SQLITE_BUSY, a DB-level constraint
 * violation) — in that last case a `status: 'failed'` import_log row is written
 * with the caught error's message before the error is re-thrown, so the audit
 * trail survives even though the caller still sees the exception.
 *
 * After a successful import that added at least one new draw, `rebuildStats(db)` runs
 * to rematerialize `number_stat`/`pair_stat`. A rebuild failure must not corrupt the
 * import that already succeeded and was already logged: it is caught here and reported
 * via the returned `statsRebuild: {status: 'failed', message}` (never thrown, never
 * console-logged — this function stays I/O-pure) instead of raising or rolling back the
 * draw insert. Callers (the CLI `main()` below, or the future scheduler chain in Faza 4)
 * are expected to inspect `statsRebuild` and retry/alert as needed; until that happens,
 * `number_stat`/`pair_stat` are simply stale by the newly-added draws, not wrong or
 * corrupted (they still reflect the last successful rebuild).
 */
export function importHistory(db, text) {
  const startedAt = Date.now();
  const { draws, errors: parseErrors } = parseDlFile(text);
  const missing = validateContinuity(draws);

  if (draws.length === 0 && parseErrors.length > 0) {
    const message = `no draws parsed: ${parseErrors.length} parse error(s), 0 valid lines; no draws written`;
    return failImport(db, { startedAt, totalParsed: 0, parseErrors, missing: [], message });
  }

  if (missing.length > 0) {
    const message =
      `continuity check failed: ${missing.length} missing draw number(s), ` +
      `first missing = ${missing[0]}; ${parseErrors.length} parse error(s); no draws written`;
    return failImport(db, { startedAt, totalParsed: draws.length, parseErrors, missing, message });
  }

  const insert = db.prepare(insertSql);
  const createdAt = Date.now();
  const rows = draws.map((d) => ({
    gameType: GAME_TYPE,
    drawNumber: d.drawNumber,
    drawnAt: d.drawnAt,
    n1: d.numbers[0],
    n2: d.numbers[1],
    n3: d.numbers[2],
    n4: d.numbers[3],
    n5: d.numbers[4],
    n6: d.numbers[5],
    mask: d.mask,
    source: SOURCE,
    createdAt,
  }));

  const insertBatch = db.transaction((batch) => {
    let added = 0;
    for (const row of batch) {
      added += insert.run(row).changes;
    }
    return added;
  });

  let drawsAdded;
  try {
    drawsAdded = insertBatch(rows);
  } catch (err) {
    // The transaction auto-rolls-back the draw table on throw (better-sqlite3
    // semantics), but without this catch the caller loses the audit trail too:
    // record the failure in import_log, then let the error propagate as-is.
    failImport(db, {
      startedAt,
      totalParsed: draws.length,
      parseErrors,
      missing: [],
      message: `insert transaction failed: ${err.message}`,
    });
    throw err;
  }

  const lastDrawNumber = draws.length ? Math.max(...draws.map((d) => d.drawNumber)) : null;
  const finishedAt = Date.now();
  const message = `parsed ${draws.length} draw(s), added ${drawsAdded} new, ${parseErrors.length} parse error(s)`;

  writeImportLog(db, {
    source: SOURCE,
    startedAt,
    finishedAt,
    drawsAdded,
    lastDrawNumber,
    status: 'ok',
    message,
  });

  let statsRebuild = null;
  if (drawsAdded > 0) {
    try {
      const rebuildResult = rebuildStats(db);
      statsRebuild = { status: 'ok', ...rebuildResult };
    } catch (err) {
      // Import already succeeded and is already logged above; a rebuild failure is
      // reported here, not thrown, so it can never roll back or corrupt the import.
      statsRebuild = { status: 'failed', message: err.message };
    }
  }

  return {
    status: 'ok',
    drawsAdded,
    lastDrawNumber,
    totalParsed: draws.length,
    parseErrors,
    missing: [],
    message,
    statsRebuild,
  };
}

function parseArgs(argv) {
  const args = { file: null, db: process.env.DB_PATH || 'db/lotek.db' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--db') args.db = argv[++i];
  }
  return args;
}

async function readInputText(filePath) {
  if (filePath) {
    const buf = readFileSync(filePath);
    return filePath.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  }
  const res = await fetch(DEFAULT_URL);
  if (!res.ok) {
    throw new Error(`failed to download ${DEFAULT_URL}: HTTP ${res.status}`);
  }
  return res.text();
}

async function main() {
  const { file, db: dbPath } = parseArgs(process.argv.slice(2));
  console.log(`[import-history] source: ${file ? file : DEFAULT_URL}`);

  const text = await readInputText(file);
  const db = openDatabase(dbPath);

  try {
    const result = importHistory(db, text);
    console.log(
      `[import-history] status=${result.status} parsed=${result.totalParsed} ` +
        `added=${result.drawsAdded} lastDrawNumber=${result.lastDrawNumber} ` +
        `parseErrors=${result.parseErrors.length}`
    );

    if (result.statsRebuild) {
      if (result.statsRebuild.status === 'ok') {
        console.log(
          `[import-history] stats rebuilt: numberStatRows=${result.statsRebuild.numberStatRows} ` +
            `pairStatRows=${result.statsRebuild.pairStatRows}`
        );
      } else {
        console.error(`[import-history] stats rebuild FAILED: ${result.statsRebuild.message}`);
      }
    }

    if (result.status === 'failed') {
      console.error(`[import-history] FAILED: ${result.message}`);
      if (result.missing.length > 0) {
        console.error(
          `[import-history] missing draw numbers (first 20): ${result.missing.slice(0, 20).join(', ')}`
        );
      }
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error('[import-history] fatal error:', err);
    process.exitCode = 1;
  });
}
