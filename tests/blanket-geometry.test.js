import { describe, expect, it } from 'vitest';
import { numberToCell, CELL_COUNT, COLUMNS } from '../src/blanket-geometry.js';

describe('numberToCell (frontend blankiet geometry)', () => {
  it('places the four anchor numbers exactly (matches CONVENTIONS)', () => {
    expect(numberToCell(1)).toEqual({ row: 0, col: 0 });
    expect(numberToCell(7)).toEqual({ row: 0, col: 6 });
    expect(numberToCell(8)).toEqual({ row: 1, col: 0 });
    expect(numberToCell(49)).toEqual({ row: 6, col: 6 });
  });

  it('agrees with the server source of truth across the whole range', () => {
    for (let n = 1; n <= 49; n++) {
      const cell = numberToCell(n);
      expect(cell.row).toBe(Math.floor((n - 1) / 7));
      expect(cell.col).toBe((n - 1) % 7);
    }
  });

  it('exposes a 7x7 = 49 grid', () => {
    expect(COLUMNS).toBe(7);
    expect(CELL_COUNT).toBe(49);
  });

  it('rejects numbers outside 1..49', () => {
    expect(() => numberToCell(0)).toThrow(RangeError);
    expect(() => numberToCell(50)).toThrow(RangeError);
    expect(() => numberToCell(1.5)).toThrow(RangeError);
  });
});
