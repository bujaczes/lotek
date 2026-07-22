import { describe, expect, it, vi } from 'vitest';
import { defaultProviderChain, fetchSince } from '../src/server/providers/index.js';
import * as lottopl from '../src/server/providers/lottopl.js';
import * as mbnet from '../src/server/providers/mbnet.js';
import * as openapi from '../src/server/providers/openapi.js';

describe('providers/index — the [openapi?, lottopl, mbnet] fallback chain', () => {
  it('defaultProviderChain() omits openapi when no API key is available (self-disable, at the chain-construction level too)', () => {
    const chain = defaultProviderChain({ apiKey: undefined });
    expect(chain).toEqual([lottopl, mbnet]);
  });

  it('defaultProviderChain() includes openapi first when a key is available', () => {
    const chain = defaultProviderChain({ apiKey: 'some-key' });
    expect(chain).toEqual([openapi, lottopl, mbnet]);
  });

  it('the first provider to resolve without throwing wins outright, even with 0 draws', async () => {
    const winner = { SOURCE: 'lottopl', fetchSince: vi.fn(async () => []) };
    const loser = { SOURCE: 'mbnet', fetchSince: vi.fn(async () => [{ drawNumber: 1 }]) };

    const result = await fetchSince(0, { providers: [winner, loser] });

    expect(result).toEqual({ draws: [], provider: 'lottopl' });
    expect(loser.fetchSince).not.toHaveBeenCalled();
  });

  it('fallback: lottopl throws -> mbnet saves the day (the winning provider is mbnet, its draws are returned)', async () => {
    const failing = { SOURCE: 'lottopl', fetchSince: vi.fn(async () => { throw new Error('lotto.pl is down'); }) };
    const rescuer = {
      SOURCE: 'mbnet',
      fetchSince: vi.fn(async () => [{ drawNumber: 7381, drawnAt: '2026-07-21', numbers: [4, 16, 23, 27, 29, 33], source: 'mbnet' }]),
    };
    const onProviderError = vi.fn();

    const result = await fetchSince(7380, { providers: [failing, rescuer], onProviderError });

    expect(result.provider).toBe('mbnet');
    expect(result.draws).toHaveLength(1);
    expect(onProviderError).toHaveBeenCalledWith('lottopl', expect.any(Error));
  });

  it('every provider failing throws, with every provider\'s message collected', async () => {
    const a = { SOURCE: 'openapi', fetchSince: vi.fn(async () => { throw new Error('no key'); }) };
    const b = { SOURCE: 'lottopl', fetchSince: vi.fn(async () => { throw new Error('HTTP 500'); }) };
    const c = { SOURCE: 'mbnet', fetchSince: vi.fn(async () => { throw new Error('HTTP 503'); }) };

    await expect(fetchSince(0, { providers: [a, b, c], onProviderError: () => {} })).rejects.toThrow(
      /openapi: no key.*lottopl: HTTP 500.*mbnet: HTTP 503/s
    );
  });

  it('passes fetchFn, now and sinceDrawnAt through to each provider unchanged', async () => {
    const fetchFn = vi.fn();
    const now = () => new Date('2026-07-22T00:00:00Z');
    const provider = { SOURCE: 'lottopl', fetchSince: vi.fn(async () => []) };

    await fetchSince(42, { providers: [provider], fetchFn, now, sinceDrawnAt: '2026-07-18' });

    expect(provider.fetchSince).toHaveBeenCalledWith(42, { fetchFn, now, sinceDrawnAt: '2026-07-18' });
  });
});
