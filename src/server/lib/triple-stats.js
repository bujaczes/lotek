import { P_SPECIFIC_TRIPLE } from './theory.js';

/**
 * Pure computation (no db) of every OBSERVED 3-number combination (a<b<c) across `draws`,
 * each draw contributing exactly C(6,3)=20 triples. Unlike computePairStats (which always
 * returns the full 1176-row universe, cheap at that size), triples has C(49,3)=18424
 * possible combinations — most never observed — so this only tracks (and returns) triples
 * that actually occurred at least once, sorted descending by cnt (ties broken by ascending
 * numbers), optionally sliced to the top `top` (default 15, per the brief's endpoint).
 */
export function computeTripleStats(draws, { top = 15 } = {}) {
  const counts = new Map();

  for (const draw of draws) {
    const nums = draw.numbers;
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        for (let k = j + 1; k < nums.length; k++) {
          const key = nums[i] * 10000 + nums[j] * 100 + nums[k]; // a<b<c, both <=49, collision-free
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
  }

  const expected = draws.length * P_SPECIFIC_TRIPLE;

  const rows = [];
  for (const [key, cnt] of counts) {
    const a = Math.floor(key / 10000);
    const b = Math.floor((key % 10000) / 100);
    const c = key % 100;
    rows.push({ numbers: [a, b, c], cnt, expected, lift: expected > 0 ? cnt / expected : 0 });
  }

  rows.sort((r1, r2) => r2.cnt - r1.cnt || (r1.numbers.join(',') < r2.numbers.join(',') ? -1 : 1));

  return rows.slice(0, top);
}
