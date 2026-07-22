import { mapDrawResultsResponse } from './lotto-response.js';

export const SOURCE = 'lottopl';

const BASE_URL = 'https://www.lotto.pl/api/lotteries/draw-results/by-gametype';

// `index=1` always anchors to the newest draw (confirmed against the real endpoint
// 2026-07-22), so escalating `size` re-fetches from the same anchor further back in
// time rather than paging forward — no offset bookkeeping needed. Escalation is x10
// per attempt (10 -> 100 -> 1000 -> 10000, capped) so a multi-week outage that leaves a
// large gap since `sinceDrawNumber` still gets caught up in a handful of requests,
// while the common case (a few days behind) resolves on the very first, cheapest call.
const START_SIZE = 10;
const SIZE_GROWTH = 10;
const MAX_SIZE = 10000;

/**
 * Fetches every Lotto draw newer than `sinceDrawNumber` from the unofficial
 * www.lotto.pl JSON endpoint, ascending. Throws (does not return an empty/partial
 * array) on any HTTP or shape failure — the provider chain in `index.js` treats a
 * throw as "this provider is down right now" and falls through to the next one.
 */
export async function fetchSince(sinceDrawNumber, { fetchFn = fetch } = {}) {
  let size = START_SIZE;

  for (;;) {
    const url = `${BASE_URL}?game=Lotto&index=1&size=${size}&sort=drawDate&order=DESC`;
    const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`${SOURCE}: HTTP ${res.status} fetching ${url}`);
    }
    const body = await res.json();
    const mapped = mapDrawResultsResponse(body, SOURCE);
    mapped.sort((a, b) => a.drawNumber - b.drawNumber);

    const newOnes = mapped.filter((d) => d.drawNumber > sinceDrawNumber);
    const oldestFetched = mapped.length > 0 ? mapped[0].drawNumber : null;
    // We've gone back far enough once the oldest draw in this page already reaches (or
    // passes) sinceDrawNumber + 1 — any older draw would be <= sinceDrawNumber, which
    // we don't need. `items.length < size` means the API itself ran out of history
    // (fewer draws exist than we asked for) — also a valid stopping point.
    const reachedSince = oldestFetched !== null && oldestFetched <= sinceDrawNumber + 1;
    const reachedBeginning = body.items.length < size;

    if (reachedSince || reachedBeginning || size >= MAX_SIZE) {
      return newOnes;
    }
    size = Math.min(size * SIZE_GROWTH, MAX_SIZE);
  }
}
