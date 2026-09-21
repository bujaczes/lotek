import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchPrizes, mapPrizesResponse, PrizesShapeError } from '../src/server/providers/openapi-prizes.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('../data/fixtures/openapi-prizes-response.json', import.meta.url), 'utf8')
).body;

function jsonResponse(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const lottoItem = (overrides = {}) => ({ ...FIXTURE.find((i) => i.gameType === 'Lotto'), ...overrides });
const tiersOf = (pairs) =>
  Object.fromEntries(pairs.map(([prize, prizeValue], i) => [String(i + 1), { prize, prizeValue }]));

describe('mapPrizesResponse(body, drawNumber)', () => {
  it('maps the real 7407 response: tiers I-IV -> 6/5/4/3 hits, amounts in grosze', () => {
    expect(mapPrizesResponse(FIXTURE, 7407)).toEqual({
      status: 'ok',
      tiers: {
        6: { winners: 1, amount: 4479485500 },
        5: { winners: 107, amount: 887400 },
        4: { winners: 6221, amount: 20070 },
        3: { winners: 110146, amount: 3500 },
      },
    });
  });

  it('picks the Lotto item wherever it sits (LottoPlus/SuperSzansa are ignored)', () => {
    expect(mapPrizesResponse([...FIXTURE].reverse(), 7407).tiers[6]).toEqual({ winners: 1, amount: 4479485500 });
  });

  it('prizesEmpty: true -> empty', () => {
    expect(mapPrizesResponse([lottoItem({ prizesEmpty: true, prizes: {} })], 7407)).toEqual({ status: 'empty' });
  });

  it('an empty prizes object -> empty', () => {
    expect(mapPrizesResponse([lottoItem({ prizes: {} })], 7407)).toEqual({ status: 'empty' });
  });

  it('zero winners in every tier -> empty (not announced yet, not a real result)', () => {
    const prizes = tiersOf([[0, 0], [0, 0], [0, 0], [0, 0]]);
    expect(mapPrizesResponse([lottoItem({ prizes })], 7407)).toEqual({ status: 'empty' });
  });

  it('a jackpot (nobody hit six) is still a valid result', () => {
    const prizes = tiersOf([[0, 0], [32, 7218], [1744, 404.6], [34020, 20]]);
    const result = mapPrizesResponse([lottoItem({ prizes })], 7407);
    expect(result.status).toBe('ok');
    expect(result.tiers[6]).toEqual({ winners: 0, amount: 0 });
    expect(result.tiers[4]).toEqual({ winners: 1744, amount: 40460 });
  });

  it.each([
    ['the body is not an array', { items: [] }],
    ['there is no Lotto item', FIXTURE.filter((i) => i.gameType !== 'Lotto')],
    ['drawSystemId does not match the requested draw', [lottoItem({ drawSystemId: 7406 })]],
    ['a tier is missing', [lottoItem({ prizes: { 1: { prize: 1, prizeValue: 1 } } })]],
    ['a winner count is negative', [lottoItem({ prizes: tiersOf([[-1, 0], [1, 1], [1, 1], [1, 1]]) })]],
    ['a winner count is not an integer', [lottoItem({ prizes: tiersOf([[1.5, 0], [1, 1], [1, 1], [1, 1]]) })]],
    ['an amount is not a finite number', [lottoItem({ prizes: tiersOf([[1, 'x'], [1, 1], [1, 1], [1, 1]]) })]],
  ])('throws PrizesShapeError when %s', (_, body) => {
    expect(() => mapPrizesResponse(body, 7407)).toThrow(PrizesShapeError);
  });
});

describe('fetchPrizes(drawNumber, options)', () => {
  it('GETs the Lotto draw-prizes endpoint with the secret header', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(FIXTURE));

    const result = await fetchPrizes(7407, { fetchFn, apiKey: 'k' });

    expect(result.status).toBe('ok');
    const [url, options] = fetchFn.mock.calls[0];
    expect(url).toBe('https://developers.lotto.pl/api/open/v1/lotteries/draw-prizes/Lotto/7407');
    expect(options.headers).toMatchObject({ secret: 'k', Accept: 'application/json' });
  });

  it('HTTP 404 ("Nie znaleziono wygranych") -> empty', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ code: 404 }, { status: 404 }));
    expect(await fetchPrizes(7407, { fetchFn, apiKey: 'k' })).toEqual({ status: 'empty' });
  });

  it('HTTP 403 -> a plain Error naming the status (not a shape error)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, { status: 403 }));

    const err = await fetchPrizes(7407, { fetchFn, apiKey: 'k' }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PrizesShapeError);
    expect(err.message).toMatch(/HTTP 403/);
  });

  it('throws before any request when there is no API key', async () => {
    const fetchFn = vi.fn();
    await expect(fetchPrizes(7407, { fetchFn, apiKey: '' })).rejects.toThrow(/LOTTO_API_KEY/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
