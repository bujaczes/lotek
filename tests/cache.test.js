import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cached, invalidateCache } from '../src/server/lib/cache.js';

describe('cached/invalidateCache (in-memory memoization)', () => {
  beforeEach(() => {
    invalidateCache();
  });

  it('calls fn on first access and returns its value', () => {
    const fn = vi.fn(() => 42);
    expect(cached('answer', fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('memoizes: a second call with the same key does not re-invoke fn', () => {
    const fn = vi.fn(() => 'computed');
    cached('greeting', fn);
    const second = cached('greeting', fn);
    expect(second).toBe('computed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('different keys are cached independently', () => {
    const fnA = vi.fn(() => 'a');
    const fnB = vi.fn(() => 'b');
    expect(cached('key-a', fnA)).toBe('a');
    expect(cached('key-b', fnB)).toBe('b');
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('invalidateCache() clears all entries: next access recomputes', () => {
    const fn = vi.fn(() => Math.random());
    const first = cached('volatile', fn);
    invalidateCache();
    const second = cached('volatile', fn);
    expect(fn).toHaveBeenCalledTimes(2);
    // not asserting first !== second (Math.random could theoretically collide),
    // the call-count assertion above is the real proof of recomputation.
    expect(typeof first).toBe('number');
    expect(typeof second).toBe('number');
  });

  it('caches falsy and object values correctly (not treated as "missing")', () => {
    const fnZero = vi.fn(() => 0);
    expect(cached('zero', fnZero)).toBe(0);
    expect(cached('zero', fnZero)).toBe(0);
    expect(fnZero).toHaveBeenCalledTimes(1);

    const obj = { a: 1 };
    const fnObj = vi.fn(() => obj);
    expect(cached('obj', fnObj)).toBe(obj);
    expect(cached('obj', fnObj)).toBe(obj);
    expect(fnObj).toHaveBeenCalledTimes(1);
  });
});
