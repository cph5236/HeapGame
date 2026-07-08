import { describe, it, expect } from 'vitest';
import { hashSecret, verifyOrClaim } from '../src/playerAuth';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';

const NOW = '2026-07-07T00:00:00.000Z';

describe('hashSecret', () => {
  it('produces the known SHA-256 hex of "hello"', async () => {
    expect(await hashSecret('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('is deterministic and distinct per input', async () => {
    expect(await hashSecret('a')).toBe(await hashSecret('a'));
    expect(await hashSecret('a')).not.toBe(await hashSecret('b'));
  });
});

describe('verifyOrClaim', () => {
  it('token + unclaimed → claimed, and stores the hash', async () => {
    const db = new MockPlayerAuthDB();
    expect(await verifyOrClaim(db, 'p1', 'secret-1', NOW)).toBe('claimed');
    expect(db.rows.get('p1')).toBe(await hashSecret('secret-1'));
  });

  it('token + matching claim → verified', async () => {
    const db = new MockPlayerAuthDB();
    await verifyOrClaim(db, 'p1', 'secret-1', NOW);
    expect(await verifyOrClaim(db, 'p1', 'secret-1', NOW)).toBe('verified');
  });

  it('token + mismatched claim → rejected-mismatch, hash unchanged', async () => {
    const db = new MockPlayerAuthDB();
    await verifyOrClaim(db, 'p1', 'secret-1', NOW);
    expect(await verifyOrClaim(db, 'p1', 'wrong', NOW)).toBe('rejected-mismatch');
    expect(db.rows.get('p1')).toBe(await hashSecret('secret-1'));
  });

  it('no token + unclaimed → legacy', async () => {
    const db = new MockPlayerAuthDB();
    expect(await verifyOrClaim(db, 'p1', undefined, NOW)).toBe('legacy');
    expect(db.rows.has('p1')).toBe(false);
  });

  it('no token + claimed → rejected-tokenless-claimed', async () => {
    const db = new MockPlayerAuthDB();
    await verifyOrClaim(db, 'p1', 'secret-1', NOW);
    expect(await verifyOrClaim(db, 'p1', undefined, NOW)).toBe('rejected-tokenless-claimed');
  });

  it('empty-string token is treated as no token', async () => {
    const db = new MockPlayerAuthDB();
    expect(await verifyOrClaim(db, 'p1', '', NOW)).toBe('legacy');
  });

  it('concurrent first-write that loses the claim race is rejected, not falsely claimed', async () => {
    // Simulate a competitor claiming between our read (which sees null) and our
    // INSERT OR IGNORE: the row exists by insert time, so our token is discarded.
    class RacingAuthDB extends MockPlayerAuthDB {
      private raced = false;
      async getSecretHash(id: string): Promise<string | null> {
        const v = await super.getSecretHash(id);
        if (v === null && !this.raced) {
          this.raced = true;
          this.rows.set(id, 'competitor-hash');
        }
        return v;
      }
    }
    const db = new RacingAuthDB();
    expect(await verifyOrClaim(db, 'p1', 'my-secret', NOW)).toBe('rejected-mismatch');
    expect(db.rows.get('p1')).toBe('competitor-hash'); // the winner's claim stands
  });
});
