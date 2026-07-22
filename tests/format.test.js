import { describe, expect, it } from 'vitest';
import {
  formatInt,
  formatLongDate,
  formatShortDate,
  formatPercent,
  formatDecimal,
  pluralPl,
  drawsAgo,
} from '../src/format.js';

describe('formatPercent', () => {
  it('formats a 0..1 share as a Polish percentage with two decimals by default', () => {
    expect(formatPercent(0.4951984494075151)).toBe('49,52%');
    expect(formatPercent(0.5640350244883086)).toBe('56,40%');
  });
  it('honours a requested precision', () => {
    expect(formatPercent(0.4951984494075151, 1)).toBe('49,5%');
    expect(formatPercent(0.5, 0)).toBe('50%');
  });
});

describe('formatDecimal', () => {
  it('formats with a Polish comma and the requested precision', () => {
    expect(formatDecimal(1.9471444704363958, 2)).toBe('1,95');
    expect(formatDecimal(149.8123, 1)).toBe('149,8');
  });
});

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

describe('pluralPl', () => {
  const losowanie = ['losowanie', 'losowania', 'losowań'];
  it('picks the singular for 1', () => {
    expect(pluralPl(1, losowanie)).toBe('losowanie');
  });
  it('picks the "few" form for 2-4 (not the teens)', () => {
    expect(pluralPl(2, losowanie)).toBe('losowania');
    expect(pluralPl(23, losowanie)).toBe('losowania');
  });
  it('picks the "many" form for 0, 5-21, and the 12-14 teens', () => {
    expect(pluralPl(0, losowanie)).toBe('losowań');
    expect(pluralPl(5, losowanie)).toBe('losowań');
    expect(pluralPl(13, losowanie)).toBe('losowań');
    expect(pluralPl(21, losowanie)).toBe('losowań');
  });
});

describe('drawsAgo', () => {
  it('phrases gap 0 as the latest draw', () => {
    expect(drawsAgo(0)).toBe('w ostatnim losowaniu');
  });
  it('agrees with Polish plural for the gap count', () => {
    expect(drawsAgo(1)).toBe('1 losowanie temu');
    expect(drawsAgo(3)).toBe('3 losowania temu');
    expect(drawsAgo(15)).toBe('15 losowań temu');
  });
});
