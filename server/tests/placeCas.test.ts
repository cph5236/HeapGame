// server/tests/placeCas.test.ts
//
// Regression tests for the placement lost-update race (issue #82). The /place
// handler does a read-modify-write on heap.live_zone/version; under concurrency
// two placements could read the same row and the second clobber the first. The
// fix is a compare-and-swap on version with a re-read/retry loop. These tests
// drive that loop by injecting a competing write between the route's read and
// its CAS.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import type { Vertex } from '../../shared/heapTypes';
import type { PlaceResponse } from '../../shared/heapTypes';

/**
 * MockHeapDB that simulates a concurrent placement landing between the route's
 * fresh read and its CAS write. On the chosen updateHeap call(s) it first bumps
 * the row out-of-band (a rival placement), so the route's CAS — keyed on the
 * version it read — misses and must retry.
 */
class RacingHeapDB extends MockHeapDB {
  private injections: number;
  constructor(injections: number) {
    super();
    this.injections = injections;
  }

  override async updateHeap(
    id: string,
    baseId: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
    expectedVersion?: number,
  ): Promise<boolean> {
    if (this.injections > 0) {
      this.injections--;
      const cur = (await this.getHeap(id))!;
      const rivalZone: Vertex[] = [...(JSON.parse(cur.live_zone) as Vertex[]), { x: 700, y: 250 }];
      // Unconditional rival write — bumps version so the caller's CAS is stale.
      await super.updateHeap(id, cur.base_id, cur.version + 1, rivalZone, cur.freeze_y);
    }
    return super.updateHeap(id, baseId, version, liveZone, freezeY, expectedVersion);
  }
}

function placeReq(db: MockHeapDB, body: unknown) {
  return createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /heaps/:id/place — compare-and-swap', () => {
  it('retries on a lost-update conflict without clobbering the rival placement', async () => {
    const db = new RacingHeapDB(1); // one rival write, then our CAS succeeds
    db.seedHeap('h1', 1, [], 'base-1');
    db.seedBase('base-1', 'h1', []);

    const res = await placeReq(db, { x: 400, y: 100 });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    // v1 → rival → v2 → ours → v3
    expect(body.version).toBe(3);

    // Both placements survive — no lost update.
    const row = (await db.getHeap('h1'))!;
    const zone = JSON.parse(row.live_zone) as Vertex[];
    expect(zone).toContainEqual({ x: 700, y: 250 }); // rival
    expect(zone).toContainEqual({ x: 400, y: 100 }); // ours
    expect(row.version).toBe(3);
  });

  it('returns 409 when the version keeps changing past the retry budget', async () => {
    const db = new RacingHeapDB(99); // rival write on every attempt → CAS never lands
    db.seedHeap('h1', 1, [], 'base-1');
    db.seedBase('base-1', 'h1', []);

    const res = await placeReq(db, { x: 400, y: 100 });
    expect(res.status).toBe(409);
  });
});
