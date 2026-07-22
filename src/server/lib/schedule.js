import { loadSchedule } from './config.js';

// Single source of truth: config/schedule.json (Task 13 refactor — this module used to
// hard-code these as plain constants per the Task 6 brief; the scheduler (Task 13) reads
// the same file, so drawDays/drawHour only ever need to change in one place).
const SCHEDULE = loadSchedule();
const TIME_ZONE = SCHEDULE.timeZone;
const DRAW_WEEKDAYS = SCHEDULE.drawDays; // JS Date#getUTCDay() convention: 0=Sun..6=Sat -> Tue/Thu/Sat
const DRAW_HOUR = SCHEDULE.drawHour;
const MAX_DAYS_TO_SCAN = 8; // any starting weekday is at most 7 days from its next match

const PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function partsOf(date) {
  const parts = {};
  for (const { type, value } of PARTS_FORMATTER.formatToParts(date)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts;
}

/**
 * UTC offset (in minutes, east-positive) that TIME_ZONE observes at the instant `date`.
 * Standard technique: format `date` as wall-clock parts in TIME_ZONE, reinterpret those
 * same numbers as if they were UTC, and diff against the real instant.
 */
function offsetMinutesAt(date) {
  const p = partsOf(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - date.getTime()) / 60000;
}

/**
 * Converts a Y-M-D HH:mm:ss wall-clock reading in TIME_ZONE to the UTC instant it
 * denotes. Two-pass fixed point (guess the offset, recompute, re-check) so a wall-clock
 * time that falls near a DST transition still resolves to the offset actually in effect
 * at the resulting instant, not the offset at the naive first guess.
 */
function zonedTimeToUtc(y, m, d, hh, mm, ss) {
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const offset1 = offsetMinutesAt(new Date(utcGuess));
  const candidate1 = new Date(utcGuess - offset1 * 60000);
  const offset2 = offsetMinutesAt(candidate1);
  if (offset2 === offset1) return candidate1;
  return new Date(utcGuess - offset2 * 60000);
}

/**
 * Next Lotto draw slot (Tue/Thu/Sat, `DRAW_HOUR`:00 Europe/Warsaw) strictly after
 * `after`. Pure (no I/O, no `drawNumber` — callers combine the returned Date with
 * `maxDrawNumber + 1` themselves, see `src/server/draws.js`). DST-correct: resolves
 * `after`'s own calendar date/weekday in Europe/Warsaw first (not the raw UTC date),
 * then, for each candidate day, converts that day's local 22:00 wall-clock reading to
 * UTC using the offset actually in effect on that day — so the slot lands on the right
 * side of both the March (CET->CEST) and October (CEST->CET) transitions.
 */
export function nextDrawDate(after) {
  const start = partsOf(after);
  let y = start.year;
  let m = start.month;
  let d = start.day;

  for (let i = 0; i < MAX_DAYS_TO_SCAN; i++) {
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (DRAW_WEEKDAYS.includes(weekday)) {
      const candidate = zonedTimeToUtc(y, m, d, DRAW_HOUR, 0, 0);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
    y = nextDay.getUTCFullYear();
    m = nextDay.getUTCMonth() + 1;
    d = nextDay.getUTCDate();
  }

  // Unreachable: DRAW_WEEKDAYS has 3 entries spread across a 7-day week, so a match is
  // always found within one extra day of scanning past the boundary.
  throw new Error('nextDrawDate: no draw day found within the scan window');
}

/**
 * Most recent draw slot (Tue/Thu/Sat, `DRAW_HOUR`:00 Europe/Warsaw) at or before
 * `beforeOrAt` — the backward mirror of `nextDrawDate`, used by the scheduler's
 * watchdog (Task 13) to find "the last draw that was supposed to have happened by now".
 * Inclusive of the exact instant (unlike `nextDrawDate`'s strict "after"): a watchdog
 * tick that happens to land exactly on a draw slot should treat that slot as already due,
 * not skip back a further two days.
 */
export function previousDrawDate(beforeOrAt) {
  const start = partsOf(beforeOrAt);
  let y = start.year;
  let m = start.month;
  let d = start.day;

  for (let i = 0; i < MAX_DAYS_TO_SCAN; i++) {
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (DRAW_WEEKDAYS.includes(weekday)) {
      const candidate = zonedTimeToUtc(y, m, d, DRAW_HOUR, 0, 0);
      if (candidate.getTime() <= beforeOrAt.getTime()) return candidate;
    }
    const prevDay = new Date(Date.UTC(y, m - 1, d - 1));
    y = prevDay.getUTCFullYear();
    m = prevDay.getUTCMonth() + 1;
    d = prevDay.getUTCDate();
  }

  // Unreachable, same reasoning as nextDrawDate's own throw above.
  throw new Error('previousDrawDate: no draw day found within the scan window');
}

/**
 * `date`'s calendar date in Europe/Warsaw as `YYYY-MM-DD` — matches the TEXT format
 * `draw.drawn_at` is stored in (see CONVENTIONS.md), so watchdog can look up "is there a
 * draw row for the expected slot's date" with a plain string comparison.
 */
export function warsawDateIso(date) {
  const p = partsOf(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
