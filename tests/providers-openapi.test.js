import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSince, SOURCE } from '../src/server/providers/openapi.js';
import { DEFAULT_FETCH_TIMEOUT_MS } from '../src/server/lib/fetch-timeout.js';

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function groupedItem(drawNumber, isoDate, numbers) {
  return {
    drawSystemId: drawNumber,
    drawDate: `${isoDate}T22:00:00Z`,
    gameType: 'Lotto',
    multiplierValue: 0,
    results: [
      { drawDate: `${isoDate}T22:00:00Z`, drawSystemId: drawNumber, gameType: 'Lotto', resultsJson: numbers, specialResults: [] },
    ],
    showSpecialResults: true,
    isNewEuroJackpotDraw: false,
  };
}

const NOW = () => new Date('2026-07-22T21:47:00Z');

describe('providers/openapi — official developers.lotto.pl OpenAPI', () => {
  let savedEnvKey;

  beforeEach(() => {
    savedEnvKey = process.env.LOTTO_API_KEY;
    delete process.env.LOTTO_API_KEY;
  });

  afterEach(() => {
    if (savedEnvKey === undefined) delete process.env.LOTTO_API_KEY;
    else process.env.LOTTO_API_KEY = savedEnvKey;
  });

  it('SOURCE is "openapi" (matches the draw.source CHECK constraint)', () => {
    expect(SOURCE).toBe('openapi');
  });

  it('self-disables without a key: throws before making any network call, whether the key is missing from env or options', async () => {
    const fetchFn = vi.fn();

    await expect(fetchSince(7380, { fetchFn, now: NOW, sinceDrawnAt: '2026-07-18' })).rejects.toThrow(
      /LOTTO_API_KEY not set/
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('requires sinceDrawnAt when a key is present — throws without calling fetchFn rather than guessing a start date', async () => {
    const fetchFn = vi.fn();

    await expect(fetchSince(7380, { fetchFn, now: NOW, apiKey: 'test-key' })).rejects.toThrow(/sinceDrawnAt is required/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends the "secret" header with the API key and the expected query params for each scheduled date scanned', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ totalRows: 0, items: [groupedItem(7381, '2026-07-21', [29, 4, 27, 23, 33, 16])], meta: {}, code: 200 }));

    await fetchSince(7380, { fetchFn, now: NOW, sinceDrawnAt: '2026-07-18', apiKey: 'test-key' });

    expect(fetchFn).toHaveBeenCalledTimes(1); // only Tue 2026-07-21 falls between 2026-07-18 (exclusive) and now
    const [url, options] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://developers.lotto.pl/api/open/v1/lotteries/draw-results/by-date-per-game?gameType=Lotto&drawDate=2026-07-21&index=1&size=10&sort=drawDate&order=DESC'
    );
    expect(options.headers.secret).toBe('test-key');
  });

  it('maps the mocked response and filters strictly by sinceDrawNumber, sorting numbers ascending', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ totalRows: 0, items: [groupedItem(7381, '2026-07-21', [29, 4, 27, 23, 33, 16])], meta: {}, code: 200 }));

    const draws = await fetchSince(7380, { fetchFn, now: NOW, sinceDrawnAt: '2026-07-18', apiKey: 'test-key' });

    expect(draws).toEqual([{ drawNumber: 7381, drawnAt: '2026-07-21', numbers: [4, 16, 23, 27, 29, 33], source: 'openapi' }]);
  });

  it('returns nothing new when sinceDrawNumber already covers every scanned date', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ totalRows: 0, items: [groupedItem(7381, '2026-07-21', [29, 4, 27, 23, 33, 16])], meta: {}, code: 200 }));

    const draws = await fetchSince(7381, { fetchFn, now: NOW, sinceDrawnAt: '2026-07-18', apiKey: 'test-key' });

    expect(draws).toEqual([]);
  });

  it('iterates every scheduled date since sinceDrawnAt, tolerating a 404 (no result published yet) on one of them', async () => {
    const fetchFn = vi.fn(async (url) => {
      const date = new URL(url).searchParams.get('drawDate');
      if (date === '2026-07-18') return jsonResponse({}, { ok: false, status: 404 });
      if (date === '2026-07-21') {
        return jsonResponse({ totalRows: 0, items: [groupedItem(7381, '2026-07-21', [29, 4, 27, 23, 33, 16])], meta: {}, code: 200 });
      }
      throw new Error(`unexpected date requested: ${date}`);
    });

    const draws = await fetchSince(7378, { fetchFn, now: NOW, sinceDrawnAt: '2026-07-16', apiKey: 'test-key' });

    expect(fetchFn).toHaveBeenCalledTimes(2); // 2026-07-18 (Sat) and 2026-07-21 (Tue)
    expect(draws.map((d) => d.drawNumber)).toEqual([7381]);
  });

  it('throws on a non-404 non-OK HTTP response instead of silently skipping the date', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, { ok: false, status: 500 }));

    await expect(fetchSince(7380, { fetchFn, now: NOW, sinceDrawnAt: '2026-07-18', apiKey: 'test-key' })).rejects.toThrow(
      /HTTP 500/
    );
  });

  it('throws a clear error on a malformed response body, reusing the same defensive mapping as lottopl.js', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ notItems: [] }));

    await expect(fetchSince(7380, { fetchFn, now: NOW, sinceDrawnAt: '2026-07-18', apiKey: 'test-key' })).rejects.toThrow(
      /malformed response.*items/i
    );
  });

  describe('a hung request', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('a never-resolving fetchFn fails after the fetch timeout instead of hanging the run forever', async () => {
      const fetchFn = vi.fn(() => new Promise(() => {}));

      const promise = fetchSince(7380, { fetchFn, now: NOW, sinceDrawnAt: '2026-07-18', apiKey: 'test-key' });
      const assertion = expect(promise).rejects.toThrow(/timed out after/);

      await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS);
      await assertion;
    });
  });
});
