const NUMBERS_PER_DRAW = 6;
const MIN_NUMBER = 1;
const MAX_NUMBER = 49;

/**
 * Shared shape mapper for the two Totalizator Sportowy JSON APIs (the unofficial
 * www.lotto.pl/api/lotteries/draw-results/by-gametype and the official
 * developers.lotto.pl/api/open/v1/lotteries/draw-results/by-date-per-game): both were
 * confirmed (2026-07-22, real requests — see data/fixtures/lottopl-response.json) to
 * share the exact same Ideo.Core.App response schema — an envelope `{items: [...]}`
 * where each item is a `DrawResultsGrouped` ({drawSystemId, drawDate, results: [...]})
 * and each `results[]` entry is a `ListItemModel` ({gameType, resultsJson: number[]}).
 *
 * Both endpoints are unofficial-in-spirit (undocumented for lotto.pl, third-party for
 * developers.lotto.pl) and may change shape without notice, so every field is checked
 * before use — an unexpected shape throws a specific, single-item error (caller/chain
 * logs it and moves on) instead of silently producing a garbage draw.
 */
export function mapDrawResultsItem(item, source) {
  if (!item || typeof item !== 'object') {
    throw new Error(`${source}: malformed item (not an object): ${JSON.stringify(item)}`);
  }

  const drawNumber = item.drawSystemId;
  if (!Number.isInteger(drawNumber) || drawNumber <= 0) {
    throw new Error(`${source}: malformed item — invalid drawSystemId: ${JSON.stringify(item.drawSystemId)}`);
  }

  const drawDate = item.drawDate;
  if (typeof drawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(drawDate)) {
    throw new Error(`${source}: draw ${drawNumber} — invalid drawDate: ${JSON.stringify(drawDate)}`);
  }
  const drawnAt = drawDate.slice(0, 10);

  const results = Array.isArray(item.results) ? item.results : null;
  if (!results) {
    throw new Error(`${source}: draw ${drawNumber} — missing or non-array results[]`);
  }
  const lottoResult = results.find((r) => r && r.gameType === 'Lotto');
  if (!lottoResult) {
    throw new Error(`${source}: draw ${drawNumber} — no 'Lotto' entry in results[]`);
  }

  const raw = lottoResult.resultsJson;
  const numbersOk =
    Array.isArray(raw) &&
    raw.length === NUMBERS_PER_DRAW &&
    raw.every((n) => Number.isInteger(n) && n >= MIN_NUMBER && n <= MAX_NUMBER);
  if (!numbersOk) {
    throw new Error(`${source}: draw ${drawNumber} — resultsJson is not ${NUMBERS_PER_DRAW} integers in ${MIN_NUMBER}-${MAX_NUMBER}: ${JSON.stringify(raw)}`);
  }

  const numbers = [...raw].sort((a, b) => a - b);
  if (new Set(numbers).size !== NUMBERS_PER_DRAW) {
    throw new Error(`${source}: draw ${drawNumber} — duplicate numbers in resultsJson: ${JSON.stringify(raw)}`);
  }

  return { drawNumber, drawnAt, numbers, source };
}

/**
 * Maps a full `{items: [...]}` envelope, throwing a clear error (not a TypeError) when
 * `items` itself is missing or not an array — the one shape check every caller needs
 * before it can even iterate.
 */
export function mapDrawResultsResponse(body, source) {
  if (!body || !Array.isArray(body.items)) {
    throw new Error(`${source}: malformed response — missing items[] array`);
  }
  return body.items.map((item) => mapDrawResultsItem(item, source));
}
