import { createApp } from './src/server/app.js';
import { openDatabase } from './db/index.js';
import { startScheduler, shouldStartScheduler } from './src/server/lib/scheduler.js';

const PORT = process.env.PORT || 3005;
const DB_PATH = process.env.DB_PATH || 'db/lotek.db';

const db = openDatabase(DB_PATH);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`LOTEK API listening on port ${PORT}`);
});

if (shouldStartScheduler({ nodeEnv: process.env.NODE_ENV, schedulerEnabled: process.env.SCHEDULER_ENABLED })) {
  const scheduler = startScheduler(db);
  console.log(`[scheduler] fetch-cycle next run: ${scheduler.jobs.fetch.nextRun()?.toISOString()}`);
  console.log(`[scheduler] reconcile next run: ${scheduler.jobs.reconcile.nextRun()?.toISOString()}`);
  console.log(`[scheduler] watchdog next run: ${scheduler.jobs.watchdog.nextRun()?.toISOString()}`);
} else {
  console.log('[scheduler] disabled (NODE_ENV=test or SCHEDULER_ENABLED=0)');
}
