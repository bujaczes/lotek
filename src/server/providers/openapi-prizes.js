import { fetchWithTimeout } from '../lib/fetch-timeout.js';

export const SOURCE = 'openapi-prizes';

const BASE_URL = 'https://developers.lotto.pl/api/open/v1/lotteries/draw-prizes/Lotto';
const API_KEY_HEADER = 'secret';

// API tier key -> hit count (tier I = 6 hits ... tier IV = 3 hits, the same numbering as
// prediction.prize_tier per docs/CONVENTIONS.md).
const TIER_HITS = { 1: 6, 2: 5, 3: 4, 4: 3 };

/**
 * An answer whose shape we do not trust. Thrown for one draw only: the sync logs it and
 * moves on to the next draw, unlike an HTTP/network failure, which stops the whole batch.
 */
export class PrizesShapeError extends Error {}

/**
 * Maps a `draw-prizes/Lotto/{drawNumber}` body (confirmed 2026-09-21, see
 * data/fixtures/openapi-prizes-response.json): a bare array holding a Lotto, a LottoPlus and a
 * SuperSzansa item. Only the Lotto item is read; its `prizes` object maps tier "1".."4" to
 * `{prize: winners, prizeValue: zł per win}`. Amounts come back in grosze.
 *
 * `empty` covers every "the API has nothing (yet)" shape: `prizesEmpty`, an empty `prizes`
 * object, and zero winners in every tier (there are always thousands of trójki in a real
 * draw, so all-zero can only be a not-yet-announced placeholder).
 */
export function mapPrizesResponse(body, drawNumber) {
  if (!Array.isArray(body)) {
    throw new PrizesShapeError(`${SOURCE}: draw ${drawNumber} — response is not an array`);
  }
  const item = body.find((i) => i && typeof i === 'object' && i.gameType === 'Lotto');
  if (!item) {
    throw new PrizesShapeError(`${SOURCE}: draw ${drawNumber} — no 'Lotto' item in response`);
  }
  if (item.drawSystemId !== drawNumber) {
    throw new PrizesShapeError(
      `${SOURCE}: draw ${drawNumber} — Lotto item has drawSystemId ${JSON.stringify(item.drawSystemId)}`
    );
  }

  const { prizes } = item;
  if (item.prizesEmpty === true) return { status: 'empty' };
  if (!prizes || typeof prizes !== 'object') {
    throw new PrizesShapeError(`${SOURCE}: draw ${drawNumber} — missing prizes object`);
  }
  if (Object.keys(prizes).length === 0) return { status: 'empty' };

  const tiers = {};
  for (const [tier, hits] of Object.entries(TIER_HITS)) {
    const entry = prizes[tier];
    if (!entry || typeof entry !== 'object') {
      throw new PrizesShapeError(`${SOURCE}: draw ${drawNumber} — missing tier ${tier}`);
    }
    const { prize, prizeValue } = entry;
    if (!Number.isInteger(prize) || prize < 0) {
      throw new PrizesShapeError(`${SOURCE}: draw ${drawNumber} — tier ${tier} winners: ${JSON.stringify(prize)}`);
    }
    if (typeof prizeValue !== 'number' || !Number.isFinite(prizeValue) || prizeValue < 0) {
      throw new PrizesShapeError(`${SOURCE}: draw ${drawNumber} — tier ${tier} amount: ${JSON.stringify(prizeValue)}`);
    }
    tiers[hits] = { winners: prize, amount: Math.round(prizeValue * 100) };
  }

  if (Object.values(tiers).every((t) => t.winners === 0)) return { status: 'empty' };
  return { status: 'ok', tiers };
}

/**
 * Prizes of one Lotto draw from the official OpenAPI (same key as openapi.js). HTTP 404 is
 * the documented "Nie znaleziono wygranych" and means `empty`; any other non-2xx, a timeout
 * or a network error is a plain Error — the caller treats that as "the API is down right now".
 */
export async function fetchPrizes(drawNumber, { fetchFn = fetch, apiKey = process.env.LOTTO_API_KEY } = {}) {
  if (!apiKey) {
    throw new Error(`${SOURCE}: LOTTO_API_KEY not set`);
  }
  const url = `${BASE_URL}/${drawNumber}`;
  const res = await fetchWithTimeout(fetchFn, url, {
    headers: { [API_KEY_HEADER]: apiKey, Accept: 'application/json' },
  });
  if (res.status === 404) return { status: 'empty' };
  if (!res.ok) {
    throw new Error(`${SOURCE}: HTTP ${res.status} fetching ${url}`);
  }
  return mapPrizesResponse(await res.json(), drawNumber);
}
