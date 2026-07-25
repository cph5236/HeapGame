// Shared config for the k6 scenarios. Values come from the k6 CLI environment
// (`k6 run -e BASE_URL=... `), exposed as the __ENV global inside k6.

/* global __ENV */

// __ENV only exists inside the k6 runtime. Under vitest (and any other plain
// Node/ESM consumer) it is undefined, so guard the lookup rather than
// referencing the global directly.
const ENV = typeof __ENV !== 'undefined' ? __ENV : {};

export const BASE_URL = ENV.BASE_URL || 'http://localhost:8787';
export const LOADTEST_SECRET = ENV.LOADTEST_SECRET || '';

/** Fraction of sessions that mint a brand-new identity, exercising the TOFU
 *  claim-on-first-write path. The rest reuse the seeded pool, which keeps
 *  score-submit KV invalidations low. */
export const NEW_IDENTITY_RATE = Number(ENV.NEW_IDENTITY_RATE || 0.05);

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
