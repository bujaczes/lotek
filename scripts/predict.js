import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/index.js';
import { loadTyperConfig } from '../src/server/lib/typer/config.js';
import { runPrediction } from '../src/server/lib/typer/engine.js';

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || 'db/lotek.db' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') args.db = argv[++i];
  }
  return args;
}

async function main() {
  const { db: dbPath } = parseArgs(process.argv.slice(2));
  console.log(`[predict] db: ${dbPath}`);

  const db = openDatabase(dbPath);
  const cfg = loadTyperConfig();
  try {
    const result = await runPrediction(db, cfg);
    const { forDrawNumber, numbers, scores, chi2, timing } = result;
    console.log(`[predict] for draw #${forDrawNumber}: ${numbers.join(', ')}`);
    console.log(
      `[predict] scores: bias=${scores.bias.toFixed(4)} ` +
        `popularity=${scores.popularity.toFixed(4)} total=${scores.total.toFixed(4)}`
    );
    console.log(`[predict] chi2: stat=${chi2.stat.toFixed(3)} df=${chi2.df} p=${chi2.p.toFixed(4)}`);
    console.log(
      `[predict] alternatives: ${result.alternatives.map((a) => a.numbers.join('-')).join('  |  ')}`
    );
    console.log(
      `[predict] rank of ${result.popularityReport.rejectedExample.numbers.join('-')} ` +
        `by popularity: #${result.popularityReport.rejectedExample.rank}`
    );
    console.log(
      `[predict] enumeration: ${timing.combosProcessed.toLocaleString('en-US')} combos in ` +
        `${(timing.enumerationMs / 1000).toFixed(2)}s (wall ${(timing.wallMs / 1000).toFixed(2)}s)`
    );
  } finally {
    db.close();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error('[predict] fatal error:', err);
    process.exitCode = 1;
  });
}

export { main };
