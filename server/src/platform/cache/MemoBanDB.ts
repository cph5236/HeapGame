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
// matches the SCORES_TTL duration in CachedScoreDB (60s in both places, but
// two different literals: this one in ms, that one in seconds) — not so the
// windows always favour the ban, but so there is one 60-second number to
// reason about.
//
// That window does not only work in the ban's favour. CachedScoreDB.getTopScores
// calls isBanned(viewerId) through this same memo to decide whether to bypass
// its own cache for a banned viewer looking at their own board. If an isolate
// memoised "not banned" for that player just before the ban landed, the bypass
// is skipped for the rest of this entry's TTL and the ban-filtered public blob
// is served to them — so the banned player can briefly vanish from their own
// top-N, which is the opposite of the intended tolerance. This window is
// self-healing (≤60s, same TTL) and cosmetic: the player's own rank card is
// built from getScore + getRank, neither of which goes through this memo, so
// their score and rank stay correct throughout. See "Accepted consequences" in
// docs/superpowers/specs/2026-08-16-admin-shadow-ban-design.md.

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
