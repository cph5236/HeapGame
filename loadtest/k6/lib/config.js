// Shared config for the k6 scenarios. Values come from the k6 CLI environment
// (`k6 run -e BASE_URL=... `), exposed as the __ENV global inside k6.

/* global __ENV */

// __ENV only exists inside the k6 runtime. Under vitest (and any other plain
// Node/ESM consumer) it is undefined, so guard the lookup rather than
// referencing the global directly.
const ENV = typeof __ENV !== 'undefined' ? __ENV : {};

export const BASE_URL = ENV.BASE_URL || 'http://localhost:8787';
export const LOADTEST_SECRET = ENV.LOADTEST_SECRET || '';

/**
 * Parses a numeric `-e` override, honouring an explicit falsy value like `0`
 * instead of discarding it. `Number(raw || fallback)` — the pattern this
 * replaces — treats `0` the same as "unset" because `0 || fallback`
 * evaluates the fallback, which silently breaks any var whose valid range
 * includes zero (e.g. `-e NEW_IDENTITY_RATE=0` or `-e PLACE_RATE=0` to pin a
 * run to the seeded pool / disable placements). Only genuinely absent
 * (`undefined`) or blank (`''` — e.g. a shell var that's exported but empty)
 * fall back to `fallback`; every other value, including `'0'`, is parsed as
 * given. Exported so every module reading a numeric `__ENV` var shares one
 * correct rule instead of each re-implementing (and re-breaking) it.
 */
export function numEnv(raw, fallback) {
  return raw === undefined || raw === '' ? fallback : Number(raw);
}

/** Fraction of sessions that mint a brand-new identity, exercising the TOFU
 *  claim-on-first-write path. The rest reuse the seeded pool, which keeps
 *  score-submit KV invalidations low. */
export const NEW_IDENTITY_RATE = numEnv(ENV.NEW_IDENTITY_RATE, 0.05);

/**
 * Headers that make the Worker's rate limiter treat this VU as its own client,
 * modelling players arriving from distinct IPs. Honoured only when the staging
 * Worker has LOADTEST_SECRET set; inert everywhere else.
 */
export function loadTestHeaders(vuKey) {
  if (!LOADTEST_SECRET) return {};
  return {
    'X-LoadTest-Secret': LOADTEST_SECRET,
    'X-LoadTest-Key': vuKey,
  };
}
