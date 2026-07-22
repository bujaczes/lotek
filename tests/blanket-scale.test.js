import { describe, expect, it } from 'vitest';
import {
  lerpHex,
  heatColor,
  divergingColor,
  freshnessDotColor,
  buildFieldData,
  HEAT_STOPS,
  DIVERGING,
} from '../src/blanket-scale.js';

describe('lerpHex', () => {
  it('returns the endpoints unchanged at t=0 and t=1', () => {
    expect(lerpHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(lerpHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('interpolates each channel linearly at the midpoint', () => {
    expect(lerpHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('clamps t outside [0,1]', () => {
    expect(lerpHex('#000000', '#ffffff', -1)).toBe('#000000');
    expect(lerpHex('#000000', '#ffffff', 2)).toBe('#ffffff');
  });
});

describe('heatColor (sequential #fff3c4 -> #ffc400 -> #e4372e)', () => {
  it('hits the three scale stops at 0, 0.5, 1', () => {
    expect(heatColor(0)).toBe(HEAT_STOPS[0]);
    expect(heatColor(0.5)).toBe(HEAT_STOPS[1]);
    expect(heatColor(1)).toBe(HEAT_STOPS[2]);
  });

  it('produces an intermediate color strictly between the low stops for t=0.25', () => {
    const c = heatColor(0.25);
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(c).not.toBe(HEAT_STOPS[0]);
    expect(c).not.toBe(HEAT_STOPS[1]);
  });
});

describe('divergingColor (cool <- neutral -> hot)', () => {
  it('hits cool / neutral / hot at 0, 0.5, 1', () => {
    expect(divergingColor(0)).toBe(DIVERGING.cool);
    expect(divergingColor(0.5)).toBe(DIVERGING.neutral);
    expect(divergingColor(1)).toBe(DIVERGING.hot);
  });
});

describe('freshnessDotColor (green fresh -> red long-absent)', () => {
  it('is green at gap 0 and red at the max gap', () => {
    expect(freshnessDotColor(0, 60)).toBe('#0e9f6e');
    expect(freshnessDotColor(60, 60)).toBe('#e4372e');
  });
});

describe('buildFieldData — mode data selection', () => {
  // 3 numbers with contrasting stats; enough to exercise domain endpoints.
  const entries = [
    { number: 1, total: 820, currentGap: 0, zScore: -2.8 }, // rarest, freshest, coldest
    { number: 2, total: 900, currentGap: 30, zScore: 0 }, // middling
    { number: 3, total: 977, currentGap: 60, zScore: 2.5 }, // most frequent, stalest, hottest
  ];

  it('frequency: hottest = most frequent number, palest = rarest', () => {
    const fields = buildFieldData(entries, 'frequency');
    const by = Object.fromEntries(fields.map((f) => [f.number, f]));
    expect(by[3].t).toBe(1); // max total -> top of scale
    expect(by[1].t).toBe(0); // min total -> bottom
    expect(by[3].fill).toBe(heatColor(1));
    expect(by[1].fill).toBe(heatColor(0));
    expect(by[1].value).toBe(820);
  });

  it('freshness: currentGap inverted — freshest number is hottest', () => {
    const fields = buildFieldData(entries, 'freshness');
    const by = Object.fromEntries(fields.map((f) => [f.number, f]));
    expect(by[1].t).toBe(1); // gap 0 (fresh) -> top of scale
    expect(by[3].t).toBe(0); // gap 60 (stale) -> bottom
    expect(by[1].value).toBe(0);
  });

  it('zscore: diverging — positive is hot side, negative is cool side, zero is neutral', () => {
    const fields = buildFieldData(entries, 'zscore');
    const by = Object.fromEntries(fields.map((f) => [f.number, f]));
    expect(by[2].t).toBeCloseTo(0.5, 10); // z = 0 -> center
    expect(by[3].t).toBeGreaterThan(0.5); // positive -> hot half
    expect(by[1].t).toBeLessThan(0.5); // negative -> cool half
    expect(by[2].fill).toBe(DIVERGING.neutral);
  });

  it('is robust to a null zScore (neutral, no crash)', () => {
    const fields = buildFieldData([{ number: 5, total: 900, currentGap: 3, zScore: null }], 'zscore');
    expect(fields[0].t).toBeNull();
    expect(fields[0].value).toBeNull();
  });

  it('returns one field per entry, preserving number', () => {
    const fields = buildFieldData(entries, 'frequency');
    expect(fields.map((f) => f.number)).toEqual([1, 2, 3]);
  });
});
