// Polish number/date/countdown formatting. Pure functions, no DOM.

const NBSP = '\u00A0';
const intFormatter = new Intl.NumberFormat('pl-PL');
const longDateFormatter = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

// pl-PL groups thousands with U+00A0 (non-breaking space); some ICU builds emit
// the narrow U+202F instead. Normalize every whitespace separator to a single
// U+00A0 so large numbers never wrap mid-value and output is stable across
// Node/ICU builds. (\s in JS already covers U+00A0 and U+202F.)
export function formatInt(n) {
  return intFormatter.format(n).replace(/\s/g, NBSP);
}

// Percentages and decimals are formatted per call site precision, so the formatters
// are memoized by digit count instead of being module constants.
const fixedFormatters = new Map();
function fixedFormatter(digits, options) {
  const key = `${options.style || 'decimal'}:${digits}`;
  let formatter = fixedFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('pl-PL', {
      ...options,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    fixedFormatters.set(key, formatter);
  }
  return formatter;
}

/** 0..1 share -> "49,52%". */
export function formatPercent(share, digits = 2) {
  return fixedFormatter(digits, { style: 'percent' }).format(share);
}

export function formatDecimal(value, digits = 2) {
  return fixedFormatter(digits, {}).format(value);
}

// Money. pl-PL currency output already reads "22 140,00 zł"; the separator is
// normalized to U+00A0 for the same reason as formatInt, and the ASCII hyphen is
// swapped for a real minus sign (U+2212) so a negative balance sets like the rest
// of the tabular data.
const plnFormatter = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPln(value) {
  return plnFormatter.format(value).replace(/\s/g, NBSP).replace(/^-/, '−');
}

/** Same, with an explicit "+" on a gain — for the wehikuł balance, where sign is the point. */
export function formatSignedPln(value) {
  const text = formatPln(value);
  return value > 0 ? `+${text}` : text;
}

// Build the Date from the ISO parts in LOCAL time so a `YYYY-MM-DD` string is
// never dragged back a day by a UTC-negative host timezone.
function localDateFromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatShortDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function formatLongDate(iso) {
  return longDateFormatter.format(localDateFromIso(iso));
}

export function countdownParts(remainingMs) {
  if (remainingMs <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  const totalSeconds = Math.floor(remainingMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    done: false,
  };
}

// Polish plural picker. forms = [one, few, many]:
//   1 -> one; 2..4 (but not 12..14) -> few; everything else -> many.
export function pluralPl(n, forms) {
  const abs = Math.abs(n);
  if (abs === 1) return forms[0];
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1];
  return forms[2];
}

// "ile losowań temu" phrase for a current gap (0 = drawn in the latest draw).
export function drawsAgo(gap) {
  if (gap === 0) return 'w ostatnim losowaniu';
  return `${gap} ${pluralPl(gap, ['losowanie', 'losowania', 'losowań'])} temu`;
}

const pad2 = (n) => String(n).padStart(2, '0');
const dayWord = (days) => (days === 1 ? 'dzień' : 'dni');

export function formatCountdown(remainingMs) {
  const { days, hours, minutes, seconds, done } = countdownParts(remainingMs);
  if (done) return 'lada moment';
  const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return days > 0 ? `za ${days} ${dayWord(days)} ${clock}` : `za ${clock}`;
}
