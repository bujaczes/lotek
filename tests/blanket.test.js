import { describe, expect, it } from 'vitest';
import { numberToCell } from '../src/server/lib/blanket.js';

describe('numberToCell (pure blanket 7x7 geometry)', () => {
  it('number 1 -> row 0, col 0 (top-left)', () => {
    expect(numberToCell(1)).toEqual({ row: 0, col: 0 });
  });

  it('number 7 -> row 0, col 6 (end of first row)', () => {
    expect(numberToCell(7)).toEqual({ row: 0, col: 6 });
  });

  it('number 8 -> row 1, col 0 (start of second row)', () => {
    expect(numberToCell(8)).toEqual({ row: 1, col: 0 });
  });

  it('number 14 -> row 1, col 6 (end of second row)', () => {
    expect(numberToCell(14)).toEqual({ row: 1, col: 6 });
  });

  it('number 49 -> row 6, col 6 (bottom-right)', () => {
    expect(numberToCell(49)).toEqual({ row: 6, col: 6 });
  });

  it('number 25 (middle-ish) -> row 3, col 3', () => {
    // 25 -> index 24 -> row floor(24/7)=3, col 24%7=3
    expect(numberToCell(25)).toEqual({ row: 3, col: 3 });
  });

  it('produces a bijection onto the 7x7 grid for all 49 numbers (no collisions, full coverage)', () => {
    const seen = new Set();
    for (let n = 1; n <= 49; n++) {
      const { row, col } = numberToCell(n);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThanOrEqual(6);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThanOrEqual(6);
      seen.add(`${row},${col}`);
    }
    expect(seen.size).toBe(49);
  });

  it('throws RangeError for out-of-range or non-integer input', () => {
    expect(() => numberToCell(0)).toThrow(RangeError);
    expect(() => numberToCell(50)).toThrow(RangeError);
    expect(() => numberToCell(1.5)).toThrow(RangeError);
    expect(() => numberToCell(-1)).toThrow(RangeError);
  });
});
