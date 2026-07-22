import { Cron } from 'croner';
import { fetchLatest } from './fetch-latest.js';
import { evaluatePredictions } from './evaluate.js';
import { decideRetry } from './retry-decision.js';
import { loadSchedule } from './config.js';
import { previousDrawDate, warsawDateIso } from './schedule.js';
import { writeImportLog } from './draw-writer.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import { parseDlFile } from './parse-dl.js';
import { DEFAULT_URL as MBNET_DEFAULT_URL } from '../providers/mbnet.js';

const GAME_TYPE = 'lotto';

// Single source of truth (config/schedule.json), read once at module load — same
// pattern as schedule.js. All the functions below accept a `scheduleConfig` override
// for tests; production call sites always get this one.
const SCHEDULE = loadSchedule();

/**
 * One fetch-and-evaluate cycle: ask the provider chain (via `fetchLatestFn`, defaulting
 * to the real `fetchLatest`) for new draws. If any landed (`added > 0`), run
 * `evaluateFn` (defaulting to the real `evaluatePredictions`) and then the optional
 * `hooks.predict?.()` (Typer wires in during Faza 5; no hook = no-op, never an error).
 *
 * If nothing new landed, retry every `retryIntervalMs` (default: config's
 * `retryIntervalMinutes`, in ms) up to `maxRetryAttempts` (default: config's
 * `maxRetryAttempts`) times, per the pure `decideRetry` decision — never croner, so this
 * whole function runs identically whether `scheduleRetry` is a real `setTimeout` (prod)
 * or an injected synchronous/fake-timer stand-in (tests). Once retries are exhausted,
 * writes a single `import_log` `failed` row ("brak wyniku do 00:05") and returns.
 *
 * Returns `fetchLatest`'s own result shape plus `attempts` (total `fetchLatestFn` calls
 * made, 1-indexed) and, when exhausted, `exhausted: true`.
 */
export async function runFetchCycle(db, options = {}) {
  const {
    hooks = {},
    providers,
    fetchFn,
    now = () => new Date(),
    fetchLatestFn = fetchLatest,
    evaluateFn = evaluatePredictions,
    scheduleRetry = (fn, delayMs) => setTimeout(fn, delayMs),
    scheduleConfig = SCHEDULE,
  } = options;

  const maxAttempts = options.maxRetryAttempts ?? scheduleConfig.maxRetryAttempts;
  const intervalMs = options.retryIntervalMs ?? scheduleConfig.retryIntervalMinutes * 60000;

  async function attempt(attemptCount) {
    const result = await fetchLatestFn(db, { providers, fetchFn, now });

    if (result.added > 0) {
      evaluateFn(db);
      await hooks.predict?.();
      return { ...result, attempts: attemptCount + 1 };
    }

    const decision = decideRetry({ attempt: attemptCount, maxAttempts });
    if (decision.action === 'retry') {
      return new Promise((resolve, reject) => {
        scheduleRetry(() => {
          attempt(decision.nextAttempt).then(resolve, reject);
        }, intervalMs);
      });
    }

    writeImportLog(db, {
      source: null,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      drawsAdded: 0,
      lastDrawNumber: result.lastNumber ?? null,
      status: 'failed',
      message: 'brak wyniku do 00:05',
    });
    return { ...result, attempts: attemptCount + 1, exhausted: true };
  }

  return attempt(0);
}

function buildReconcileMessage(missing, divergent) {
  const parts = [];
  if (missing.length > 0) {
    parts.push(`brakujące (${missing.length}): #${missing.slice(0, 5).join(', #')}`);
  }
  if (divergent.length > 0) {
    const sample = divergent
      .slice(0, 3)
      .map((d) => `#${d.drawNumber} baza=${d.db.join(',')} mbnet=${d.mbnet.join(',')}`)
      .join('; ');
    parts.push(`rozbieżne (${divergent.length}): ${sample}`);
  }
  return parts.join('; ');
}

