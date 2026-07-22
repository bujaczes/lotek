import { nextDrawDate } from '../lib/schedule.js';
import { mapDrawResultsResponse } from './lotto-response.js';

export const SOURCE = 'openapi';

const BASE_URL = 'https://developers.lotto.pl/api/open/v1/lotteries/draw-results/by-date-per-game';

// Real shape confirmed 2026-07-22 against the published spec at
// https://developers.lotto.pl/swagger/open-api-v1/swagger.json (no key required to read
// the spec itself, only to call the endpoint): same Pagination<DrawResultsGrouped>
// envelope as the unofficial lotto.pl endpoint, `secret` request header for the key.
const API_KEY_HEADER = 'secret';

// Hard cap on how many scheduled draw dates we'll scan forward from `sinceDrawnAt` in
// one call — about 7 weeks of Tue/Thu/Sat draws. A real gap this size means something
// else is badly wrong (the scheduler has been down for weeks); bounding the loop keeps
// a bad `now`/`sinceDrawnAt` pairing (e.g. in a test) from spinning forever instead of
// throwing.
const MAX_DATES_TO_SCAN = 20;

const WARSAW_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// en-CA renders Intl dates as YYYY-MM-DD, which is exactly the ISO calendar-date string
// both this module's `drawDate` query param and the DB's `drawn_at` column expect.
function warsawDateStr(date) {
  return WARSAW_DATE_FORMATTER.format(date);
}

/**
 * Fetches every Lotto draw newer than `sinceDrawNumber` from the official
 * developers.lotto.pl OpenAPI, ascending. Self-disables (throws immediately, before any
 * network call) when `LOTTO_API_KEY` is not set — the provider chain in `index.js`
 * treats that throw exactly like a down provider and falls through to lotto.pl/mbnet,
 * so an env without the key is not a hard failure for the caller.
 *
 * Unlike lottopl.js/mbnet.js this endpoint is queried per calendar date, not by
 * `sinceDrawNumber` range, so it needs to know which dates to ask for: `sinceDrawnAt`
 * (the ISO date of the last known draw, `YYYY-MM-DD`) seeds a walk forward through the
 * Tue/Thu/Sat schedule (`nextDrawDate`, `schedule.js`) up to `now()`. Without
 * `sinceDrawnAt` there is no safe way to know where to start scanning, so this throws
 * too (same "skip this provider" effect) rather than guessing.
 */
export async function fetchSince(
  sinceDrawNumber,
  { fetchFn = fetch, now = () => new Date(), sinceDrawnAt, apiKey = process.env.LOTTO_API_KEY } = {}
) {
  if (!apiKey) {
    throw new Error(`${SOURCE}: LOTTO_API_KEY not set, provider disabled`);
  }
  if (!sinceDrawnAt) {
    throw new Error(`${SOURCE}: sinceDrawnAt is required to know which draw dates to scan`);
  }

  const nowInstant = now();
  const dates = [];
  // Seeded at 23:59:59 UTC of `sinceDrawnAt`'s calendar date — always later than that
  // date's actual Warsaw 22:00 draw instant (20:00 or 21:00 UTC depending on DST) —
  // so `nextDrawDate` rolls straight to the *next* scheduled date instead of
  // re-returning the already-known one.
  let cursor = new Date(`${sinceDrawnAt}T23:59:59Z`);
  for (let i = 0; i < MAX_DATES_TO_SCAN; i++) {
    const next = nextDrawDate(cursor);
    if (next.getTime() > nowInstant.getTime()) break;
    dates.push(next);
    cursor = next;
  }

  const draws = [];
  for (const date of dates) {
    const isoDate = warsawDateStr(date);
    const url = `${BASE_URL}?gameType=Lotto&drawDate=${isoDate}&index=1&size=10&sort=drawDate&order=DESC`;
    const res = await fetchFn(url, { headers: { [API_KEY_HEADER]: apiKey, Accept: 'application/json' } });
    if (res.status === 404) continue; // no result published yet for that date
    if (!res.ok) {
      throw new Error(`${SOURCE}: HTTP ${res.status} fetching ${url}`);
    }
    const body = await res.json();
    for (const mapped of mapDrawResultsResponse(body, SOURCE)) {
      if (mapped.drawNumber > sinceDrawNumber) draws.push(mapped);
    }
  }

  const byDrawNumber = new Map(draws.map((d) => [d.drawNumber, d])); // defensive de-dup
  return [...byDrawNumber.values()].sort((a, b) => a.drawNumber - b.drawNumber);
}
