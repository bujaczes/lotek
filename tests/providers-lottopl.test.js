import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fetchSince, SOURCE } from '../src/server/providers/lottopl.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(TESTS_DIR, '..', 'data', 'fixtures', 'lottopl-response.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

describe('providers/lottopl — mapping a real captured response', () => {
  it('maps the fixture to ascending {drawNumber, drawnAt, numbers, source}, sorting resultsJson', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(FIXTURE));

    const draws = await fetchSince(0, { fetchFn });

    expect(draws.map((d) => d.drawNumber)).toEqual([7379, 7380, 7381]);
    expect(draws.every((d) => d.source === 'lottopl')).toBe(true);
    expect(SOURCE).toBe('lottopl');
  });

  it('matches the control fact: draw 7380 on 2026-07-18 = {5,6,12,38,41,43} (resultsJson arrives unsorted: [38,41,5,6,12,43])', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(FIXTURE));

    const draws = await fetchSince(0, { fetchFn });
    const draw7380 = draws.find((d) => d.drawNumber === 7380);

    expect(draw7380.drawnAt).toBe('2026-07-18');
    expect(draw7380.numbers).toEqual([5, 6, 12, 38, 41, 43]);
  });

  it('picks up draw 7381 (the newest draw at fixture capture time)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(FIXTURE));

    const draws = await fetchSince(7380, { fetchFn });

    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({ drawNumber: 7381, drawnAt: '2026-07-21', source: 'lottopl' });
    expect(draws[0].numbers).toEqual([4, 16, 23, 27, 29, 33]);
    expect(draws[0].numbers).toEqual([...draws[0].numbers].sort((a, b) => a - b));
  });

  it('filters strictly by sinceDrawNumber: nothing new when since === the newest draw in the page', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(FIXTURE));

    const draws = await fetchSince(7381, { fetchFn });

    expect(draws).toEqual([]);
  });

  it('requests the unofficial endpoint with the expected query params and Accept header', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(FIXTURE));

    await fetchSince(7380, { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, options] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://www.lotto.pl/api/lotteries/draw-results/by-gametype?game=Lotto&index=1&size=10&sort=drawDate&order=DESC'
    );
    expect(options.headers.Accept).toBe('application/json');
  });

  it('escalates size when the first page does not reach back far enough to cover sinceDrawNumber', async () => {
    // Synthetic 250-draw history (drawNumber 1..250, DESC by drawNumber like the real
    // API), independent of the small 3-item real fixture — big enough that the default
    // first-page size (10) cannot possibly reach draw 1.
    const all = Array.from({ length: 250 }, (_, i) => 250 - i).map((n) => ({
      drawSystemId: n,
      drawDate: '2020-01-01T22:00:00Z',
      gameType: 'Lotto',
      multiplierValue: 0,
      results: [{ drawDate: '2020-01-01T22:00:00Z', drawSystemId: n, gameType: 'Lotto', resultsJson: [1, 2, 3, 4, 5, 6], specialResults: [] }],
      showSpecialResults: true,
      isNewEuroJackpotDraw: false,
    }));

    const fetchFn = vi.fn(async (url) => {
      const size = Number(new URL(url).searchParams.get('size'));
      return jsonResponse({ totalRows: 0, items: all.slice(0, size), meta: {}, code: 200 });
    });

    const draws = await fetchSince(0, { fetchFn });

    expect(draws).toHaveLength(250);
    expect(draws[0].drawNumber).toBe(1);
    expect(draws.at(-1).drawNumber).toBe(250);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1); // had to escalate size at least once
    const sizesRequested = fetchFn.mock.calls.map(([url]) => Number(new URL(url).searchParams.get('size')));
    expect(sizesRequested).toEqual([...sizesRequested].sort((a, b) => a - b)); // strictly non-decreasing
  });

  it('throws on a non-OK HTTP response, without producing any draws', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, { ok: false, status: 500 }));

    await expect(fetchSince(0, { fetchFn })).rejects.toThrow(/HTTP 500/);
  });

  it('throws a clear error on a malformed response (unexpected shape), not a bare TypeError', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ notItems: [] }));

    await expect(fetchSince(0, { fetchFn })).rejects.toThrow(/malformed response.*items/i);
  });

  it('throws a clear per-draw error when resultsJson is not 6 in-range integers (defensive mapping)', async () => {
    const malformed = {
      totalRows: 0,
      items: [
        {
          drawSystemId: 9999,
          drawDate: '2026-01-01T22:00:00Z',
          gameType: 'Lotto',
          multiplierValue: 0,
          results: [{ drawDate: '2026-01-01T22:00:00Z', drawSystemId: 9999, gameType: 'Lotto', resultsJson: [1, 2, 3], specialResults: [] }],
          showSpecialResults: true,
          isNewEuroJackpotDraw: false,
        },
      ],
      meta: {},
      code: 200,
    };
    const fetchFn = vi.fn(async () => jsonResponse(malformed));

    await expect(fetchSince(0, { fetchFn })).rejects.toThrow(/draw 9999.*resultsJson/i);
  });

  it('throws a clear error when a draw has no Lotto entry in results[] (e.g. only LottoPlus)', async () => {
    const malformed = {
      totalRows: 0,
      items: [
        {
          drawSystemId: 9999,
          drawDate: '2026-01-01T22:00:00Z',
          gameType: 'Lotto',
          multiplierValue: 0,
          results: [{ drawDate: '2026-01-01T22:00:00Z', drawSystemId: 9999, gameType: 'LottoPlus', resultsJson: [1, 2, 3, 4, 5, 6], specialResults: [] }],
          showSpecialResults: true,
          isNewEuroJackpotDraw: false,
        },
      ],
      meta: {},
      code: 200,
    };
    const fetchFn = vi.fn(async () => jsonResponse(malformed));

    await expect(fetchSince(0, { fetchFn })).rejects.toThrow(/no 'Lotto' entry/i);
  });

  it('maskFromNumbers on a mapped draw matches the control fact mask (sanity cross-check)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(FIXTURE));
    const draws = await fetchSince(0, { fetchFn });
    const draw7380 = draws.find((d) => d.drawNumber === 7380);
    expect(maskFromNumbers(draw7380.numbers)).toBe(maskFromNumbers([5, 6, 12, 38, 41, 43]));
  });
});
