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

import type { ScoreDB, ScoreRow, AdminScoreRow } from '../scoreDb';
import type { BanDB } from '../../platform/banDb';
import type { Sink } from '../../platform/logging/Sink';
import { captureServer } from '../../platform/logging/captureServerEvent';

/** Cache the top this-many rows per heap; matches MAX_LIMIT in routes/scores.ts. */
const CACHE_TOP_N = 50;
/** Leaderboards tolerate brief staleness; write-invalidation is the primary path.
 *  60 is the floor Workers KV allows for expirationTtl. */
const SCORES_TTL = 60;

// Ban/unban deliberately does NOT bust this cache. The blob carries a 60s
// expirationTtl (SCORES_TTL), so a newly banned player disappears from every
// public board within a minute on its own. Fanning a KV delete out across every
// heap on each ban would spend the tightest Cloudflare quota (deletes) to buy
// less than a minute.
export class CachedScoreDB implements ScoreDB {
  constructor(
    private inner: ScoreDB,
    private kv: KVNamespace,
    private waitUntil: (p: Promise<unknown>) => void,
    /** Required, not optional: the cached blob is the PUBLIC board, so without a
     *  ban source this decorator would serve it to a banned viewer and silently
     *  break the illusion their client depends on. */
    private banDb: BanDB,
    /** Optional telemetry sink — see CachedHeapDB for rationale. Optional so
     *  tests can construct this class directly. */
    private sink?: Sink,
  ) {}

  private topKey(heapId: string): string {
    return `cache:scores:${heapId}:top`;
  }

  async getTopScores(heapId: string, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    // Larger-than-cached requests bypass the cache entirely.
    if (limit > CACHE_TOP_N) return this.inner.getTopScores(heapId, limit, viewerId);

    // The cached blob is the PUBLIC board — every shadow-banned player is
    // already filtered out of it. Only a viewer who is themselves banned needs
    // a different result set, so only they pay for a D1 read. isBanned is
    // memoised per isolate (MemoBanDB), so this costs no round trip in the
    // common case.
    if (viewerId !== '' && await this.banDb.isBanned(viewerId)) {
      return this.inner.getTopScores(heapId, limit, viewerId);
    }

    const key = this.topKey(heapId);
    const hit = await this.safeGet<ScoreRow[]>(key);
    if (hit) return hit.slice(0, limit);

    const top = await this.inner.getTopScores(heapId, CACHE_TOP_N);
    this.waitUntil(this.kv.put(key, JSON.stringify(top), { expirationTtl: SCORES_TTL }));
    return top.slice(0, limit);
  }

  // ---- writes: D1 first, then synchronous invalidation of this heap's top key ----

  async upsertScore(heapId: string, playerId: string, score: number, now: string): Promise<boolean> {
    const changed = await this.inner.upsertScore(heapId, playerId, score, now);
    if (!changed) return false;

    // `changed` only means the player beat their OWN previous best, which says
    // nothing about whether the leaderboard moved. Bust the cache only when the
    // new score can actually appear in the cached window — trading a KV read
    // (100k/day bucket) for a KV delete (1k/day bucket).
    const key = this.topKey(heapId);
    const cached = await this.safeGet<ScoreRow[]>(key);
    if (!cached) return true;                         // nothing cached, nothing to bust
    const boardNotFull = cached.length < CACHE_TOP_N; // any score would enter
    if (boardNotFull || score >= cached[cached.length - 1].score) { // >= so ties invalidate
      await this.safeDelete(key);
    }
    return true;
  }

  async pruneScores(heapId: string): Promise<void> {
    // No invalidation: prune retains the top 1000 (see D1ScoreDB.pruneScores)
    // while this cache holds only CACHE_TOP_N (50), so pruning can only ever
    // remove rows that were never in the cached window. Revisit if either
    // constant changes.
    await this.inner.pruneScores(heapId);
  }

  // ---- uncached delegation ----

  getScore(heapId: string, playerId: string): Promise<ScoreRow | null> {
    return this.inner.getScore(heapId, playerId);
  }

  getRank(heapId: string, score: number, viewerId?: string): Promise<number> {
    return this.inner.getRank(heapId, score, viewerId);
  }

  countScores(heapId: string, viewerId?: string): Promise<number> {
    return this.inner.countScores(heapId, viewerId);
  }

  getScoresPaginated(heapId: string, offset: number, limit: number, viewerId?: string): Promise<ScoreRow[]> {
    return this.inner.getScoresPaginated(heapId, offset, limit, viewerId);
  }

  getPlayerScores(playerId: string): Promise<Array<{ heapId: string; name: string; score: number; rank: number }>> {
    return this.inner.getPlayerScores(playerId);
  }

  listScoresForAdmin(heapId: string, offset: number, limit: number): Promise<AdminScoreRow[]> {
    return this.inner.listScoresForAdmin(heapId, offset, limit);
  }

  countAllScores(heapId: string): Promise<number> {
    return this.inner.countAllScores(heapId);
  }

  // ---- helpers ----

  /** KV read that degrades to a cache miss on error, so callers fall through to D1. */
  private async safeGet<T>(key: string): Promise<T | null> {
    try {
      return await this.kv.get<T>(key, 'json');
    } catch (err) {
      console.warn(`[cache] KV get failed key=${key}: ${err instanceof Error ? err.message : String(err)}`);
      await this.reportKvFailure('get', key, err);
      return null;
    }
  }

  /** KV delete that never fails the request. The D1 write already committed;
   *  staleness is bounded by SCORES_TTL. */
  private async safeDelete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch (err) {
      console.warn(`[cache] KV delete failed key=${key}: ${err instanceof Error ? err.message : String(err)}`);
      await this.reportKvFailure('delete', key, err);
    }
  }

  /** Best-effort telemetry for a KV failure. Never throws — captureServer
   *  already swallows sink errors internally, and the sink itself is optional. */
  private async reportKvFailure(op: 'get' | 'delete', key: string, err: unknown): Promise<void> {
    if (!this.sink) return;
    await captureServer(this.sink, 'warn', 'cache:kv-failed', {
      op,
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
