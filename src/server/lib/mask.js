const MAX_NUMBER = 49;

export function maskFromNumbers(numbers) {
  let mask = 0;
  for (const n of numbers) {
    mask += 2 ** (n - 1);
  }
  return mask;
}

export function numbersFromMask(mask) {
  const numbers = [];
  let remaining = mask;
  for (let n = 1; n <= MAX_NUMBER; n++) {
    if (remaining % 2 === 1) numbers.push(n);
    remaining = Math.floor(remaining / 2);
  }
  return numbers;
}

function popcount32(x) {
  x = x >>> 0;
  let count = 0;
  while (x) {
    x &= x - 1;
    count++;
  }
  return count;
}

// mask fits in 49 bits (< 2^53) but bitwise ops in JS only work on 32-bit ints,
// so we split into low/high 32-bit halves and count each with a loop (no BigInt).
export function popcount(mask) {
  const lo = mask >>> 0;
  const hi = Math.floor(mask / 0x100000000) >>> 0;
  return popcount32(lo) + popcount32(hi);
}
