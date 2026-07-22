import { describe, expect, it } from 'vitest';
import { binomial, C_49_6, hitProbability, HIT_PROBABILITIES, expectedHits, oddsFor } from '../src/hits-theory.js';

// Anchors from docs/CONVENTIONS.md ("Kotwice matematyczne").
describe('hits theory (frontend copy of the hypergeometric hit distribution)', () => {
  it('reproduces C(49,6) exactly', () => {
    expect(C_49_6).toBe(13983816);
    expect(binomial(49, 6)).toBe(13983816);
  });

  it('matches the documented hit distribution numerators', () => {
    expect(hitProbability(3) * C_49_6).toBeCloseTo(246820, 6);
    expect(hitProbability(4) * C_49_6).toBeCloseTo(13545, 6);
    expect(hitProbability(5) * C_49_6).toBeCloseTo(258, 6);
    expect(hitProbability(6) * C_49_6).toBeCloseTo(1, 9);
  });

  it('sums to the expected 36/49 hits per coupon over all k', () => {
    let mean = 0;
    for (let k = 0; k <= 6; k += 1) mean += k * hitProbability(k);
    expect(mean).toBeCloseTo(36 / 49, 12);
  });

  it('exposes a frozen table for the four paying tiers', () => {
    expect(Object.keys(HIT_PROBABILITIES)).toEqual(['3', '4', '5', '6']);
    expect(Object.isFrozen(HIT_PROBABILITIES)).toBe(true);
  });

  it('scales to the number of draws played', () => {
    const expected = expectedHits(7380);
    expect(expected[3]).toBeCloseTo((246820 / 13983816) * 7380, 6);
    expect(expected[6]).toBeCloseTo(7380 / 13983816, 12);
  });

  it('states the six-hit odds as 1 : 13 983 816', () => {
    expect(oddsFor(6)).toBe(13983816);
    expect(oddsFor(3)).toBe(57);
  });
});
