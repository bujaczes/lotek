export const DEFAULT_FETCH_TIMEOUT_MS = 20000;

/**
 * Wraps `fetchFn(url, options)` with a hard deadline: rejects after `timeoutMs` if
 * `fetchFn` hasn't settled by then. A real `fetch()` honors the `AbortSignal` passed in
 * via `options.signal` and rejects promptly on its own; this additionally races a
 * `setTimeout`-driven rejection tied to that same signal, so the caller stays bounded
 * even against an injected test double (or any other `fetchFn`) that ignores the
 * signal entirely — the point that matters operationally: a Cloudflare challenge or a
 * dead socket that neither resolves nor rejects can never hang a scheduled run forever
 * (Task 13 turns `fetch-latest` into a cron job).
 *
 * A timeout surfaces as a plain rejection — same shape as any other `fetchFn` failure —
 * so the provider chain (`providers/index.js`) already treats it as "this provider is
 * down right now" and falls through, no special-casing needed at the call site.
 */
export async function fetchWithTimeout(fetchFn, url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.(); // never keep a CLI run (or a test) alive just for this timer

  try {
    return await Promise.race([
      fetchFn(url, { ...options, signal: controller.signal }),
      new Promise((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error(`timed out after ${timeoutMs}ms fetching ${url}`)),
          { once: true }
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
