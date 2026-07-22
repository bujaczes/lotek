import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/index.js';
import { rebuildStats } from '../src/server/lib/rebuild-stats.js';

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || 'db/lotek.db' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') args.db = argv[++i];
  }
  return args;
}

function main() {
  const { db: dbPath } = parseArgs(process.argv.slice(2));
  console.log(`[rebuild-stats] db: ${dbPath}`);

  const db = openDatabase(dbPath);
  try {
    const result = rebuildStats(db);
    console.log(
      `[rebuild-stats] gameType=${result.gameType} draws=${result.drawsCount} ` +
        `numberStatRows=${result.numberStatRows} pairStatRows=${result.pairStatRows}`
    );
  } finally {
    db.close();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
