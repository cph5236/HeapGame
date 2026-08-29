import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  getRawSaveForCloudSync, resetCacheForTests, mergeCloudSave,
  getPlayerSecret, getSoundSettings, getControlMode, getJoystickSide,
  getGpgsPlayerId, getStoredRemoteConfig, type RawSave,
} from '../SaveData';

const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear:      () => { for (const k of Object.keys(store)) delete store[k]; },
    },
    configurable: true,
  });
});

/** Every core field populated, so anything a migration drops is visible. */
const CORE = {
  playerGuid:  'guid-1',
  playerName:  'Alice',
  playerSecret: 'SECRET',
  gpgsPlayerId: 'GPGS-1',
  verboseLogging: true,
  soundSettings: { master: 0.3, music: 0.3, playerSfx: 0.3, enemySfx: 0.3, envSfx: 0.3 },
  controlMode:  'joystick' as const,
  joystickSide: 'right' as const,
  remoteConfig: { minVersion: '9.9.9' } as any,
};

const AT_VERSION: Record<string, any> = {
  v1: { ...CORE, balance: 7, upgrades: { u: 1 }, placed: [{ id: 'x', x: 1, y: 2 }] },
  v2: { schemaVersion: 2, ...CORE, balance: 5, placed: { h: [{ id: 'x', x: 0, y: 49_000 }] } },
  v3: { schemaVersion: 3, ...CORE, balance: 5, placed: { h: [{ id: 'x', x: 0, y: 40_000 }] } },
  v4: { schemaVersion: 4, ...CORE, balance: 10, placed: { h: [{ id: 'x', x: 0, y: 5 }] } },
  v5: { schemaVersion: 5, ...CORE, balance: 10, placed: {} },
};

function seed(blob: any): void {
  localStorage.clear();
  localStorage.setItem('heap_save', JSON.stringify(blob));
  resetCacheForTests();
}

describe('save/core — core fields survive every schema migration', () => {
  beforeEach(() => { localStorage.clear(); resetCacheForTests(); });

  // Before the core/game split, migrate() rebuilt the whole record per version
  // and only the current-schema branch listed the core fields. Every older path
  // silently dropped some of them — playerSecret on ALL of v1..v4, which
  // regenerates on the next getPlayerSecret() and 403-locks the player out of
  // their own server data for good. Core now migrates its own fields
  // version-independently, so this cannot regress by adding a schema version.
  for (const [version, blob] of Object.entries(AT_VERSION)) {
    it(`${version}: keeps the write-auth secret`, () => {
      seed(blob);
      expect(getRawSaveForCloudSync().playerSecret).toBe('SECRET');
      expect(getPlayerSecret()).toBe('SECRET');   // must not mint a new one
    });

    it(`${version}: keeps identity and device-local preferences`, () => {
      seed(blob);
      expect(getGpgsPlayerId()).toBe('GPGS-1');
      expect(getSoundSettings().master).toBe(0.3);
      expect(getControlMode()).toBe('joystick');
      expect(getJoystickSide()).toBe('right');
      expect(getStoredRemoteConfig()).toEqual({ minVersion: '9.9.9' });
    });

    it(`${version}: lands on the current schema`, () => {
      seed(blob);
      expect(getRawSaveForCloudSync().schemaVersion).toBe(5);
    });
  }

  it('a save with no secret does not invent one during migration', () => {
    seed({ ...AT_VERSION.v2, playerSecret: undefined });
    expect(getRawSaveForCloudSync().playerSecret).toBeUndefined();
  });
});

describe('save/core — mergeCloudSave keeps the write-auth secret', () => {
  const base = (over: Partial<RawSave> = {}): RawSave => ({
    schemaVersion: 5, balance: 0, upgrades: {}, inventory: {}, placed: {},
    selectedHeapId: '', highScores: {}, beatenHeapIds: [],
    cosmeticsOwned: [], cosmeticsEquipped: {},
    playerGuid: 'g', playerName: 'N', ...over,
  } as RawSave);

  it('prefers the local secret — it matches the hash the server already stored', () => {
    expect(mergeCloudSave(base({ playerSecret: 'local' }), base({ playerSecret: 'cloud' })).playerSecret)
      .toBe('local');
  });

  it('falls back to the cloud secret so a fresh install recovers the identity', () => {
    expect(mergeCloudSave(base(), base({ playerSecret: 'cloud' })).playerSecret).toBe('cloud');
  });

  it('leaves it unset when neither side has one', () => {
    expect(mergeCloudSave(base(), base()).playerSecret).toBeUndefined();
  });

  it('keeps the local GUID and device-local control prefs regardless of balance', () => {
    const merged = mergeCloudSave(
      base({ playerGuid: 'local-guid', balance: 1, controlMode: 'tilt', joystickSide: 'left' }),
      base({ playerGuid: 'cloud-guid', balance: 999, controlMode: 'joystick', joystickSide: 'right' }),
    );
    expect(merged.playerGuid).toBe('local-guid');
    expect(merged.controlMode).toBe('tilt');
    expect(merged.joystickSide).toBe('left');
  });

  it('takes the name from whichever save has the higher balance', () => {
    expect(mergeCloudSave(base({ balance: 1, playerName: 'Local' }), base({ balance: 9, playerName: 'Cloud' })).playerName).toBe('Cloud');
    expect(mergeCloudSave(base({ balance: 9, playerName: 'Local' }), base({ balance: 1, playerName: 'Cloud' })).playerName).toBe('Local');
  });
});
