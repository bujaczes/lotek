import { describe, expect, it } from 'vitest';
import { decideRetry } from '../src/server/lib/retry-decision.js';

// Pure retry-decision logic, extracted out of scheduler.js/croner entirely (Task 13
// brief: "logika retry wydzielona z cronera do czystej funkcji") so it can be tested
// exhaustively without fake timers or a real Cron instance.
describe('decideRetry({attempt, maxAttempts}) — pure retry decision, no I/O, no clock', () => {
  it('exhaustively: every attempt below maxAttempts retries with nextAttempt = attempt + 1', () => {
    const maxAttempts = 12;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      expect(decideRetry({ attempt, maxAttempts })).toEqual({ action: 'retry', nextAttempt: attempt + 1 });
    }
  });

  it('exhaustively: attempt === maxAttempts gives up (retries exhausted)', () => {
    expect(decideRetry({ attempt: 12, maxAttempts: 12 })).toEqual({ action: 'give_up' });
  });

  it('exhaustively: any attempt beyond maxAttempts also gives up (never retries again)', () => {
    for (const attempt of [13, 14, 100]) {
      expect(decideRetry({ attempt, maxAttempts: 12 })).toEqual({ action: 'give_up' });
    }
  });

  it('is pure: the same input always produces a deep-equal output, no shared mutable state between calls', () => {
    const a = decideRetry({ attempt: 3, maxAttempts: 12 });
    const b = decideRetry({ attempt: 3, maxAttempts: 12 });
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // fresh object each call, no accidental aliasing
  });

  it('edge case: maxAttempts = 0 gives up immediately, even on the very first attempt', () => {
    expect(decideRetry({ attempt: 0, maxAttempts: 0 })).toEqual({ action: 'give_up' });
  });
});
