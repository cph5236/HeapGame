import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  resetCacheForTests, resetAllData, addBalance, getBalance,
  isCosmeticOwned, purchaseCosmetic, getOwnedCosmetics,
  getEquippedCosmetics, equipCosmetic,
  getLoadoutSyncPending, setLoadoutSyncPending,
  getHatAdjustment, getHatAdjustments, setHatAdjustment,
  mergeCloudSave, getRawSaveForCloudSync, getSchemaVersionForTests,
} from '../SaveData';

// Stub localStorage — vitest runs in node environment
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

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  resetAllData();
  resetCacheForTests();
});

describe('cosmetics ownership', () => {
  it('free items are implicitly owned', () => {
    expect(isCosmeticOwned('tie_red')).toBe(true);
    expect(isCosmeticOwned('skin_default')).toBe(true);
  });

  it('paid items are not owned until purchased', () => {
    expect(isCosmeticOwned('tie_gold')).toBe(false);
  });

  it('purchase deducts price and adds to owned', () => {
    addBalance(1000);
    expect(purchaseCosmetic('tie_gold')).toBe(true);   // costs 500
    expect(getBalance()).toBe(500);
    expect(isCosmeticOwned('tie_gold')).toBe(true);
    expect(getOwnedCosmetics()).toContain('tie_gold');
  });

  it('purchase fails on insufficient funds and unknown ids', () => {
    addBalance(100);
    expect(purchaseCosmetic('tie_gold')).toBe(false);
    expect(getBalance()).toBe(100);
    expect(purchaseCosmetic('nonsense')).toBe(false);
  });

  it('re-purchasing an owned item fails without charging', () => {
    addBalance(1000);
    purchaseCosmetic('tie_gold');
    expect(purchaseCosmetic('tie_gold')).toBe(false);
    expect(getBalance()).toBe(500);
  });
});

describe('equipped loadout', () => {
  it('starts empty', () => {
    expect(getEquippedCosmetics()).toEqual({});
  });

  it('equips owned items and clears with null', () => {
    expect(equipCosmetic('tie', 'tie_blue')).toBe(true);   // free
    expect(getEquippedCosmetics()).toEqual({ tie: 'tie_blue' });
    expect(equipCosmetic('tie', null)).toBe(true);
    expect(getEquippedCosmetics()).toEqual({});
  });

  it('rejects unowned items and slot mismatches', () => {
    expect(equipCosmetic('tie', 'tie_gold')).toBe(false);   // not owned
    expect(equipCosmetic('hat', 'tie_red')).toBe(false);    // wrong slot
    expect(getEquippedCosmetics()).toEqual({});
  });

  it('persists the loadout sync pending flag', () => {
    expect(getLoadoutSyncPending()).toBe(false);
    setLoadoutSyncPending(true);
    expect(getLoadoutSyncPending()).toBe(true);
  });
});

describe('v4 → v5 migration', () => {
  it('adds cosmetic fields without remapping placed Y values', () => {
    localStorage.setItem('heap_save', JSON.stringify({
      schemaVersion: 4, balance: 42, upgrades: {}, inventory: {},
      placed: { h1: [{ id: 'a', x: 10, y: 999 }] },
      selectedHeapId: 'h1', playerGuid: 'g', playerName: 'N', highScores: {},
    }));
    resetCacheForTests();
    expect(getSchemaVersionForTests()).toBe(5);
    const raw = getRawSaveForCloudSync();
    expect(raw.placed['h1'][0].y).toBe(999);        // NOT remapped
    expect(raw.cosmeticsOwned).toEqual([]);
    expect(raw.cosmeticsEquipped).toEqual({});
  });
});

describe('cloud merge', () => {
  it('unions owned cosmetics and takes primary equipped', () => {
    const local = { ...getRawSaveForCloudSync(), balance: 100,
      cosmeticsOwned: ['tie_gold'], cosmeticsEquipped: { tie: 'tie_gold' } };
    const cloud = { ...getRawSaveForCloudSync(), balance: 50,
      cosmeticsOwned: ['hat_cone'], cosmeticsEquipped: { hat: 'hat_cone' } };
    const merged = mergeCloudSave(local as any, cloud as any);
    expect(merged.cosmeticsOwned.sort()).toEqual(['hat_cone', 'tie_gold']);
    expect(merged.cosmeticsEquipped).toEqual({ tie: 'tie_gold' }); // local is primary (higher balance)
  });
});

describe('hat adjustments', () => {
  it('defaults to identity when unset', () => {
    expect(getHatAdjustment('hat_fedora')).toEqual({ dAngle: 0, dScale: 1 });
  });

  it('stores, clamps, and clears per hat id', () => {
    setHatAdjustment('hat_fedora', { dAngle: -40, dScale: 1.1 });
    expect(getHatAdjustment('hat_fedora')).toEqual({ dAngle: -15, dScale: 1.1 });

    setHatAdjustment('hat_crown', { dAngle: 5, dScale: 0.5 });
    expect(getHatAdjustment('hat_crown').dScale).toBe(0.8);
    expect(Object.keys(getHatAdjustments())).toHaveLength(2);

    setHatAdjustment('hat_fedora', null);
    expect(getHatAdjustment('hat_fedora')).toEqual({ dAngle: 0, dScale: 1 });
  });

  it('identity values delete the entry instead of storing it', () => {
    setHatAdjustment('hat_fedora', { dAngle: 0, dScale: 1 });
    expect(getHatAdjustments()).toEqual({});
  });

  it('cloud merge prefers the primary save per hat, keeps secondary-only tweaks', () => {
    setHatAdjustment('hat_fedora', { dAngle: 5, dScale: 1 });
    addBalance(100); // local is primary
    const local = getRawSaveForCloudSync();
    const cloud = {
      ...local, balance: 0,
      hatAdjustments: { hat_fedora: { dAngle: -5, dScale: 1 }, hat_crown: { dAngle: 2.5, dScale: 1 } },
    };
    const merged = mergeCloudSave(local, cloud);
    expect(merged.hatAdjustments?.hat_fedora).toEqual({ dAngle: 5, dScale: 1 });
    expect(merged.hatAdjustments?.hat_crown).toEqual({ dAngle: 2.5, dScale: 1 });
  });
});
