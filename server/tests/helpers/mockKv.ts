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

  /** Ops that should throw on their next call, then clear. */
  private failOnce = new Set<'get' | 'put' | 'delete'>();
  /** Ops that should throw on every call until reset. */
  private failEvery = new Set<'get' | 'put' | 'delete'>();

  /** Test helper — make the next call to `op` throw, simulating a KV error. */
  failNext(op: 'get' | 'put' | 'delete'): void {
    this.failOnce.add(op);
  }

  /** Test helper — make every call to `op` throw, simulating quota exhaustion. */
  failAll(op: 'get' | 'put' | 'delete'): void {
    this.failEvery.add(op);
  }

  private maybeThrow(op: 'get' | 'put' | 'delete'): void {
    if (this.failEvery.has(op)) throw new Error(`KV ${op} failed (simulated quota exhaustion)`);
    if (this.failOnce.delete(op)) throw new Error(`KV ${op} failed (simulated)`);
  }

  async get<T = unknown>(key: string, type?: 'json' | 'text'): Promise<T | string | null> {
    this.maybeThrow('get');
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    return type === 'json' ? (JSON.parse(raw) as T) : raw;
  }

  async put(key: string, value: string, _opts?: { expirationTtl?: number }): Promise<void> {
    this.maybeThrow('put');
    this.store.set(key, value);
    this.puts.push(key);
  }

  async delete(key: string): Promise<void> {
    this.maybeThrow('delete');
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
