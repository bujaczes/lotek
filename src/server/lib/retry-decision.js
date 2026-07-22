/**
 * Pure retry decision for the scheduler's fetch cycle (Task 13): given how many retries
 * have already happened and the configured ceiling, says whether to try again or give up.
 * No I/O, no clock, no croner — deliberately extracted so `scheduler.js`'s retry loop can
 * be driven by an injected scheduler (`setTimeout` in production, a synchronous or
 * fake-timer stand-in in tests) instead of coupling test coverage to croner's internals.
 *
 * `attempt` is the number of retries already performed (0 right after the initial fetch
 * cycle attempt found nothing new). Retries while `attempt < maxAttempts`; the retry that
 * would be numbered `maxAttempts` is never taken — attempt `maxAttempts` immediately
 * gives up instead.
 */
export function decideRetry({ attempt, maxAttempts }) {
  if (attempt >= maxAttempts) {
    return { action: 'give_up' };
  }
  return { action: 'retry', nextAttempt: attempt + 1 };
}
