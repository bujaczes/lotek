import { parseDlFile } from '../lib/parse-dl.js';
import { fetchWithTimeout } from '../lib/fetch-timeout.js';

export const SOURCE = 'mbnet';

const DEFAULT_URL = 'http://www.mbnet.com.pl/dl.txt';

/**
 * Fetches every Lotto draw newer than `sinceDrawNumber` from mbnet's dl.txt, ascending.
 * Unlike lottopl.js/openapi.js this is never a partial/paged query: dl.txt is always
 * the *complete* history in one file (the brief's "działa też jako źródło
 * rekoncyliacji" — it happens to hold the full set, so it doubles as a reconciliation
 * source even though this function itself only returns the `sinceDrawNumber`-filtered
 * tail, to honor the same fetchSince contract as the other two providers).
 */
export async function fetchSince(sinceDrawNumber, { fetchFn = fetch, url = DEFAULT_URL } = {}) {
  const res = await fetchWithTimeout(fetchFn, url);
  if (!res.ok) {
    throw new Error(`${SOURCE}: HTTP ${res.status} fetching ${url}`);
  }
  const text = await res.text();
  const { draws, errors } = parseDlFile(text);
  if (draws.length === 0) {
    throw new Error(`${SOURCE}: no parseable draws in response (${errors.length} parse error(s))`);
  }

  return draws
    .filter((d) => d.drawNumber > sinceDrawNumber)
    .sort((a, b) => a.drawNumber - b.drawNumber)
    .map((d) => ({ drawNumber: d.drawNumber, drawnAt: d.drawnAt, numbers: d.numbers, source: SOURCE }));
}
