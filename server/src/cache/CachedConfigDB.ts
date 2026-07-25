// server/src/cache/CachedConfigDB.ts
//
// Workers KV decorator over a ConfigDB. The whole config map is small (a
// handful of keys), so it's cached as a single KV entry rather than one key
// per config key — mirrors CachedScoreDB's single-key-per-heap approach,
// simplified further since there's no per-request variability (no limit
// param) to slice around.

import type { ConfigDB } from '../configDb';
import type { AppConfig } from '../../../shared/configTypes';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';

const CONFIG_KEY = 'cache:config:all';
/** Config tolerates brief staleness; write-invalidation is the primary path. */
const CONFIG_TTL = 300;

export class CachedConfigDB implements ConfigDB {
  constructor(
    private inner: ConfigDB,
    private kv: KVNamespace,
    private waitUntil: (p: Promise<unknown>) => void,
    /** Optional telemetry sink — see CachedHeapDB for rationale. Optional so
     *  tests can construct this class directly. */
    private sink?: Sink,
  ) {}

  async getAll(): Promise<AppConfig> {
    const hit = await this.safeGet<AppConfig>(CONFIG_KEY);
    if (hit) return hit;

    const all = await this.inner.getAll();
    this.waitUntil(this.kv.put(CONFIG_KEY, JSON.stringify(all), { expirationTtl: CONFIG_TTL }));
    return all;
  }

  async set(key: string, value: unknown, now: string): Promise<void> {
    await this.inner.set(key, value, now);
    await this.safeDelete(CONFIG_KEY);
  }

  async delete(key: string): Promise<void> {
    await this.inner.delete(key);
    await this.safeDelete(CONFIG_KEY);
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
   *  staleness is bounded by CONFIG_TTL. */
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
