// src/systems/__tests__/verboseLoggingDefault.test.ts
//
// Analytics is opt-OUT: on unless the player turned it off. The stored value
// must win in BOTH directions — a player who opted out before the default
// flipped must stay opted out.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getVerboseLogging, setVerboseLogging, resetCacheForTests } from '../SaveData';

const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
    },
    configurable: true,
  });
});

describe('verboseLogging default', () => {
  beforeEach(() => {
    localStorage.clear();
    resetCacheForTests();
  });

  it('defaults to true on a fresh save', () => {
    expect(getVerboseLogging()).toBe(true);
  });

  it('respects a stored false — an existing opt-out survives the default flip', () => {
    setVerboseLogging(false);
    resetCacheForTests();
    expect(getVerboseLogging()).toBe(false);
  });

  it('respects a stored true', () => {
    setVerboseLogging(true);
    resetCacheForTests();
    expect(getVerboseLogging()).toBe(true);
  });
});
