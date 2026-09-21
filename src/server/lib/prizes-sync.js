import { fetchPrizes as defaultFetchPrizes, PrizesShapeError } from '../providers/openapi-prizes.js';
import { selectDrawsNeedingPrizes, upsertPrizes } from './prize-store.js';
import { invalidateCache } from './cache.js';

// Clear the response cache after the first new result (so the latest draw shows its prizes
// right away) and then every this many, instead of after each of ~2 360 backfilled rows.
const INVALIDATE_EVERY = 50;

/**
 * One batch: fetches prizes for every draw that is still `pending` (see prize-store.js),
 * newest first, `throttleMs` apart, saving each result as it lands so an interrupted batch
 * keeps its progress. An HTTP/network error stops the batch — the API is either rate
 * limiting or down, and hammering it helps neither — while a malformed answer only skips
 * that one draw (no row is written, so the next batch tries it again).
 *
 * Without `LOTTO_API_KEY` it returns `{disabled: true}` without touching the network, so a
 * local dev server never loops on "no key" errors.
 */
export async function syncPrizes(db, options = {}) {
  const {
    fetchPrizesFn = defaultFetchPrizes,
    fetchFn = fetch,
    apiKey = process.env.LOTTO_API_KEY,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    throttleMs = 1000,
    limit = Infinity,
    now = () => new Date(),
    log = (message) => console.warn(message),
    invalidate = invalidateCache,
  } = options;

  const summary = { checked: 0, ok: 0, empty: 0, skipped: 0, stopped: false };
  if (!apiKey) return { ...summary, disabled: true };

  const pending = selectDrawsNeedingPrizes(db, { now: now() }).slice(0, limit);

  for (let i = 0; i < pending.length; i++) {
    const drawNumber = pending[i];
    if (i > 0) await sleep(throttleMs);

    let result;
    try {
      result = await fetchPrizesFn(drawNumber, { fetchFn, apiKey });
    } catch (err) {
      if (err instanceof PrizesShapeError) {
        log(`[prizes] draw ${drawNumber} skipped: ${err.message}`);
        summary.skipped += 1;
        continue;
      }
      summary.stopped = true;
      summary.error = err.message;
      break;
    }

    upsertPrizes(db, drawNumber, result, now().getTime());
    summary.checked += 1;
    if (result.status === 'ok') {
      summary.ok += 1;
      if (summary.ok === 1 || summary.ok % INVALIDATE_EVERY === 0) invalidate();
    } else {
      summary.empty += 1;
    }
  }

  if (summary.ok > 1 && summary.ok % INVALIDATE_EVERY !== 0) invalidate();
  if (pending.length > 0) {
    log(
      `[prizes] sync: ${summary.checked}/${pending.length} checked, ok ${summary.ok}, ` +
        `empty ${summary.empty}, skipped ${summary.skipped}` +
        (summary.stopped ? `, stopped: ${summary.error}` : '')
    );
  }
  return summary;
}
