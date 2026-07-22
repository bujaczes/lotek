import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/index.js';
import { fetchLatest } from '../src/server/lib/fetch-latest.js';

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || 'db/lotek.db' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') args.db = argv[++i];
  }
  return args;
}

async function main() {
  const { db: dbPath } = parseArgs(process.argv.slice(2));
  console.log(`[fetch-latest] db: ${dbPath}`);

  const db = openDatabase(dbPath);
  try {
    const result = await fetchLatest(db);
    console.log(
      `[fetch-latest] status=${result.status} provider=${result.provider} ` +
        `added=${result.added} lastNumber=${result.lastNumber}`
    );
    if (result.status === 'partial') {
      console.error('[fetch-latest] PARTIAL: a numbering gap was found after the DB\'s last draw; see import_log');
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error('[fetch-latest] fatal error:', err);
    process.exitCode = 1;
  });
}
