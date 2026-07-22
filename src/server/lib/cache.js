const store = new Map();

/**
 * Process-wide in-memory memoization: `fn` runs at most once per `key` until the next
 * `invalidateCache()`. `store.has(key)` (not truthiness of the value) decides a hit, so
 * falsy/zero/null results are cached correctly, not recomputed every call.
 */
export function cached(key, fn) {
  if (store.has(key)) return store.get(key);
  const value = fn();
  store.set(key, value);
  return value;
}

/**
 * Clears every cached entry. Called after `rebuildStats` commits (see
 * `src/server/lib/rebuild-stats.js`) so `draw`/`number_stat`/`pair_stat`-derived API
 * responses never serve stale data after an import or manual rebuild. Also exported for
 * direct use by the Faza 4 fetch-latest job and by tests that seed data between calls.
 */
export function invalidateCache() {
  store.clear();
}
