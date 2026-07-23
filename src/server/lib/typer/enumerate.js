import { performance } from 'node:perf_hooks';
import { LINE_IDS, penaltyMultiplierScalar } from './popularity.js';

const MAX_NUMBER = 49;
const TOP_K = 4;

// 2^(n-1) per number, so a combo mask accumulates exactly (49 bits < 2^53) as we descend
// the nested loops. Built once per enumeration.
function buildPow2() {
  const p2 = new Float64Array(MAX_NUMBER + 1);
  for (let n = 1; n <= MAX_NUMBER; n++) p2[n] = 2 ** (n - 1);
  return p2;
}

/**
 * Full lexicographic enumeration of all C(49,6) = 13 983 816 combinations (six nested
 * loops n1<n2<...<n6), returning the global top-4 by
 *   score(S) = wA·Σ z̃(n_i) − wB·popularity(S),  popularity(S) = (Σ w(n_i))·penalty(S)
 * with a strict-greater replacement rule so ties break lexicographically (the earlier
 * combo, encountered first, keeps the higher slot). Fully deterministic: no RNG, no clock
 * in the scoring, IEEE-754 ops in a fixed order.
 *
 * params: { W:number[49], Z:number[49], wA, wB, P (buildPenaltyParams), winnerMasks
 *   (Set|iterable of masks), targetPop (optional) }. When `targetPop` is finite, also
 * counts `popRankGreater` = #combos with popularity strictly greater than targetPop, in
 * the SAME pass (popularity is computed for every combo anyway) — the popularity-rank of
 * the target combo is popRankGreater + 1.
 *
 * Returns { top: [{numbers, totalScore, bias, popularity}×4], popRankGreater,
 *   combosProcessed, elapsedMs }.
 */
export function enumerateTopK(params) {
  const { W, Z, wA, wB, P } = params;
  const winnerMasks = params.winnerMasks instanceof Set ? params.winnerMasks : new Set(params.winnerMasks ?? []);
  const targetPop = params.targetPop ?? Infinity;
  const L = LINE_IDS;
  const P2 = buildPow2();

  // top-4, descending by score. -Infinity sentinels so the first four combos always fill.
  const bestScore = new Float64Array(TOP_K).fill(-Infinity);
  const bestBias = new Float64Array(TOP_K);
  const bestPop = new Float64Array(TOP_K);
  const bestNums = [null, null, null, null];
  let threshold = -Infinity;

  let popRankGreater = 0;
  let combosProcessed = 0;
  const start = performance.now();

  for (let a = 1; a <= 44; a++) {
    const wa = W[a - 1];
    const za = Z[a - 1];
    const ma = P2[a];
    for (let b = a + 1; b <= 45; b++) {
      const wb = wa + W[b - 1];
      const zb = za + Z[b - 1];
      const mb = ma + P2[b];
      const sb = a + b;
      for (let c = b + 1; c <= 46; c++) {
        const wc = wb + W[c - 1];
        const zc = zb + Z[c - 1];
        const mc = mb + P2[c];
        const sc = sb + c;
        for (let d = c + 1; d <= 47; d++) {
          const wd = wc + W[d - 1];
          const zd = zc + Z[d - 1];
          const md = mc + P2[d];
          const sd = sc + d;
          for (let e = d + 1; e <= 48; e++) {
            const we = wd + W[e - 1];
            const ze = zd + Z[e - 1];
            const me = md + P2[e];
            const se = sd + e;
            for (let f = e + 1; f <= 49; f++) {
              const sw = we + W[f - 1];
              const sz = ze + Z[f - 1];
              const mask = me + P2[f];
              const sum = se + f;
              const pen = penaltyMultiplierScalar(a, b, c, d, e, f, sum, mask, P, winnerMasks, L);
              const pop = sw * pen;
              const score = wA * sz - wB * pop;
              combosProcessed++;
              if (pop > targetPop) popRankGreater++;
              if (score > threshold) {
                let i = TOP_K - 1;
                while (i > 0 && score > bestScore[i - 1]) i--;
                for (let j = TOP_K - 1; j > i; j--) {
                  bestScore[j] = bestScore[j - 1];
                  bestBias[j] = bestBias[j - 1];
                  bestPop[j] = bestPop[j - 1];
                  bestNums[j] = bestNums[j - 1];
                }
                bestScore[i] = score;
                bestBias[i] = sz;
                bestPop[i] = pop;
                bestNums[i] = [a, b, c, d, e, f];
                threshold = bestScore[TOP_K - 1];
              }
            }
          }
        }
      }
    }
  }

  const elapsedMs = performance.now() - start;
  const top = [];
  for (let i = 0; i < TOP_K; i++) {
    top.push({
      numbers: bestNums[i],
      totalScore: bestScore[i],
      bias: bestBias[i],
      popularity: bestPop[i],
    });
  }
  return { top, popRankGreater, combosProcessed, elapsedMs };
}
