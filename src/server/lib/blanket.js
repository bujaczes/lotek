const MIN_NUMBER = 1;
const MAX_NUMBER = 49;
const COLUMNS = 7;

/**
 * Single source of truth for the Lotto blankiet (coupon) 7x7 geometry (per CONVENTIONS):
 * number n -> { row, col }, both 0-indexed, row 0 = first row (numbers 1-7). Reused by
 * the blankiet heatmap (Faza 3) and the Typer (Faza 5) — do not duplicate this formula.
 */
export function numberToCell(n) {
  if (!Number.isInteger(n) || n < MIN_NUMBER || n > MAX_NUMBER) {
    throw new RangeError(`number out of range 1-49: ${n}`);
  }
  const index = n - 1;
  return { row: Math.floor(index / COLUMNS), col: index % COLUMNS };
}
