import { describe, expect, it } from 'vitest';
import { parseDlFile, validateContinuity } from '../src/server/lib/parse-dl.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';

describe('parseDlFile', () => {
  it('parses a well-formed multi-line file with no errors', () => {
    const text = [
      '7378. 07.07.2026 3,9,14,22,35,44',
      '7379. 14.07.2026 1,2,3,4,5,6',
      '7380. 18.07.2026 5,6,12,38,41,43',
    ].join('\n');

    const { draws, errors } = parseDlFile(text);

    expect(errors).toEqual([]);
    expect(draws).toHaveLength(3);
    expect(draws[2]).toEqual({
      drawNumber: 7380,
      drawnAt: '2026-07-18',
      numbers: [5, 6, 12, 38, 41, 43],
      mask: maskFromNumbers([5, 6, 12, 38, 41, 43]),
    });
  });

  it('matches the control fact from CONVENTIONS.md: draw 7380 on 18.07.2026', () => {
    const { draws, errors } = parseDlFile('7380. 18.07.2026 5,6,12,38,41,43');

    expect(errors).toEqual([]);
    expect(draws).toEqual([
      {
        drawNumber: 7380,
        drawnAt: '2026-07-18',
        numbers: [5, 6, 12, 38, 41, 43],
        mask: maskFromNumbers([5, 6, 12, 38, 41, 43]),
      },
    ]);
  });

  it('computes mask identically to maskFromNumbers for every parsed draw', () => {
    const text = [
      '1. 27.01.1957 1,2,3,4,5,6',
      '2. 03.02.1957 7,8,9,10,11,12',
      '3. 10.02.1957 13,19,25,31,37,49',
    ].join('\n');

    const { draws } = parseDlFile(text);

    for (const draw of draws) {
      expect(draw.mask).toBe(maskFromNumbers(draw.numbers));
    }
  });

  it('allows duplicate draw dates (draws 421 and 422 both on 07.03.1965)', () => {
    const text = [
      '420. 03.03.1965 1,2,3,4,5,6',
      '421. 07.03.1965 7,8,9,10,11,12',
      '422. 07.03.1965 13,14,15,16,17,18',
      '423. 10.03.1965 19,20,21,22,23,24',
    ].join('\n');

    const { draws, errors } = parseDlFile(text);

    expect(errors).toEqual([]);
    expect(draws).toHaveLength(4);
    const d421 = draws.find((d) => d.drawNumber === 421);
    const d422 = draws.find((d) => d.drawNumber === 422);
    expect(d421.drawnAt).toBe('1965-03-07');
    expect(d422.drawnAt).toBe('1965-03-07');
    expect(d421.drawnAt).toBe(d422.drawnAt);
  });

  it('flags a duplicate draw number as an error and keeps only the first occurrence', () => {
    const text = [
      '1. 27.01.1957 1,2,3,4,5,6',
      '2. 03.02.1957 7,8,9,10,11,12',
      '2. 10.02.1957 13,14,15,16,17,18',
      '3. 17.02.1957 19,20,21,22,23,24',
    ].join('\n');

    const { draws, errors } = parseDlFile(text);

    expect(draws.map((d) => d.drawNumber)).toEqual([1, 2, 3]);
    expect(draws.find((d) => d.drawNumber === 2).drawnAt).toBe('1957-02-03');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 3, raw: '2. 10.02.1957 13,14,15,16,17,18' });
    expect(errors[0].reason).toMatch(/duplicate/i);
  });

  it('tolerates CRLF line endings', () => {
    const text = [
      '7378. 07.07.2026 3,9,14,22,35,44',
      '7379. 14.07.2026 1,2,3,4,5,6',
      '7380. 18.07.2026 5,6,12,38,41,43',
    ].join('\r\n');

    const { draws, errors } = parseDlFile(text);

    expect(errors).toEqual([]);
    expect(draws).toHaveLength(3);
    expect(draws[0].drawnAt).toBe('2026-07-07');
  });

  it('tolerates extra/irregular whitespace between fields', () => {
    const text = '7380.    18.07.2026     5,6,12,38,41,43';

    const { draws, errors } = parseDlFile(text);

    expect(errors).toEqual([]);
    expect(draws).toEqual([
      {
        drawNumber: 7380,
        drawnAt: '2026-07-18',
        numbers: [5, 6, 12, 38, 41, 43],
        mask: maskFromNumbers([5, 6, 12, 38, 41, 43]),
      },
    ]);
  });

  it('tolerates blank lines interspersed in the file', () => {
    const text = [
      '7378. 07.07.2026 3,9,14,22,35,44',
      '',
      '   ',
      '7379. 14.07.2026 1,2,3,4,5,6',
      '',
    ].join('\n');

    const { draws, errors } = parseDlFile(text);

    expect(errors).toEqual([]);
    expect(draws).toHaveLength(2);
  });

  it('returns {draws: [], errors: []} for an empty file', () => {
    expect(parseDlFile('')).toEqual({ draws: [], errors: [] });
  });

  it('never throws and collects an error for a line with only 5 numbers', () => {
    const { draws, errors } = parseDlFile('7380. 18.07.2026 5,6,12,38,41');

    expect(draws).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 1, raw: '7380. 18.07.2026 5,6,12,38,41' });
    expect(errors[0].reason).toMatch(/6/);
  });

  it('never throws and collects an error for a line with 7 numbers', () => {
    const { draws, errors } = parseDlFile('7380. 18.07.2026 5,6,12,38,41,43,44');

    expect(draws).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/6/);
  });

  it('never throws and collects an error for a number of 0 (below range)', () => {
    const { draws, errors } = parseDlFile('7380. 18.07.2026 0,6,12,38,41,43');

    expect(draws).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/range/i);
  });

  it('never throws and collects an error for a number of 50 (above range)', () => {
    const { draws, errors } = parseDlFile('7380. 18.07.2026 5,6,12,38,41,50');

    expect(draws).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/range/i);
  });

  it('never throws and collects an error for non-ascending numbers', () => {
    const { draws, errors } = parseDlFile('7380. 18.07.2026 6,5,12,38,41,43');

    expect(draws).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/ascending/i);
  });

  it('never throws and collects an error for repeated (non-strictly-ascending) numbers', () => {
    const { draws, errors } = parseDlFile('7380. 18.07.2026 5,5,12,38,41,43');

    expect(draws).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/ascending/i);
  });

  it('never throws and collects an error for a garbage line', () => {
    const { draws, errors } = parseDlFile('this is not a draw line at all');

    expect(draws).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 1, raw: 'this is not a draw line at all' });
  });

  it('never throws and collects an error for an invalid calendar date (31.02 does not exist)', () => {
    const { draws, errors } = parseDlFile('7380. 31.02.2026 5,6,12,38,41,43');

    expect(draws).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/date/i);
  });

  it('rejects Feb 29 on a non-leap year but accepts it on a leap year', () => {
    const nonLeap = parseDlFile('1. 29.02.2026 5,6,12,38,41,43');
    const leap = parseDlFile('1. 29.02.2024 5,6,12,38,41,43');

    expect(nonLeap.draws).toEqual([]);
    expect(nonLeap.errors).toHaveLength(1);
    expect(leap.errors).toEqual([]);
    expect(leap.draws[0].drawnAt).toBe('2024-02-29');
  });

  it('collects errors for many bad lines at once while still parsing the good ones, without throwing', () => {
    const text = [
      '7380 18.07.2026 5,6,12,38,41,43', // missing dot after draw number -> malformed
      '7381. 18.07.2026 5,6,12,38,41', // 5 numbers
      '7382. 18.07.2026 5,6,12,38,41,43,44', // 7 numbers
      '7383. 18.07.2026 0,6,12,38,41,43', // number 0
      '7384. 18.07.2026 5,6,12,38,41,50', // number 50
      '7385. 18.07.2026 6,5,12,38,41,43', // non-ascending
      'total garbage, not a draw line', // garbage
      '7386. 31.02.2026 5,6,12,38,41,43', // invalid calendar date
      '',
      '7387. 18.07.2026 5,6,12,38,41,43', // valid, after all the noise
    ].join('\n');

    expect(() => parseDlFile(text)).not.toThrow();
    const { draws, errors } = parseDlFile(text);

    expect(draws).toEqual([
      {
        drawNumber: 7387,
        drawnAt: '2026-07-18',
        numbers: [5, 6, 12, 38, 41, 43],
        mask: maskFromNumbers([5, 6, 12, 38, 41, 43]),
      },
    ]);
    // malformed dot, 5 numbers, 7 numbers, zero, fifty, non-ascending, garbage, invalid date
    expect(errors).toHaveLength(8);
  });
});

