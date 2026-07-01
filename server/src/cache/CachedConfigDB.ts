// server/src/cache/CachedConfigDB.ts
//
// Workers KV decorator over a ConfigDB. The whole config map is small (a
// handful of keys), so it's cached as a single KV entry rather than one key
// per config key — mirrors CachedScoreDB's single-key-per-heap approach,
// simplified further since there's no per-request variability (no limit
// param) to slice around.

import type { ConfigDB } from '../configDb';
import type { AppConfig } from '../../../shared/configTypes';

const CONFIG_KEY = 'cache:config:all';
/** Config tolerates brief staleness; write-invalidation is the primary path. */
const CONFIG_TTL = 300;

export class CachedConfigDB implements ConfigDB {
  constructor(
    private inner: ConfigDB,
    private kv: KVNamespace,
    private waitUntil: (p: Promise<unknown>) => void,
  ) {}

  async getAll(): Promise<AppConfig> {
    const hit = await this.kv.get<AppConfig>(CONFIG_KEY, 'json');
    if (hit) return hit;

    const all = await this.inner.getAll();
    this.waitUntil(this.kv.put(CONFIG_KEY, JSON.stringify(all), { expirationTtl: CONFIG_TTL }));
    return all;
  }

  async set(key: string, value: unknown, now: string): Promise<void> {
    await this.inner.set(key, value, now);
    await this.kv.delete(CONFIG_KEY);
  }
}
