import { describe, expect, it, vi } from 'vitest';
import { fetchSince, SOURCE } from '../src/server/providers/mbnet.js';

const SAMPLE_TEXT = [
  '1. 27.01.1957 8,12,31,39,43,45',
  '2. 03.02.1957 5,10,11,22,25,27',
  '3. 10.02.1957 18,19,20,26,45,49',
].join('\n');

function textResponse(text, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => text };
}

describe('providers/mbnet — the dl.txt fallback (always the complete history in one file)', () => {
  it('SOURCE is "mbnet" (matches the draw.source CHECK constraint)', () => {
    expect(SOURCE).toBe('mbnet');
  });

  it('filters to only draws newer than sinceDrawNumber, ascending, tagged with source', async () => {
    const fetchFn = vi.fn(async () => textResponse(SAMPLE_TEXT));

    const draws = await fetchSince(1, { fetchFn });

    expect(draws).toEqual([
      { drawNumber: 2, drawnAt: '1957-02-03', numbers: [5, 10, 11, 22, 25, 27], source: 'mbnet' },
      { drawNumber: 3, drawnAt: '1957-02-10', numbers: [18, 19, 20, 26, 45, 49], source: 'mbnet' },
    ]);
  });

  it('returns everything when sinceDrawNumber is 0 (fresh/empty db)', async () => {
    const fetchFn = vi.fn(async () => textResponse(SAMPLE_TEXT));

    const draws = await fetchSince(0, { fetchFn });

    expect(draws.map((d) => d.drawNumber)).toEqual([1, 2, 3]);
  });

  it('returns nothing new once sinceDrawNumber already covers the whole file', async () => {
    const fetchFn = vi.fn(async () => textResponse(SAMPLE_TEXT));

    const draws = await fetchSince(3, { fetchFn });

    expect(draws).toEqual([]);
  });

  it('throws on a non-OK HTTP response', async () => {
    const fetchFn = vi.fn(async () => textResponse('', { ok: false, status: 503 }));

    await expect(fetchSince(0, { fetchFn })).rejects.toThrow(/HTTP 503/);
  });

  it('throws a clear error when the response has zero parseable draws (e.g. an HTML maintenance page)', async () => {
    const fetchFn = vi.fn(async () => textResponse('<html><body>down for maintenance</body></html>'));

    await expect(fetchSince(0, { fetchFn })).rejects.toThrow(/no parseable draws/i);
  });
});
