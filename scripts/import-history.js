import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/index.js';
import { parseDlFile, validateContinuity } from '../src/server/lib/parse-dl.js';

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

/**
 * Pure (network-free) import: parse dl.txt-formatted `text`, validate draw-number
 * continuity, and — if continuous — insert new draws into `db` in one transaction
 * (existing (game_type, draw_number) rows are left untouched). Always records a
 * row in import_log. Returns a summary object; never throws on malformed input
 * (parseDlFile/validateContinuity are exception-free by contract).
 */
export function importHistory(db, text) {
  const startedAt = Date.now();
  const { draws, errors: parseErrors } = parseDlFile(text);
  const missing = validateContinuity(draws);

  if (missing.length > 0) {
    const finishedAt = Date.now();
    const message =
      `continuity check failed: ${missing.length} missing draw number(s), ` +
      `first missing = ${missing[0]}; ${parseErrors.length} parse error(s); no draws written`;

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
      totalParsed: draws.length,
      parseErrors,
      missing,
      message,
    };
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

  const drawsAdded = insertBatch(rows);
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

  return {
    status: 'ok',
    drawsAdded,
    lastDrawNumber,
    totalParsed: draws.length,
    parseErrors,
    missing: [],
    message,
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
