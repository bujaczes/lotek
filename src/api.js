// Thin fetch wrapper around the JSON API. Vite proxies /api -> :3005 in dev;
// in production the same origin serves it. Throws ApiError on non-2xx so views
// can render a real failure state instead of silently rendering undefined.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiGet(path, { signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, { headers: { accept: 'application/json' }, signal });
  } catch (cause) {
    throw new ApiError('Brak połączenia z serwerem.', 0);
  }
  if (!res.ok) {
    throw new ApiError(`Serwer zwrócił błąd ${res.status}.`, res.status);
  }
  return res.json();
}

async function apiPost(path, body, { signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    throw new ApiError('Brak połączenia z serwerem.', 0);
  }
  if (!res.ok) {
    throw new ApiError(`Serwer zwrócił błąd ${res.status}.`, res.status);
  }
  return res.json();
}

export const getLatestDraw = (opts) => apiGet('/draws/latest', opts);
export const getDraw = (nr, opts) => apiGet(`/draws/${nr}`, opts);
// { page, perPage, total, totalPages, draws: [{ drawNumber, date, numbers, sum }] }.
export const getDraws = (query = {}, opts) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return apiGet(`/draws${qs ? `?${qs}` : ''}`, opts);
};
// { numbers, hits, occurrences, balance, prizes, disclaimer }.
export const postWehikul = (numbers, opts) => apiPost('/wehikul', { numbers }, opts);
export const getNumberCareer = (n, opts) => apiGet(`/numbers/${n}`, opts);
// Bare array of 49 entries { number, total, last50, last100, currentGap, zScore, lastDrawnAt }.
export const getBlanketStats = (opts) => apiGet('/stats/blanket', opts);
// { hot, cold } x { all, last100, currentYear } x 10 entries { number, count, zScore }.
export const getRankingsStats = (opts) => apiGet('/stats/rankings', opts);

// --- /statystyki ---------------------------------------------------------
// { histogram, theoretical, lastSum, percentile, sector }.
export const getSumsStats = (opts) => apiGet('/stats/sums', opts);
// { dates, points } — points are [drawIndex, number], ~44k of them.
export const getCarpetStats = (opts) => apiGet('/stats/carpet', opts);
// { even, low } x 7 rows { k, empiricalCount, empiricalShare, theoretical }.
export const getStructureStats = (opts) => apiGet('/stats/structure', opts);
// { pairs, triples } — top 15 each, with cnt/expected/lift.
export const getPairsStats = (opts) => apiGet('/stats/pairs', opts);
// { empiricalShare, theoretical, draws }.
export const getConsecutiveStats = (opts) => apiGet('/stats/consecutive', opts);
// { empiricalShare, theoretical, comparedDraws }.
export const getRepeatsStats = (opts) => apiGet('/stats/repeats', opts);
// { groups, expectedCollisions }.
export const getDuplicateSixesStats = (opts) => apiGet('/stats/duplicate-sixes', opts);
// { maxSum, minSum, longestRun, longestDrought, recordAbsence, birthdayness }.
export const getRecordsStats = (opts) => apiGet('/stats/records', opts);
