// Per-VU player identity selection. Pure — no k6 imports — so vitest can
// exercise it directly. `rand` is injected for determinism in tests.

import { NEW_IDENTITY_RATE } from './config.js';

function uuid(rand) {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (rand() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
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
    return { playerId: uuid(rand), playerSecret: uuid(rand), isNew: true };
  }
  const idx = (vuId * 31 + iteration) % pool.length;
  const picked = pool[idx];
  return { playerId: picked.playerId, playerSecret: picked.playerSecret, isNew: false };
}
