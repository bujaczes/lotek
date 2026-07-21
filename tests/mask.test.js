import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { maskFromNumbers, numbersFromMask, popcount } from '../src/server/lib/mask.js';

describe('maskFromNumbers / numbersFromMask', () => {
  it('round-trips a sorted set of numbers through a mask', () => {
    const numbers = [1, 6, 12, 27, 38, 49];
    const mask = maskFromNumbers(numbers);
    expect(numbersFromMask(mask)).toEqual(numbers);
  });

  it('computes the mask as the sum of 2^(n-1)', () => {
    expect(maskFromNumbers([1, 2, 3])).toBe(1 + 2 + 4);
  });

  it('returns numbers sorted ascending regardless of input order', () => {
    const mask = maskFromNumbers([49, 1, 25]);
    expect(numbersFromMask(mask)).toEqual([1, 25, 49]);
  });
});

describe('popcount', () => {
  it('counts bits set in small masks', () => {
    expect(popcount(0)).toBe(0);
    expect(popcount(1)).toBe(1);
    expect(popcount(0b1011)).toBe(3);
  });

  it('counts bits across the full 49-bit range (both 32-bit halves)', () => {
    const allNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
    expect(popcount(maskFromNumbers(allNumbers))).toBe(49);
    expect(popcount(maskFromNumbers([49]))).toBe(1);
    expect(popcount(maskFromNumbers([32, 33, 49]))).toBe(3);
  });

  it('matches the number of set bits for a typical 6-number draw', () => {
    expect(popcount(maskFromNumbers([5, 6, 12, 38, 41, 43]))).toBe(6);
  });
});

describe('bit_count SQL function', () => {
  it('is registered by openDatabase() and computes popcount of a bitwise AND', () => {
    const db = openDatabase(':memory:');
    const a = maskFromNumbers([1, 2, 3, 4, 5, 6]);
    const b = maskFromNumbers([4, 5, 6, 7, 8, 9]);
    const { result } = db.prepare('SELECT bit_count(? & ?) AS result').get(a, b);
    expect(result).toBe(3);
    db.close();
  });
});
