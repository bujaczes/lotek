const insertDrawSql = `
  INSERT INTO draw (game_type, draw_number, drawn_at, n1, n2, n3, n4, n5, n6, mask, source, created_at)
  VALUES (@gameType, @drawNumber, @drawnAt, @n1, @n2, @n3, @n4, @n5, @n6, @mask, @source, @createdAt)
  ON CONFLICT(game_type, draw_number) DO NOTHING
`;

const importLogSql = `
  INSERT INTO import_log (source, started_at, finished_at, draws_added, last_draw_number, status, message)
  VALUES (@source, @startedAt, @finishedAt, @drawsAdded, @lastDrawNumber, @status, @message)
`;

/**
 * Shared write path for both `scripts/import-history.js` (bulk dl.txt bootstrap) and
 * `src/server/lib/fetch-latest.js` (incremental provider-chain catch-up): identical
 * `draw` row shape and identical `import_log` shape, so both callers prepare/insert
 * through here instead of keeping two copies of the same SQL in sync.
 */
export function prepareInsertDraw(db) {
  return db.prepare(insertDrawSql);
}

export function writeImportLog(db, entry) {
  db.prepare(importLogSql).run(entry);
}
