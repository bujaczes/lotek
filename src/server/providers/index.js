import * as openapi from './openapi.js';
import * as lottopl from './lottopl.js';
import * as mbnet from './mbnet.js';

/**
 * Default provider chain: `openapi` only participates when `LOTTO_API_KEY` is set (it
 * self-disables by throwing otherwise, see openapi.js), so in practice — no key
 * available — the working chain is `[lottopl, mbnet]`. Order matters: openapi is the
 * official, most-trustworthy source when available; lottopl is the unofficial-but-live
 * fallback; mbnet (a static dl.txt, always the *complete* history) is the last resort.
 */
export function defaultProviderChain({ apiKey = process.env.LOTTO_API_KEY } = {}) {
  const chain = [];
  if (apiKey) chain.push(openapi);
  chain.push(lottopl, mbnet);
  return chain;
}

/**
 * Runs `sinceDrawNumber` through the provider chain in order; the first provider whose
 * `fetchSince` resolves without throwing wins outright (even with an empty array — an
 * empty result from the primary provider means "nothing new", not "try the next one").
 * Every failure is logged (via `onProviderError`, defaulting to `console.error`, so
 * callers/tests can capture it) and swallowed to try the next provider. If every
 * provider in the chain throws, this throws too, with every provider's message
 * collected so the caller sees the whole picture, not just the last failure.
 */
export async function fetchSince(
  sinceDrawNumber,
  { fetchFn = fetch, now = () => new Date(), sinceDrawnAt, providers, onProviderError } = {}
) {
  const chain = providers ?? defaultProviderChain();
  const logError = onProviderError ?? ((source, err) => console.error(`[providers] ${source} failed: ${err.message}`));
  const failures = [];

  for (const provider of chain) {
    try {
      const draws = await provider.fetchSince(sinceDrawNumber, { fetchFn, now, sinceDrawnAt });
      return { draws, provider: provider.SOURCE };
    } catch (err) {
      failures.push(`${provider.SOURCE}: ${err.message}`);
      logError(provider.SOURCE, err);
    }
  }

  throw new Error(`all providers failed: ${failures.join('; ')}`);
}

export { openapi, lottopl, mbnet };