/**
 * Weekly safety net (Sunday 08:00): downloads the *complete* mbnet dl.txt (never
 * paginated, unlike the incremental providers) and diffs it against every draw
 * currently in `db`. Report-only, by design: a missing or divergent row is never
 * auto-inserted or auto-corrected here — that would risk silently overwriting a
 * legitimately-sourced row on a transient mbnet glitch. Always writes one `import_log`
 * row: `ok` + "0 rozjazdów" when the two agree everywhere dl.txt has data, `partial`
 * with a short summary otherwise. Draws present only in the DB (newer than mbnet, which
 * is known to lag real draws by days — see Task 12) are not a divergence.
 */
export async function reconcile(db, { fetchFn = fetch, url = MBNET_DEFAULT_URL, gameType = GAME_TYPE } = {}) {
  const startedAt = Date.now();

  let text;
  try {
    const res = await fetchWithTimeout(fetchFn, url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    text = await res.text();
  } catch (err) {
    writeImportLog(db, {
      source: 'mbnet',
      startedAt,
      finishedAt: Date.now(),
      drawsAdded: 0,
      lastDrawNumber: null,
      status: 'failed',
      message: `reconcile: fetch failed: ${err.message}`,
    });
    throw err;
  }

  const { draws } = parseDlFile(text);
  const dbRows = db
    .prepare(`SELECT draw_number AS drawNumber, n1, n2, n3, n4, n5, n6 FROM draw WHERE game_type = ?`)
    .all(gameType);
  const dbByNumber = new Map(dbRows.map((r) => [r.drawNumber, [r.n1, r.n2, r.n3, r.n4, r.n5, r.n6]]));

  const missing = [];
  const divergent = [];
  for (const d of draws) {
    const dbNumbers = dbByNumber.get(d.drawNumber);
    if (!dbNumbers) {
      missing.push(d.drawNumber);
    } else if (dbNumbers.join(',') !== d.numbers.join(',')) {
      divergent.push({ drawNumber: d.drawNumber, db: dbNumbers, mbnet: d.numbers });
    }
  }

  const status = missing.length === 0 && divergent.length === 0 ? 'ok' : 'partial';
  const message = status === 'ok' ? '0 rozjazdów' : buildReconcileMessage(missing, divergent);

  writeImportLog(db, {
    source: 'mbnet',
    startedAt,
    finishedAt: Date.now(),
    drawsAdded: 0,
    lastDrawNumber: draws.length ? draws[draws.length - 1].drawNumber : null,
    status,
    message,
  });

  return { status, checked: draws.length, missing, divergent };
}

/**
 * Daily 12:00 check: is the last draw slot that was supposed to have happened by now
 * (`previousDrawDate`, from `schedule.js`) more than `watchdogStaleHours` in the past
 * with still no matching `draw` row? If so, writes an `import_log` `failed` row
 * ("watchdog: brak losowania") — this is the safety net for "the whole fetch cycle
 * silently never ran" (crashed process, host down over a draw night, etc.), independent
 * of `runFetchCycle`'s own retry/failure logging.
 */
export function runWatchdog(db, { now = () => new Date(), scheduleConfig = SCHEDULE, gameType = GAME_TYPE } = {}) {
  const nowDate = now();
  const expected = previousDrawDate(nowDate);
  const ageHours = (nowDate.getTime() - expected.getTime()) / 3600000;
  const expectedDateIso = warsawDateIso(expected);

  if (ageHours < scheduleConfig.watchdogStaleHours) {
    return { status: 'skipped', expectedDateIso, ageHours };
  }

  const row = db.prepare(`SELECT 1 FROM draw WHERE game_type = ? AND drawn_at = ?`).get(gameType, expectedDateIso);
  if (row) {
    return { status: 'ok', expectedDateIso, ageHours };
  }

  writeImportLog(db, {
    source: null,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    drawsAdded: 0,
    lastDrawNumber: null,
    status: 'failed',
    message: 'watchdog: brak losowania',
  });
  return { status: 'failed', expectedDateIso, ageHours };
}

/**
 * Pure gate for server.js: the scheduler must never start under `NODE_ENV=test` (tests
 * that boot `createApp`/`server.js`-adjacent code must never race a real croner job
 * against an in-memory DB that gets torn down at the end of the test), and can always be
 * force-disabled with `SCHEDULER_ENABLED=0` (e.g. for a one-off manual `node server.js`
 * debugging session). Extracted as a pure function so this policy is unit-testable
 * without actually importing/booting server.js (which has real `app.listen`/DB-open side
 * effects).
 */
export function shouldStartScheduler({ nodeEnv, schedulerEnabled }) {
  if (nodeEnv === 'test') return false;
  if (schedulerEnabled === '0') return false;
  return true;
}

/**
 * Wires the three cron jobs (fetch cycle: Tue/Thu/Sat `fetchMinute` past `drawHour`;
 * reconcile: `reconcileDayOfWeek` at `reconcileHour`:00; watchdog: daily at
 * `watchdogHour`:00 — all Europe/Warsaw, all from config/schedule.json) via `CronImpl`
 * (croner's `Cron` by default; tests inject a fake to inspect the registered
 * pattern/options without any real timers).
 *
 * In-process overlap guard: a boolean flag, not croner's own `protect` option — the
 * brief calls for this explicitly, and it also has to span `runFetchCycle`'s retry loop
 * (which can itself take up to ~2h across up to 12 retries), not just a single croner
 * tick. A trigger that arrives while a fetch cycle is still in flight is skipped with a
 * console.warn, not queued — the next scheduled cron tick (or a future manual trigger)
 * picks it back up naturally.
 *
 * Returns `{jobs, stop, triggerFetchCycle, triggerReconcile, triggerWatchdog}` —
 * `trigger*` are the same guarded functions the cron jobs call, exposed for manual/admin
 * use and for tests (this is how the overlap guard gets exercised without waiting on a
 * real cron tick).
 */
export function startScheduler(db, options = {}) {
  const {
    hooks = {},
    providers,
    fetchFn,
    now = () => new Date(),
    scheduleConfig = SCHEDULE,
    CronImpl = Cron,
    runFetchCycleFn = runFetchCycle,
    reconcileFn = reconcile,
    watchdogFn = runWatchdog,
  } = options;

  let cycleRunning = false;

  async function triggerFetchCycle() {
    if (cycleRunning) {
      console.warn('[scheduler] fetch cycle already in progress, skipping this trigger');
      return;
    }
    cycleRunning = true;
    try {
      return await runFetchCycleFn(db, { hooks, providers, fetchFn, now, scheduleConfig });
    } catch (err) {
      console.error('[scheduler] fetch cycle failed:', err.message);
    } finally {
      cycleRunning = false;
    }
  }

  async function triggerReconcile() {
    try {
      return await reconcileFn(db, { fetchFn });
    } catch (err) {
      console.error('[scheduler] reconcile failed:', err.message);
    }
  }

  async function triggerWatchdog() {
    try {
      return await watchdogFn(db, { now, scheduleConfig });
    } catch (err) {
      console.error('[scheduler] watchdog failed:', err.message);
    }
  }

  const drawDowList = scheduleConfig.drawDays.join(',');
  const fetchJob = new CronImpl(
    `${scheduleConfig.fetchMinute} ${scheduleConfig.drawHour} * * ${drawDowList}`,
    { timezone: scheduleConfig.timeZone, name: 'lotek-fetch-cycle' },
    triggerFetchCycle
  );
  const reconcileJob = new CronImpl(
    `0 ${scheduleConfig.reconcileHour} * * ${scheduleConfig.reconcileDayOfWeek}`,
    { timezone: scheduleConfig.timeZone, name: 'lotek-reconcile' },
    triggerReconcile
  );
  const watchdogJob = new CronImpl(
    `0 ${scheduleConfig.watchdogHour} * * *`,
    { timezone: scheduleConfig.timeZone, name: 'lotek-watchdog' },
    triggerWatchdog
  );

  return {
    jobs: { fetch: fetchJob, reconcile: reconcileJob, watchdog: watchdogJob },
    stop() {
      fetchJob.stop();
      reconcileJob.stop();
      watchdogJob.stop();
    },
    triggerFetchCycle,
    triggerReconcile,
    triggerWatchdog,
  };
}
