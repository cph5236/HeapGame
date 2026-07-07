// server/src/cache/CachedScoreDB.ts
//
// Workers KV decorator over a ScoreDB. Only the hot leaderboard read
// (getTopScores) is cached; everything else delegates straight to D1.
//
// Caching strategy — deviation from the plan's literal `cache:scores:{heapId}:top:{limit}`:
// the route allows any limit up to MAX_LIMIT (50), and KV has no cheap
// "delete by prefix", so a per-limit key would be impossible to fully
// invalidate on write. Instead we cache the top CACHE_TOP_N rows under a single
// key per heap and slice to the requested limit. Any limit <= CACHE_TOP_N is
// served from that one entry; a larger limit bypasses the cache. Invalidation
// is then a single delete, keeping writes consistent.

import type { ScoreDB, ScoreRow } from '../scoreDb';

/** Cache the top this-many rows per heap; matches MAX_LIMIT in routes/scores.ts. */
const CACHE_TOP_N = 50;
/** Leaderboards tolerate brief staleness; write-invalidation is the primary path.
 *  60 is the floor Workers KV allows for expirationTtl. */
const SCORES_TTL = 60;

export class CachedScoreDB implements ScoreDB {
  constructor(
    private inner: ScoreDB,
    private kv: KVNamespace,
    private waitUntil: (p: Promise<unknown>) => void,
  ) {}

  private topKey(heapId: string): string {
    return `cache:scores:${heapId}:top`;
  }

  async getTopScores(heapId: string, limit: number): Promise<ScoreRow[]> {
    // Larger-than-cached requests bypass the cache entirely.
    if (limit > CACHE_TOP_N) return this.inner.getTopScores(heapId, limit);

    const key = this.topKey(heapId);
    const hit = await this.kv.get<ScoreRow[]>(key, 'json');
    if (hit) return hit.slice(0, limit);

    const top = await this.inner.getTopScores(heapId, CACHE_TOP_N);
    this.waitUntil(this.kv.put(key, JSON.stringify(top), { expirationTtl: SCORES_TTL }));
    return top.slice(0, limit);
  }

  // ---- writes: D1 first, then synchronous invalidation of this heap's top key ----

  async upsertScore(heapId: string, playerId: string, name: string, score: number, now: string): Promise<boolean> {
    const changed = await this.inner.upsertScore(heapId, playerId, name, score, now);
    if (changed) await this.kv.delete(this.topKey(heapId));
    return changed;
  }

  async pruneScores(heapId: string): Promise<void> {
    await this.inner.pruneScores(heapId);
    await this.kv.delete(this.topKey(heapId));
  }

  // ---- uncached delegation ----

  getScore(heapId: string, playerId: string): Promise<ScoreRow | null> {
    return this.inner.getScore(heapId, playerId);
  }

  getRank(heapId: string, score: number): Promise<number> {
    return this.inner.getRank(heapId, score);
  }

  countScores(heapId: string): Promise<number> {
    return this.inner.countScores(heapId);
  }

  getScoresPaginated(heapId: string, offset: number, limit: number): Promise<ScoreRow[]> {
    return this.inner.getScoresPaginated(heapId, offset, limit);
  }

  getPlayerScores(playerId: string): Promise<Array<{ heapId: string; name: string; score: number; rank: number }>> {
    return this.inner.getPlayerScores(playerId);
  }
}
