import { describe, expect, it } from 'vitest';
import { countdownParts, formatCountdown } from '../src/format.js';

const ms = ({ d = 0, h = 0, m = 0, s = 0 }) => ((d * 24 + h) * 60 + m) * 60000 + s * 1000;

describe('countdownParts', () => {
  it('breaks a duration into days/hours/minutes/seconds', () => {
    expect(countdownParts(ms({ d: 2, h: 3, m: 12, s: 45 }))).toEqual({
      days: 2,
      hours: 3,
      minutes: 12,
      seconds: 45,
      done: false,
    });
  });

  it('clamps a past target to zero and marks it done', () => {
    expect(countdownParts(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true });
    expect(countdownParts(0)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true });
  });
});

describe('formatCountdown', () => {
  it('formats a multi-day countdown with Polish plural "dni"', () => {
    expect(formatCountdown(ms({ d: 2, h: 3, m: 12, s: 45 }))).toBe('za 2 dni 03:12:45');
  });

  it('uses the singular "dzień" for exactly one day', () => {
    expect(formatCountdown(ms({ d: 1, s: 5 }))).toBe('za 1 dzień 00:00:05');
  });

  it('drops the day segment below 24 hours', () => {
    expect(formatCountdown(ms({ h: 3, m: 12, s: 45 }))).toBe('za 03:12:45');
  });

  it('shows a waiting label once the target has passed', () => {
    expect(formatCountdown(0)).toBe('lada moment');
    expect(formatCountdown(-1000)).toBe('lada moment');
  });
});
