// server/src/cache/MemoBanDB.ts
//
// Per-isolate memo over a BanDB. isBanned() runs on every leaderboard read, so
// without this each read would pay a D1 point lookup. The memo lives in MODULE
// scope, not on the instance: index.ts constructs its DB objects inside fetch()
// (once per request), while Workers reuse isolates across requests — an
// instance-level cache would never be reused.
//
// Staleness: a ban placed on one isolate is invisible to others until their
// entry expires, so a ban takes full effect within TTL_MS. That deliberately
// matches SCORES_TTL in CachedScoreDB, so the two staleness windows are the
// same number and there is one story to tell about how long a ban takes.

import type { BanDB, BanRow } from '../banDb';

const TTL_MS = 60_000;
/** Hard cap so a flood of distinct ids cannot grow the memo without bound. */
const MAX_ENTRIES = 5000;

const memo = new Map<string, { banned: boolean; expiresAt: number }>();

/** Test-only: drop every memoised entry. */
export function __resetBanMemo(): void {
  memo.clear();
}

export class MemoBanDB implements BanDB {
  constructor(
    private inner: BanDB,
    private ttlMs: number = TTL_MS,
    /** Injectable clock — tests advance it instead of sleeping. */
    private now: () => number = () => Date.now(),
  ) {}

  async isBanned(playerId: string): Promise<boolean> {
    const t   = this.now();
    const hit = memo.get(playerId);
    if (hit && hit.expiresAt > t) return hit.banned;

    const banned = await this.inner.isBanned(playerId);
    // Wholesale clear rather than LRU eviction: the working set is tiny in
    // practice, and a periodic cold start costs one D1 read per active player.
    if (memo.size >= MAX_ENTRIES) memo.clear();
    memo.set(playerId, { banned, expiresAt: t + this.ttlMs });
    return banned;
  }

  // Admin-only reads — never memoised, so the admin UI always sees the truth.
  get(playerId: string): Promise<BanRow | null> { return this.inner.get(playerId); }
  list(): Promise<BanRow[]>                     { return this.inner.list(); }

  // Writes go through, then drop the entry so THIS isolate is immediately
  // correct. Other isolates converge within the TTL.
  async ban(playerId: string, reason: string | null, now: string): Promise<void> {
    await this.inner.ban(playerId, reason, now);
    memo.delete(playerId);
  }

  async unban(playerId: string): Promise<void> {
    await this.inner.unban(playerId);
    memo.delete(playerId);
  }
}
