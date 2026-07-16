import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { markRunEnded, hasPlayedToday, deviceUtcOffsetMin } from '../dailyRunGate';

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

const NY = -240;
// 10pm July 15 in New York:
const T0 = Date.parse('2026-07-16T02:00:00Z');

beforeEach(() => { localStorage.clear(); });

describe('dailyRunGate', () => {
  it('reports not-played when no run has ended', () => {
    expect(hasPlayedToday(NY, T0)).toBe(false);
  });

  it('reports played after a run ends the same local day', () => {
    markRunEnded(T0);                                        // 10pm local
    expect(hasPlayedToday(NY, T0 + 30 * 60_000)).toBe(true); // 10:30pm local, same day
  });

  it('resets across the local midnight', () => {
    markRunEnded(T0);                                           // 10pm July 15 local
    expect(hasPlayedToday(NY, T0 + 3 * 3_600_000)).toBe(false); // 1am July 16 local
  });

  it('survives garbage in storage', () => {
    localStorage.setItem('heap_last_run_ended_at', 'garbage');
    expect(hasPlayedToday(NY, T0)).toBe(false);
  });

  it('deviceUtcOffsetMin inverts getTimezoneOffset sign', () => {
    const fake = { getTimezoneOffset: () => 240 } as Date;   // NY reports +240
    expect(deviceUtcOffsetMin(fake)).toBe(-240);             // we want east-positive
  });
});
