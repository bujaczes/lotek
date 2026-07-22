import { describe, expect, it } from 'vitest';
import {
  numberWeights,
  comboPenalty,
  popularity,
  penaltyBreakdown,
  hasLine4,
  buildPenaltyParams,
} from '../src/server/lib/typer/popularity.js';
import { loadTyperConfig } from '../src/server/lib/typer/config.js';
import { maskFromNumbers } from '../src/server/lib/mask.js';

const cfg = loadTyperConfig();
const P = cfg.popularity;

describe('numberWeights — per-number popularity weight w[49]', () => {
  const w = numberWeights(cfg);

  it('returns 49 weights, index 0 = number 1', () => {
    expect(w).toHaveLength(49);
  });

  it('birthday + day/month bonuses stack for n <= 12', () => {
    // number 1: base + birthdayBonus + dayMonthBonus, no lucky/discount
    expect(w[0]).toBeCloseTo(P.base + P.birthdayBonus + P.dayMonthBonus, 12); // 1.6
  });

  it('n = 13..31 gets only the birthday bonus (no day/month)', () => {
    expect(w[13]).toBeCloseTo(P.base + P.birthdayBonus, 12); // number 14 = 1.35
  });

  it('lucky multiplier applies on top of the bonuses', () => {
    // number 7: (base + 0.35 + 0.25) * 1.25
    expect(w[6]).toBeCloseTo((P.base + P.birthdayBonus + P.dayMonthBonus) * P.luckyMultipliers[7], 12);
    // number 13: (base + 0.35) * 1.2  (13 > 12, no day/month)
    expect(w[12]).toBeCloseTo((P.base + P.birthdayBonus) * P.luckyMultipliers[13], 12);
  });

  it('numbers 40..49 get the high-band discount and no birthday bonus', () => {
    expect(w[39]).toBeCloseTo(P.base * P.highDiscount, 12); // number 40 = 0.85
    expect(w[48]).toBeCloseTo(P.base * P.highDiscount, 12); // number 49 = 0.85
  });

  it('mid numbers 32..39 are exactly the base (no bonus, no discount)', () => {
    expect(w[31]).toBeCloseTo(P.base, 12); // number 32 = 1.0
  });
});

describe('hasLine4 — blankiet 7×7 colinearity (>=4 on a line)', () => {
  it('flags a ↘ diagonal of length 4 (numbers 1,9,17,25 share row-col)', () => {
    // 1->(0,0) 9->(1,1) 17->(2,2) 25->(3,3): all on the main diagonal. Fillers 40,44
    // do not extend or form another line of >=4.
    expect(hasLine4(1, 9, 17, 25, 40, 44)).toBe(true);
  });

  it('flags a full row (numbers 1..6 all sit in row 0)', () => {
    expect(hasLine4(1, 2, 3, 4, 5, 6)).toBe(true);
  });

  it('flags a column (1,8,15,22 share column 0)', () => {
    expect(hasLine4(1, 8, 15, 22, 40, 44)).toBe(true);
  });

  it('does NOT flag a scattered non-line set', () => {
    expect(hasLine4(1, 10, 20, 30, 41, 49)).toBe(false);
  });

  it('does NOT flag only 3 colinear (needs >=4)', () => {
    // 1,9,17 on the diagonal (only 3); rest scattered
    expect(hasLine4(1, 9, 17, 4, 28, 46)).toBe(false);
  });
});

describe('comboPenalty — pattern penalty product (SPEC §8.2)', () => {
  const noWinners = new Set();

  it('is 1.0 for a clean scattered set (no pattern)', () => {
    // no run>=3, no line>=4, mixed high/low, sum>=120, not a historical winner
    expect(comboPenalty([2, 15, 23, 34, 41, 48], cfg, noWinners)).toBeCloseTo(1.0, 12);
  });

  it('applies run3·runPerExtra^(L-3) per maximal run; multiple runs multiply', () => {
    // {3,4,5} and {40,41,42}: two runs of length 3 -> run3^2 (runPerExtra^0 each). One run
    // low, one high so it is neither allBirthday nor allHigh; sum 135 >= 120; no 4 colinear
    // and not a historical winner -> the run factor is the ONLY penalty.
    const nums = [3, 4, 5, 40, 41, 42];
    const bd = penaltyBreakdown(nums, cfg, noWinners);
    expect(bd.runs).toEqual([3, 3]);
    expect(bd.line4plus).toBe(false);
    expect(bd.allBirthday).toBe(false);
    expect(bd.lowSum).toBe(false);
    expect(comboPenalty(nums, cfg, noWinners)).toBeCloseTo(P.penalties.run3 ** 2, 12);
  });

  it('a run of length 4 gives run3·runPerExtra^1', () => {
    const bd = penaltyBreakdown([10, 11, 12, 13, 27, 45], cfg, noWinners);
    expect(bd.runs).toEqual([4]);
    expect(bd.runFactor).toBeCloseTo(P.penalties.run3 * P.penalties.runPerExtra, 12);
  });

  it('applies allBirthday when every number <= 31, allHigh when every number >= 32', () => {
    expect(penaltyBreakdown([2, 8, 15, 20, 27, 31], cfg, noWinners).allBirthday).toBe(true);
    expect(penaltyBreakdown([2, 8, 15, 20, 27, 31], cfg, noWinners).allHigh).toBe(false);
    expect(penaltyBreakdown([32, 35, 40, 44, 47, 49], cfg, noWinners).allHigh).toBe(true);
    expect(penaltyBreakdown([32, 35, 40, 44, 47, 49], cfg, noWinners).allBirthday).toBe(false);
  });

  it('applies the historicalWinner penalty when the mask matches a past winning six', () => {
    const nums = [3, 11, 19, 27, 35, 43];
    const winners = new Set([maskFromNumbers(nums)]);
    const withWinner = comboPenalty(nums, cfg, winners);
    const without = comboPenalty(nums, cfg, new Set());
    expect(withWinner / without).toBeCloseTo(P.penalties.historicalWinner, 12);
  });
});

describe('1-2-3-4-5-6 — the canonical over-played coupon', () => {
  const noWinners = new Set();

  it('carries run3·runPerExtra^3 (one run of 6), allBirthday and lowSum penalties', () => {
    const bd = penaltyBreakdown([1, 2, 3, 4, 5, 6], cfg, noWinners);
    expect(bd.runs).toEqual([6]); // a single maximal run of length 6
    expect(bd.runFactor).toBeCloseTo(P.penalties.run3 * P.penalties.runPerExtra ** 3, 12);
    expect(bd.allBirthday).toBe(true);
    expect(bd.lowSum).toBe(true); // sum 21 < 120
    expect(bd.allHigh).toBe(false);
  });

  it('popularity = (Σw) · penalty matches the hand-computed value', () => {
    const w = numberWeights(cfg);
    const sumW = [1, 2, 3, 4, 5, 6].reduce((s, n) => s + w[n - 1], 0);
    const pen = comboPenalty([1, 2, 3, 4, 5, 6], cfg, noWinners);
    expect(popularity([1, 2, 3, 4, 5, 6], cfg, noWinners)).toBeCloseTo(sumW * pen, 10);
  });
});

describe('buildPenaltyParams — flattened config for the hot loop', () => {
  it('precomputes runPerExtra powers 0..3', () => {
    const pp = buildPenaltyParams(cfg);
    const x = P.penalties.runPerExtra;
    expect(pp.runExtraPow).toEqual([1, x, x * x, x * x * x]);
  });
});
