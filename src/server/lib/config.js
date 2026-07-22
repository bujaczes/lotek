import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/server/lib -> up three levels to the project root, then into config/.
const CONFIG_DIR = join(MODULE_DIR, '..', '..', '..', 'config');
const PRIZES_KEYS = ['3', '4', '5', '6', 'betPrice'];
const SCHEDULE_KEYS = [
  'timeZone',
  'drawDays',
  'drawHour',
  'fetchMinute',
  'retryIntervalMinutes',
  'maxRetryAttempts',
  'reconcileDayOfWeek',
  'reconcileHour',
  'watchdogHour',
  'watchdogStaleHours',
];

/**
 * Fail-loud JSON config reader: throws a clear, specific error (not a bare ENOENT/
 * SyntaxError) when the file is missing or malformed, instead of silently returning
 * undefined/partial config. Path is absolute or relative to cwd (not resolved against
 * CONFIG_DIR) — see loadPrizes() below for the config/-relative convenience wrapper.
 */
export function loadConfigFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`config file not found: ${path} (${err.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`config file is not valid JSON: ${path} (${err.message})`);
  }
}

/**
 * Loads config/prizes.json (prize amounts keyed by HIT COUNT, per the CONVENTIONS
 * correction to SPEC §6.14's tier numbering) and validates every required key is present
 * — fails loud on a missing/malformed file rather than letting `undefined * drawsPlayed`
 * silently produce NaN balances downstream in the wehikuł handler.
 */
export function loadPrizes() {
  const path = join(CONFIG_DIR, 'prizes.json');
  const prizes = loadConfigFile(path);
  for (const key of PRIZES_KEYS) {
    if (!(key in prizes)) throw new Error(`config/prizes.json missing required key: "${key}"`);
  }
  return prizes;
}

/**
 * Loads config/schedule.json (single source of truth for draw days/hours and the
 * scheduler's retry/reconcile/watchdog timing — see `schedule.js` and `scheduler.js`,
 * both of which read through here instead of hard-coding these values). Fails loud on a
 * missing/malformed file or a missing key, same rationale as loadPrizes() above.
 */
export function loadSchedule() {
  const path = join(CONFIG_DIR, 'schedule.json');
  const schedule = loadConfigFile(path);
  for (const key of SCHEDULE_KEYS) {
    if (!(key in schedule)) throw new Error(`config/schedule.json missing required key: "${key}"`);
  }
  return schedule;
}
