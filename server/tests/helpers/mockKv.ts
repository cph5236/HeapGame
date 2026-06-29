// server/tests/helpers/mockKv.ts
//
// Minimal in-memory stand-in for a Cloudflare KVNamespace, sufficient for the
// cache-decorator unit tests. Records put/delete keys so tests can assert on
// invalidation. TTLs are accepted but not enforced (the decorators rely on
// write-through invalidation, which is what these tests exercise).

export class MockKV {
  readonly store = new Map<string, string>();
  readonly puts: string[] = [];
  readonly deletes: string[] = [];

  async get<T = unknown>(key: string, type?: 'json' | 'text'): Promise<T | string | null> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    return type === 'json' ? (JSON.parse(raw) as T) : raw;
  }

  async put(key: string, value: string, _opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
    this.puts.push(key);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.deletes.push(key);
  }

  /** Test helper — does the cache currently hold this key? */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** Cast to the KVNamespace shape the decorators expect. */
  asKV(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}
