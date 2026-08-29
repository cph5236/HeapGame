// server/tests/memoBanDb.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoBanDB, __resetBanMemo } from '../src/platform/cache/MemoBanDB';
import { MockBanDB } from './helpers/mockBanDb';
import type { BanDB } from '../src/platform/banDb';

/** Wraps a MockBanDB and counts isBanned round-trips. */
class CountingBanDB extends MockBanDB {
  calls = 0;
  async isBanned(playerId: string): Promise<boolean> {
    this.calls++;
    return super.isBanned(playerId);
  }
}

describe('MemoBanDB', () => {
  beforeEach(() => __resetBanMemo());

  it('passes the first lookup through to the inner db', async () => {
    const inner = new CountingBanDB();
    await inner.ban('cheater', null, '2026-08-16T00:00:00.000Z');
    const memo = new MemoBanDB(inner);
    expect(await memo.isBanned('cheater')).toBe(true);
    expect(inner.calls).toBe(1);
  });

  it('serves a repeat lookup from the memo within the TTL', async () => {
    const inner = new CountingBanDB();
    let clock = 1000;
    const memo = new MemoBanDB(inner, 60_000, () => clock);
    await memo.isBanned('someone');
    clock += 59_000;
    await memo.isBanned('someone');
    expect(inner.calls).toBe(1);
  });

  it('memoises a negative result too', async () => {
    const inner = new CountingBanDB();
    const memo = new MemoBanDB(inner);
    expect(await memo.isBanned('clean')).toBe(false);
    expect(await memo.isBanned('clean')).toBe(false);
    expect(inner.calls).toBe(1);
  });

  it('re-reads after the TTL expires', async () => {
    const inner = new CountingBanDB();
    let clock = 1000;
    const memo = new MemoBanDB(inner, 60_000, () => clock);
    await memo.isBanned('someone');
    clock += 60_001;
    await memo.isBanned('someone');
    expect(inner.calls).toBe(2);
  });

  it('ban writes through and drops the stale memo entry', async () => {
    const inner = new CountingBanDB();
    const memo = new MemoBanDB(inner);
    expect(await memo.isBanned('cheater')).toBe(false);   // caches "not banned"
    await memo.ban('cheater', 'aimbot', '2026-08-16T00:00:00.000Z');
    expect(await memo.isBanned('cheater')).toBe(true);    // must not serve the stale false
    expect(await inner.get('cheater')).not.toBeNull();
  });

  it('unban writes through and drops the stale memo entry', async () => {
    const inner = new CountingBanDB();
    await inner.ban('cheater', null, '2026-08-16T00:00:00.000Z');
    const memo = new MemoBanDB(inner);
    expect(await memo.isBanned('cheater')).toBe(true);
    await memo.unban('cheater');
    expect(await memo.isBanned('cheater')).toBe(false);
  });

  it('delegates get and list without memoising them', async () => {
    const inner = new CountingBanDB();
    await inner.ban('cheater', 'aimbot', '2026-08-16T00:00:00.000Z');
    const memo = new MemoBanDB(inner);
    expect((await memo.get('cheater'))?.reason).toBe('aimbot');
    expect((await memo.list()).length).toBe(1);
  });

  it('evicts everything once the memo exceeds its entry cap', async () => {
    const inner = new CountingBanDB();
    const memo = new MemoBanDB(inner);
    for (let i = 0; i < 5001; i++) await memo.isBanned('p' + i);
    const callsBefore = inner.calls;
    await memo.isBanned('p0');            // evicted — must hit the inner db again
    expect(inner.calls).toBe(callsBefore + 1);
  });

  it('shares the memo across instances in the same isolate', async () => {
    const inner = new CountingBanDB();
    await new MemoBanDB(inner).isBanned('someone');
    await new MemoBanDB(inner).isBanned('someone');
    expect(inner.calls).toBe(1);
  });
});
