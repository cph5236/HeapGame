// server/tests/helpers/mockConfigDb.ts

import type { ConfigDB } from '../../src/configDb';
import type { AppConfig } from '../../../shared/configTypes';

/** In-memory ConfigDB for tests. Same get/set semantics as D1ConfigDB. */
export class MockConfigDB implements ConfigDB {
  private rows = new Map<string, unknown>();

  async getAll(): Promise<AppConfig> {
    return Object.fromEntries(this.rows);
  }

  async set(key: string, value: unknown, _now: string): Promise<void> {
    this.rows.set(key, value);
  }

  /** Test helper — seed a row directly without going through set(). */
  seed(key: string, value: unknown): void {
    this.rows.set(key, value);
  }
}
