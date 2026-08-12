import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  readCachedDailyStatus, writeCachedDailyStatus, clearCachedDailyStatus,
} from '../dailyStatusCache';
import type { DailyStatusResponse } from '../../../shared/dailyTypes';

// Stub localStorage — vitest runs in node environment
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
    configurable: true,
  });
});

const H = 3_600_000;
const NY = -240;
// 2026-07-16T02:00:00Z — 10pm July 15 in New York
const T0 = Date.parse('2026-07-16T02:00:00Z');
// Next local midnight in NY, i.e. 2 hours after T0
const NEXT_MIDNIGHT = T0 + 2 * H;

function snap(over: Partial<DailyStatusResponse> = {}): DailyStatusResponse {
  return {
    streakDay: 3,
    claimedToday: true,
    nextClaimDay: 4,
    todayGrants: [{ type: 'coins', amount: 100 }],
    nextEligibleAt: T0 + 10 * H,
    stableUntil: NEXT_MIDNIGHT,
    ...over,
  };
}

beforeEach(() => { localStorage.clear(); });

describe('dailyStatusCache', () => {
  it('returns null when nothing is cached', () => {
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });

  it('serves a snapshot before its stableUntil', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 1 * H)).toEqual(snap());
  });

  it('stops serving once stableUntil has passed', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p1', NY, NEXT_MIDNIGHT)).toBeNull();
  });

  it('serves a null stableUntil — nothing can change that response', () => {
    // Never claimed, or grace long expired: frozen until they claim.
    const frozen = snap({ claimedToday: false, streakDay: 0, nextClaimDay: 1, stableUntil: null });
    writeCachedDailyStatus('p1', NY, frozen, T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 12 * H)).toEqual(frozen);
  });

  it('caps even a null stableUntil at 24h', () => {
    const frozen = snap({ stableUntil: null });
    writeCachedDailyStatus('p1', NY, frozen, T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 23 * H)).toEqual(frozen);
    expect(readCachedDailyStatus('p1', NY, T0 + 25 * H)).toBeNull();
  });

  it('never serves a snapshot from a server that omits stableUntil', () => {
    const old = snap({ stableUntil: undefined });
    writeCachedDailyStatus('p1', NY, old, T0);
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });

  it('caches unclaimed snapshots too — locked/ready is decided locally', () => {
    const unclaimed = snap({ claimedToday: false, stableUntil: T0 + 36 * H });
    writeCachedDailyStatus('p1', NY, unclaimed, T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 1 * H)).toEqual(unclaimed);
  });

  it('ignores a snapshot belonging to a different player', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p2', NY, T0)).toBeNull();
  });

  it('ignores a snapshot taken at a different UTC offset', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p1', 60, T0)).toBeNull();
  });

  it('re-fetches when the clock has been rewound behind the entry', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p1', NY, T0 - 1 * H)).toBeNull();
  });

  it('clearCachedDailyStatus drops the entry', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    clearCachedDailyStatus();
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });

  it('survives a corrupt entry', () => {
    localStorage.setItem('heap_daily_status_cache', '{not json');
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });
});
