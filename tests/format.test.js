import { describe, expect, it } from 'vitest';
import { formatInt, formatLongDate, formatShortDate } from '../src/format.js';

describe('formatInt', () => {
  it('groups thousands with a non-breaking space (pl-PL)', () => {
    expect(formatInt(13983816)).toBe('13\u00A0983\u00A0816');
  });

  it('leaves values below 1000 untouched', () => {
    expect(formatInt(912)).toBe('912');
    expect(formatInt(0)).toBe('0');
  });
});

describe('formatShortDate', () => {
  it('renders an ISO date as DD.MM.RRRR', () => {
    expect(formatShortDate('2026-07-18')).toBe('18.07.2026');
    expect(formatShortDate('1957-01-27')).toBe('27.01.1957');
  });
});

describe('formatLongDate', () => {
  it('renders a Polish long date without a timezone shift', () => {
    // 2026-07-18 is a Saturday; must not roll back to Friday on a UTC-negative host.
    expect(formatLongDate('2026-07-18')).toBe('sobota, 18 lipca 2026');
  });
});
