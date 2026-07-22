// Frontend copy of the Lotto blankiet (coupon) 7x7 geometry.
//
// SOURCE OF TRUTH: src/server/lib/blanket.js (CONVENTIONS §"Geometria blankietu").
// The formula is duplicated here — not imported — so the client bundle never pulls
// in a server module. It is two lines, frozen by CONVENTIONS, and asserted against
// the server rule in tests/blanket-geometry.test.js. If the coupon layout ever
// changes, change both files.
//
// number n -> { row, col }, both 0-indexed; row 0 = first row (numbers 1-7).

export const COLUMNS = 7;
export const CELL_COUNT = 49;

export function numberToCell(n) {
  if (!Number.isInteger(n) || n < 1 || n > CELL_COUNT) {
    throw new RangeError(`number out of range 1-49: ${n}`);
  }
  const index = n - 1;
  return { row: Math.floor(index / COLUMNS), col: index % COLUMNS };
}
