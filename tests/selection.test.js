import { describe, expect, it } from 'vitest';
import {
  toggleNumber,
  isCompleteSet,
  validateSet,
  parseNumbers,
  serializeNumbers,
  SET_SIZE,
} from '../src/selection.js';

describe('toggleNumber', () => {
  it('adds a number and keeps the selection sorted', () => {
    expect(toggleNumber([12, 5], 8)).toEqual([5, 8, 12]);
  });

  it('removes a number that is already selected', () => {
    expect(toggleNumber([5, 8, 12], 8)).toEqual([5, 12]);
  });

  it('never mutates the input array', () => {
    const before = [5, 8];
    toggleNumber(before, 12);
    expect(before).toEqual([5, 8]);
  });

  it('refuses to add past the limit but still allows removal', () => {
    const full = [1, 2, 3, 4, 5, 6];
    expect(toggleNumber(full, 7)).toEqual(full);
    expect(toggleNumber(full, 3)).toEqual([1, 2, 4, 5, 6]);
  });

  it('honours a custom limit', () => {
    expect(toggleNumber([1, 2], 3, 2)).toEqual([1, 2]);
    expect(toggleNumber([1, 2], 3, 3)).toEqual([1, 2, 3]);
  });

  it('ignores numbers outside 1-49', () => {
    expect(toggleNumber([5], 0)).toEqual([5]);
    expect(toggleNumber([5], 50)).toEqual([5]);
    expect(toggleNumber([5], 1.5)).toEqual([5]);
  });
});

describe('isCompleteSet', () => {
  it('is true only for exactly six unique numbers', () => {
    expect(isCompleteSet([1, 2, 3, 4, 5, 6])).toBe(true);
    expect(isCompleteSet([1, 2, 3, 4, 5])).toBe(false);
    expect(isCompleteSet([1, 2, 3, 4, 5, 5])).toBe(false);
  });

  it('uses SET_SIZE as the default six', () => {
    expect(SET_SIZE).toBe(6);
  });
});

describe('validateSet', () => {
  it('accepts a complete set', () => {
    expect(validateSet([1, 2, 3, 4, 5, 6])).toEqual({ ok: true, message: '' });
  });

  it('asks for the whole set when nothing is picked', () => {
    expect(validateSet([])).toEqual({ ok: false, message: 'Zaznacz 6 liczb na blankiecie.' });
  });

  it('counts down with the right Polish plural', () => {
    expect(validateSet([1]).message).toBe('Zaznacz jeszcze 5 liczb.');
    expect(validateSet([1, 2, 3, 4, 5]).message).toBe('Zaznacz jeszcze 1 liczbę.');
    expect(validateSet([1, 2, 3]).message).toBe('Zaznacz jeszcze 3 liczby.');
  });

  it('rejects out-of-range or duplicated numbers', () => {
    expect(validateSet([1, 2, 3, 4, 5, 60]).ok).toBe(false);
    expect(validateSet([1, 2, 3, 4, 5, 5]).ok).toBe(false);
  });
});

describe('parseNumbers', () => {
  it('parses a comma separated list into a sorted unique set', () => {
    expect(parseNumbers('12,5,5,8')).toEqual([5, 8, 12]);
  });

  it('tolerates spaces and empty tokens', () => {
    expect(parseNumbers(' 3 , 9 ,')).toEqual([3, 9]);
  });

  it('returns an empty list for junk or out-of-range input', () => {
    expect(parseNumbers('abc')).toEqual([]);
    expect(parseNumbers('0,7')).toEqual([]);
    expect(parseNumbers('50')).toEqual([]);
    expect(parseNumbers(null)).toEqual([]);
  });

  it('caps the result at the limit', () => {
    expect(parseNumbers('1,2,3,4,5,6,7')).toEqual([]);
    expect(parseNumbers('1,2,3', 2)).toEqual([]);
  });
});

describe('serializeNumbers', () => {
  it('round-trips through parseNumbers', () => {
    expect(serializeNumbers([12, 5, 8])).toBe('5,8,12');
    expect(parseNumbers(serializeNumbers([12, 5, 8]))).toEqual([5, 8, 12]);
  });

  it('is empty for an empty selection', () => {
    expect(serializeNumbers([])).toBe('');
  });
});
