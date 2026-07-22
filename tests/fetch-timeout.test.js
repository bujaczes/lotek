import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from '../src/server/lib/fetch-timeout.js';

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a never-resolving fetchFn once DEFAULT_FETCH_TIMEOUT_MS elapses, instead of hanging forever', async () => {
    const fetchFn = vi.fn(() => new Promise(() => {})); // never settles, ignores its own signal arg entirely

    const promise = fetchWithTimeout(fetchFn, 'https://example.test/slow');
    const assertion = expect(promise).rejects.toThrow(/timed out after 20000ms/);

    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS);
    await assertion;
  });

  it('does not time out a fetchFn that resolves well before the deadline', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));

    const result = await fetchWithTimeout(fetchFn, 'https://example.test/fast');

    expect(result).toEqual({ ok: true, status: 200 });
  });

  it('propagates a fetchFn rejection immediately, without waiting for the deadline', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('DNS failure');
    });

    await expect(fetchWithTimeout(fetchFn, 'https://example.test/broken')).rejects.toThrow('DNS failure');
  });

  it('passes an AbortSignal through to fetchFn (a real fetch() would honor it to cancel the in-flight request)', async () => {
    const fetchFn = vi.fn(async (url, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return { ok: true };
    });

    await fetchWithTimeout(fetchFn, 'https://example.test/signal', { headers: { Accept: 'application/json' } });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.test/signal',
      expect.objectContaining({ headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) })
    );
  });

  it('respects a custom timeoutMs override', async () => {
    const fetchFn = vi.fn(() => new Promise(() => {}));

    const promise = fetchWithTimeout(fetchFn, 'https://example.test/short', {}, 500);
    const assertion = expect(promise).rejects.toThrow(/timed out after 500ms/);

    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('does not leave a pending timer after resolving (clears it in a finally)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }));

    await fetchWithTimeout(fetchFn, 'https://example.test/clean');

    expect(vi.getTimerCount()).toBe(0);
  });
});
