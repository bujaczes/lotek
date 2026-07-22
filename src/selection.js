// Pure state for every place the user picks numbers off a blankiet: the wehikuł
// coupon (exactly 6) and the archive's "zawiera liczby" filter (up to 6). No DOM.

export const MAX_NUMBER = 49;
export const SET_SIZE = 6;

const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER;
const bySize = (a, b) => a - b;

/** Add or remove `n`, returning a new sorted array. Adding past `max` is a no-op. */
export function toggleNumber(selected, n, max = SET_SIZE) {
  if (!inRange(n)) return [...selected];
  if (selected.includes(n)) return selected.filter((x) => x !== n);
  if (selected.length >= max) return [...selected];
  return [...selected, n].sort(bySize);
}

export function isCompleteSet(selected, size = SET_SIZE) {
  return selected.length === size && new Set(selected).size === size && selected.every(inRange);
}

/**
 * Validation for the CTA. The message is the whole feedback channel — it says what
 * is missing, not that something is wrong.
 */
export function validateSet(selected, size = SET_SIZE) {
  if (isCompleteSet(selected, size)) return { ok: true, message: '' };
  if (!selected.every(inRange) || new Set(selected).size !== selected.length) {
    return { ok: false, message: 'Zaznacz 6 różnych liczb od 1 do 49.' };
  }
  if (selected.length === 0) return { ok: false, message: `Zaznacz ${size} liczb na blankiecie.` };
  const missing = size - selected.length;
  const word = missing === 1 ? 'liczbę' : missing >= 2 && missing <= 4 ? 'liczby' : 'liczb';
  return { ok: false, message: `Zaznacz jeszcze ${missing} ${word}.` };
}

/**
 * "5,8,12" -> [5, 8, 12]. Any junk, out-of-range value or overlong list collapses to
 * an empty selection: this parses untrusted input (a URL query, a pasted string), so
 * partial acceptance would silently play a different coupon than the one requested.
 */
export function parseNumbers(raw, max = SET_SIZE) {
  if (typeof raw !== 'string') return [];
  const tokens = raw.split(',').map((t) => t.trim()).filter((t) => t !== '');
  if (!tokens.length) return [];
  if (!tokens.every((t) => /^\d+$/.test(t))) return [];
  const numbers = [...new Set(tokens.map(Number))];
  if (!numbers.every(inRange) || numbers.length > max) return [];
  return numbers.sort(bySize);
}

export function serializeNumbers(selected) {
  return [...selected].sort(bySize).join(',');
}