describe('validateContinuity', () => {
  it('returns an empty list when draw numbers are continuous 1..max', () => {
    const draws = [1, 2, 3, 4, 5].map((n) => ({ drawNumber: n }));
    expect(validateContinuity(draws)).toEqual([]);
  });

  it('detects a single gap in the numbering', () => {
    const draws = [1, 2, 4].map((n) => ({ drawNumber: n }));
    expect(validateContinuity(draws)).toEqual([3]);
  });

  it('detects multiple gaps and does not care about draw array order', () => {
    const draws = [6, 1, 4].map((n) => ({ drawNumber: n }));
    expect(validateContinuity(draws)).toEqual([2, 3, 5]);
  });

  it('is not confused by legitimately duplicate dates (only draw_number continuity matters)', () => {
    // Continuous 1..423 numbering, but draws 421 and 422 legitimately share a date.
    const draws = Array.from({ length: 423 }, (_, i) => ({
      drawNumber: i + 1,
      drawnAt: '1965-01-01',
    }));
    draws[420] = { drawNumber: 421, drawnAt: '1965-03-07' };
    draws[421] = { drawNumber: 422, drawnAt: '1965-03-07' };

    expect(validateContinuity(draws)).toEqual([]);
  });

  it('returns an empty list for an empty draws array', () => {
    expect(validateContinuity([])).toEqual([]);
  });
});
