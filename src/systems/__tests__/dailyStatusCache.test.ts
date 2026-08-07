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

function claimed(over: Partial<DailyStatusResponse> = {}): DailyStatusResponse {
  return {
    streakDay: 3,
    claimedToday: true,
    nextClaimDay: 4,
    todayGrants: [{ type: 'coins', amount: 100 }],
    nextEligibleAt: NEXT_MIDNIGHT,
    ...over,
  };
}

beforeEach(() => { localStorage.clear(); });

describe('dailyStatusCache', () => {
  it('returns null when nothing is cached', () => {
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });

  it('serves a claimed-today snapshot before nextEligibleAt', () => {
    writeCachedDailyStatus('p1', NY, claimed(), T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 1 * H)).toEqual(claimed());
  });

  it('re-fetches once nextEligibleAt has passed', () => {
    writeCachedDailyStatus('p1', NY, claimed(), T0);
    expect(readCachedDailyStatus('p1', NY, NEXT_MIDNIGHT)).toBeNull();
  });

  it('re-fetches after the local day rolls over, even if the min gap still blocks the claim', () => {
    // Claimed at 10pm with a 10h min gap: nextEligibleAt lands at 8am the
    // NEXT local day, so `claimedToday` is stale before the window closes.
    writeCachedDailyStatus('p1', NY, claimed({ nextEligibleAt: T0 + 10 * H }), T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 5 * H)).toBeNull();
  });

  it('never serves a claimable snapshot', () => {
    writeCachedDailyStatus('p1', NY, claimed({ claimedToday: false }), T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 1 * H)).toBeNull();
  });

  it('never serves a snapshot without nextEligibleAt (never-claimed / old server)', () => {
    writeCachedDailyStatus('p1', NY, claimed({ nextEligibleAt: undefined }), T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 1 * H)).toBeNull();
  });

  it('does not serve one player\'s snapshot to another (GPGS sign-in)', () => {
    writeCachedDailyStatus('guid-anon', NY, claimed(), T0);
    expect(readCachedDailyStatus('gpgs-123', NY, T0 + 1 * H)).toBeNull();
  });

  it('re-fetches when the device timezone changed', () => {
    writeCachedDailyStatus('p1', NY, claimed(), T0);
    expect(readCachedDailyStatus('p1', 60, T0 + 1 * H)).toBeNull();
  });

  it('clears', () => {
    writeCachedDailyStatus('p1', NY, claimed(), T0);
    clearCachedDailyStatus();
    expect(readCachedDailyStatus('p1', NY, T0 + 1 * H)).toBeNull();
  });

  it('survives a corrupt entry', () => {
    localStorage.setItem('heap_daily_status_cache', '{not json');
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });
});
