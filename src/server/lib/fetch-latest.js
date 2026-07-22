import { fetchSince as chainFetchSince, defaultProviderChain } from '../providers/index.js';
import { maskFromNumbers } from './mask.js';
import { rebuildStats } from './rebuild-stats.js';

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

function lastKnownDraw(db) {
  return db
    .prepare(
      `SELECT draw_number AS drawNumber, drawn_at AS drawnAt
       FROM draw WHERE game_type = ? ORDER BY draw_number DESC LIMIT 1`
    )
    .get(GAME_TYPE);
}

/**
 * Splits `draws` (any ascending array of `{drawNumber, ...}`) into the leading run that
 * continues `sinceDrawNumber` without a gap (sinceDrawNumber+1, +2, +3, ...) and
 * everything after the first break. Only the prefix is ever safe to import — numbering
 * must stay contiguous 1..MAX per CONVENTIONS.md, so a provider that skips ahead (its
 * next few draws are missing, e.g. a stale cache) must not have its later draws
 * silently imported over the hole.
 */
function contiguousPrefix(draws, sinceDrawNumber) {
  const prefix = [];
  let expected = sinceDrawNumber + 1;
  for (const d of draws) {
    if (d.drawNumber !== expected) break;
    prefix.push(d);
    expected += 1;
  }
  return prefix;
}

/**
 * Asks the provider chain for every draw newer than the DB's current max, imports the
 * contiguous prefix of what comes back (see `contiguousPrefix`) in one transaction,
 * records an `import_log` row on every path (mirrors `scripts/import-history.js`), and
 * — only when at least one draw was actually added — rebuilds `number_stat`/`pair_stat`
 * (which invalidates the response cache internally, see `rebuild-stats.js`).
 *
 * Returns `{status, added, lastNumber, provider}`:
 *   - `status: 'ok'` — every new draw the winning provider returned was contiguous and
 *     got imported (this includes the "nothing new" case: `added: 0`, unchanged
 *     `lastNumber`, no rebuild).
 *   - `status: 'partial'` — the winning provider's results had a gap right after the
 *     DB's last draw (0 draws importable) or partway through (some draws importable);
 *     `import_log.status` is `'partial'` either way so a human/alert can investigate.
 *   - Throws (after writing a `status: 'failed'` import_log row) when every provider in
 *     the chain fails, or when the insert transaction itself throws.
 */
export async function fetchLatest(db, { providers, fetchFn = fetch, now = () => new Date() } = {}) {
  const startedAt = Date.now();
  const last = lastKnownDraw(db);
  const sinceDrawNumber = last ? last.drawNumber : 0;
  const sinceDrawnAt = last ? last.drawnAt : null;

  const chain = providers ?? defaultProviderChain();

  let winner;
  try {
    winner = await chainFetchSince(sinceDrawNumber, { fetchFn, now, sinceDrawnAt, providers: chain });
  } catch (err) {
    writeImportLog(db, {
      source: null,
      startedAt,
      finishedAt: Date.now(),
      drawsAdded: 0,
      lastDrawNumber: sinceDrawNumber || null,
      status: 'failed',
      message: `all providers failed: ${err.message}`,
    });
    throw err;
  }

  const { draws: candidates, provider } = winner;
  const prefix = contiguousPrefix(candidates, sinceDrawNumber);
  const isPartial = prefix.length < candidates.length;

  const insert = db.prepare(insertSql);
  const createdAt = Date.now();
  const rows = prefix.map((d) => ({
    gameType: GAME_TYPE,
    drawNumber: d.drawNumber,
    drawnAt: d.drawnAt,
    n1: d.numbers[0],
    n2: d.numbers[1],
    n3: d.numbers[2],
    n4: d.numbers[3],
    n5: d.numbers[4],
    n6: d.numbers[5],
    mask: maskFromNumbers(d.numbers),
    source: provider,
    createdAt,
  }));

  const insertBatch = db.transaction((batch) => {
    let added = 0;
    for (const row of batch) {
      added += insert.run(row).changes;
    }
    return added;
  });

  let added;
  try {
    added = rows.length > 0 ? insertBatch(rows) : 0;
  } catch (err) {
    writeImportLog(db, {
      source: provider,
      startedAt,
      finishedAt: Date.now(),
      drawsAdded: 0,
      lastDrawNumber: sinceDrawNumber || null,
      status: 'failed',
      message: `insert transaction failed: ${err.message}`,
    });
    throw err;
  }

  const lastNumber = added > 0 ? sinceDrawNumber + added : sinceDrawNumber;
  const status = isPartial ? 'partial' : 'ok';
  const message = isPartial
    ? `provider ${provider} returned ${candidates.length} draw(s) with a gap after draw ${sinceDrawNumber}; ` +
      `imported contiguous prefix of ${added}`
    : `provider ${provider} returned ${candidates.length} new draw(s), added ${added}`;

  writeImportLog(db, {
    source: provider,
    startedAt,
    finishedAt: Date.now(),
    drawsAdded: added,
    lastDrawNumber: lastNumber || null,
    status,
    message,
  });

  if (added > 0) {
    rebuildStats(db, { gameType: GAME_TYPE });
  }

  return { status, added, lastNumber, provider };
}
