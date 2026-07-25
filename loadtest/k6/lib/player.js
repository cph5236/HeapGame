// Per-VU player identity selection. Pure — no k6 imports — so vitest can
// exercise it directly. `rand` is injected for determinism in tests.

import { NEW_IDENTITY_RATE } from './config.js';

// `salt` is XORed into every nibble so that two back-to-back uuid() calls
// sharing the same closed-over `rand` (e.g. a constant test double like
// `() => 0.0`) still diverge — otherwise a fresh-mint identity's playerId and
// playerSecret would collide whenever rand() isn't actually random.
function uuid(rand, salt = 0) {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = ((rand() * 16) | 0) ^ salt;
    const v = ch === 'x' ? r & 0xf : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Choose the identity a session runs as.
 *
 * Most sessions reuse a seeded identity: real traffic is mostly returning
 * players whose stored best already exists, so their submissions rarely move
 * the leaderboard and rarely invalidate the score cache. A small fraction mint
 * a fresh identity to keep the TOFU claim path covered.
 *
 * @param {Array<{playerId: string, playerSecret: string}>} pool
 * @param {number} vuId       k6's __VU
 * @param {number} iteration  k6's __ITER
 * @param {() => number} rand injectable RNG, defaults to Math.random
 * @returns {{playerId: string, playerSecret: string, isNew: boolean}}
 */
export function pickIdentity(pool, vuId, iteration, rand = Math.random) {
  if (rand() < NEW_IDENTITY_RATE || pool.length === 0) {
    return { playerId: uuid(rand, 0x0), playerSecret: uuid(rand, 0xf), isNew: true };
  }
  const idx = (vuId * 31 + iteration) % pool.length;
  const picked = pool[idx];
  return { playerId: picked.playerId, playerSecret: picked.playerSecret, isNew: false };
}
