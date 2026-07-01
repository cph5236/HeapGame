// server/src/configDb.ts

import type { AppConfig } from '../../shared/configTypes';

/** Abstraction over D1 for global config key/value storage. Allows MockConfigDB in tests. */
export interface ConfigDB {
  /** All config rows as a key -> parsed-JSON-value map. */
  getAll(): Promise<AppConfig>;

  /** Upsert a single key's value (JSON-encoded on write). */
  set(key: string, value: unknown, now: string): Promise<void>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1ConfigDB implements ConfigDB {
  constructor(private d1: D1Database) {}

  async getAll(): Promise<AppConfig> {
    const res = await this.d1
      .prepare('SELECT key, value FROM app_config')
      .all<{ key: string; value: string }>();

    const out: AppConfig = {};
    for (const row of res.results) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        // Malformed row (should not happen via our own writes) — skip it
        // rather than failing the whole config fetch.
      }
    }
    return out;
  }

  async set(key: string, value: unknown, now: string): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO app_config (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, JSON.stringify(value), now)
      .run();
  }
}
