import { maskFromNumbers } from './mask.js';

const MIN_NUMBER = 1;
const MAX_NUMBER = 49;
const NUMBERS_PER_DRAW = 6;

// `7380. 18.07.2026 5,6,12,38,41,43` — draw number + dot, date dd.mm.yyyy, comma-separated numbers.
const LINE_RE = /^(\d+)\.\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(.+)$/;
const NUMBER_TOKEN_RE = /^\d{1,2}$/;

function toIsoDateOrNull(dayStr, monthStr, yearStr) {
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Round-trip through Date.UTC to reject calendar-invalid combinations
  // (e.g. 31.02, 29.02 on a non-leap year) instead of letting JS clamp them.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function parseNumbers(numbersStr) {
  const tokens = numbersStr.split(',').map((t) => t.trim());

  if (tokens.length !== NUMBERS_PER_DRAW) {
    return { ok: false, reason: `expected exactly 6 numbers, got ${tokens.length}` };
  }

  if (tokens.some((t) => !NUMBER_TOKEN_RE.test(t))) {
    return { ok: false, reason: 'numbers must be plain integers' };
  }

  const numbers = tokens.map(Number);

  const outOfRange = numbers.find((n) => n < MIN_NUMBER || n > MAX_NUMBER);
  if (outOfRange !== undefined) {
    return { ok: false, reason: `number out of range 1-49: ${outOfRange}` };
  }

  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] <= numbers[i - 1]) {
      return { ok: false, reason: 'numbers must be strictly ascending' };
    }
  }

  return { ok: true, numbers };
}

export function parseDlFile(text) {
  const draws = [];
  const errors = [];
  const seenDrawNumbers = new Set();

  const lines = text.split(/\r\n|\r|\n/);

  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1;
    const trimmed = rawLine.trim();
    if (trimmed === '') return; // blank lines are tolerated, not an error

    const match = trimmed.match(LINE_RE);
    if (!match) {
      errors.push({ line: lineNumber, reason: 'line does not match the expected format', raw: rawLine });
      return;
    }

    const [, drawNumberStr, dayStr, monthStr, yearStr, numbersStr] = match;

    const drawnAt = toIsoDateOrNull(dayStr, monthStr, yearStr);
    if (drawnAt === null) {
      errors.push({ line: lineNumber, reason: 'invalid calendar date', raw: rawLine });
      return;
    }

    const numbersResult = parseNumbers(numbersStr);
    if (!numbersResult.ok) {
      errors.push({ line: lineNumber, reason: numbersResult.reason, raw: rawLine });
      return;
    }

    const drawNumber = Number(drawNumberStr);
    if (seenDrawNumbers.has(drawNumber)) {
      errors.push({ line: lineNumber, reason: `duplicate draw number ${drawNumber}`, raw: rawLine });
      return;
    }
    seenDrawNumbers.add(drawNumber);

    draws.push({
      drawNumber,
      drawnAt,
      numbers: numbersResult.numbers,
      mask: maskFromNumbers(numbersResult.numbers),
    });
  });

  return { draws, errors };
}

export function validateContinuity(draws) {
  if (draws.length === 0) return [];

  const present = new Set(draws.map((d) => d.drawNumber));
  const max = Math.max(...present);

  const missing = [];
  for (let n = 1; n <= max; n++) {
    if (!present.has(n)) missing.push(n);
  }
  return missing;
}
