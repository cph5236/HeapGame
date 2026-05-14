import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../../constants';
import {
  getPlayerConfig,
  resetAllData,
  getItemQuantity,
  addItem,
  spendItem,
  getPlaced,
  addPlaced,
  removePlaced,
  updatePlacedMeta,
  removeExpiredPlaced,
  purchaseItem,
  getBalance,
  addBalance,
  getPlayerGuid,
  getPlayerName,
  setPlayerName,
  getLocalHighScore,
  setLocalHighScore,
  getSelectedHeapId,
  setSelectedHeapId,
  finalizeLegacyPlaced,
  resetCacheForTests,
  getLegacyPlacedForTests,
  getSchemaVersionForTests,
  getVerboseLogging,
  setVerboseLogging,
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
});

// ── Existing tests ────────────────────────────────────────────────────────────

describe('getPlayerConfig – maxWalkableSlopeDeg', () => {
  it('returns MAX_WALKABLE_SLOPE_DEG when mountain_climber is level 0', () => {
    const config = getPlayerConfig();
    expect(config.maxWalkableSlopeDeg).toBe(MAX_WALKABLE_SLOPE_DEG);
  });

  it('adds MOUNTAIN_CLIMBER_INCREMENT * level to maxWalkableSlopeDeg', () => {
    store['heap_save'] = JSON.stringify({ balance: 0, upgrades: { mountain_climber: 2 } });
    const config = getPlayerConfig();
    expect(config.maxWalkableSlopeDeg).toBe(MAX_WALKABLE_SLOPE_DEG + 2 * MOUNTAIN_CLIMBER_INCREMENT);
  });
});

// ── Inventory ─────────────────────────────────────────────────────────────────

describe('getItemQuantity', () => {
  it('returns 0 for unknown item', () => {
    expect(getItemQuantity('ladder')).toBe(0);
  });

  it('returns correct quantity after addItem', () => {
    addItem('ladder', 3);
    expect(getItemQuantity('ladder')).toBe(3);
  });

  it('addItem defaults qty to 1', () => {
    addItem('shield');
    expect(getItemQuantity('shield')).toBe(1);
  });
});

describe('spendItem', () => {
  it('returns false when quantity is 0', () => {
    expect(spendItem('ladder')).toBe(false);
  });

  it('decrements quantity and returns true', () => {
    addItem('ladder', 2);
    expect(spendItem('ladder')).toBe(true);
    expect(getItemQuantity('ladder')).toBe(1);
  });

  it('does not go below 0', () => {
    addItem('shield', 1);
    spendItem('shield');
    expect(spendItem('shield')).toBe(false);
    expect(getItemQuantity('shield')).toBe(0);
  });
});

describe('purchaseItem', () => {
  it('returns false when balance is insufficient', () => {
    expect(purchaseItem('ladder')).toBe(false); // costs 300, balance is 0
  });

  it('deducts balance and adds 1 to inventory on success', () => {
    addBalance(500);
    expect(purchaseItem('ladder')).toBe(true); // costs 300
    expect(getBalance()).toBe(200);
    expect(getItemQuantity('ladder')).toBe(1);
  });

  it('returns false for unknown item id', () => {
    addBalance(9999);
    expect(purchaseItem('nonexistent')).toBe(false);
  });

  it('stacks correctly when purchased multiple times', () => {
    addBalance(1500);
    purchaseItem('ibeam'); // costs 750
    purchaseItem('ibeam'); // costs 750
    expect(getItemQuantity('ibeam')).toBe(2);
    expect(getBalance()).toBe(0);
  });
});

// ── Placed items ──────────────────────────────────────────────────────────────

describe('getPlaced / addPlaced / removePlaced', () => {
  const heapId = 'test-heap';

  it('returns empty array by default', () => {
    expect(getPlaced(heapId)).toEqual([]);
  });

  it('addPlaced appends an item', () => {
    addPlaced(heapId, { id: 'ladder', x: 100, y: 200 });
    expect(getPlaced(heapId)).toHaveLength(1);
    expect(getPlaced(heapId)[0]).toMatchObject({ id: 'ladder', x: 100, y: 200 });
  });

  it('removePlaced removes by index', () => {
    addPlaced(heapId, { id: 'ladder', x: 100, y: 200 });
    addPlaced(heapId, { id: 'ibeam', x: 300, y: 400 });
    removePlaced(heapId, 0);
    const placed = getPlaced(heapId);
    expect(placed).toHaveLength(1);
    expect(placed[0].id).toBe('ibeam');
  });

  it('getPlaced returns a copy (mutating it does not affect save)', () => {
    addPlaced(heapId, { id: 'ladder', x: 100, y: 200 });
    const copy = getPlaced(heapId);
    copy.push({ id: 'ibeam', x: 0, y: 0 });
    expect(getPlaced(heapId)).toHaveLength(1);
  });
});

describe('updatePlacedMeta', () => {
  const heapId = 'test-heap';

  it('updates meta on a placed item', () => {
    addPlaced(heapId, { id: 'checkpoint', x: 50, y: 50, meta: { spawnsLeft: 5 } });
    updatePlacedMeta(heapId, 0, { spawnsLeft: 3 });
    expect(getPlaced(heapId)[0].meta?.spawnsLeft).toBe(3);
  });

  it('does nothing for out-of-bounds index', () => {
    addPlaced(heapId, { id: 'checkpoint', x: 50, y: 50 });
    updatePlacedMeta(heapId, 99, { spawnsLeft: 0 });
    expect(getPlaced(heapId)).toHaveLength(1);
  });
});

describe('removeExpiredPlaced', () => {
  const heapId = 'test-heap';

  it('removes placed items where spawnsLeft === 0', () => {
    addPlaced(heapId, { id: 'checkpoint', x: 0, y: 0, meta: { spawnsLeft: 0 } });
    addPlaced(heapId, { id: 'ladder', x: 0, y: 0 }); // no meta — not expired
    removeExpiredPlaced(heapId);
    const placed = getPlaced(heapId);
    expect(placed).toHaveLength(1);
    expect(placed[0].id).toBe('ladder');
  });

  it('keeps items with spawnsLeft > 0', () => {
    addPlaced(heapId, { id: 'checkpoint', x: 0, y: 0, meta: { spawnsLeft: 2 } });
    removeExpiredPlaced(heapId);
    expect(getPlaced(heapId)).toHaveLength(1);
  });
});

describe('save migration — missing inventory/placed fields', () => {
  it('defaults inventory to {} when field is absent', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(getItemQuantity('ladder')).toBe(0);
  });

  it('defaults placed to {} when field is absent', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(getPlaced('test-heap')).toEqual([]);
  });
});

// ── Player identity ───────────────────────────────────────────────────────────

describe('getPlayerGuid', () => {
  it('generates a UUID on first call', () => {
    const guid = getPlayerGuid();
    expect(typeof guid).toBe('string');
    expect(guid.length).toBeGreaterThan(0);
  });

  it('returns the same GUID on subsequent calls', () => {
    const first  = getPlayerGuid();
    const second = getPlayerGuid();
    expect(first).toBe(second);
  });

  it('generates a new GUID after resetAllData', () => {
    const before = getPlayerGuid();
    resetAllData();
    const after = getPlayerGuid();
    // Both are valid GUIDs; they may or may not differ (RNG), but both must be non-empty
    expect(typeof after).toBe('string');
    expect(after.length).toBeGreaterThan(0);
    // Statistically certain to differ; document the intent
    expect(before).not.toBe(after);
  });
});

describe('getPlayerName / setPlayerName', () => {
  it('defaults to Trashbag#XXXXX format', () => {
    const name = getPlayerName();
    expect(name).toMatch(/^Trashbag#\d{5}$/);
  });

  it('setPlayerName persists across calls', () => {
    setPlayerName('GarbageLord');
    expect(getPlayerName()).toBe('GarbageLord');
  });

  it('setPlayerName trims whitespace', () => {
    setPlayerName('  SpaceyTrash  ');
    expect(getPlayerName()).toBe('SpaceyTrash');
  });

  it('setPlayerName enforces max 20 chars (truncates)', () => {
    setPlayerName('A'.repeat(25));
    expect(getPlayerName().length).toBeLessThanOrEqual(20);
  });

  it('setPlayerName with empty string after trim keeps existing name', () => {
    setPlayerName('KeepMe');
    setPlayerName('   ');
    expect(getPlayerName()).toBe('KeepMe');
  });
});

// ── High scores ───────────────────────────────────────────────────────────────

describe('getLocalHighScore / setLocalHighScore', () => {
  it('returns 0 for unknown heapId', () => {
    expect(getLocalHighScore('unknown-heap')).toBe(0);
  });

  it('setLocalHighScore persists and getLocalHighScore retrieves', () => {
    setLocalHighScore('heap-aaa', 4200);
    expect(getLocalHighScore('heap-aaa')).toBe(4200);
  });

  it('each heapId is stored independently', () => {
    setLocalHighScore('heap-aaa', 4200);
    setLocalHighScore('heap-bbb', 8800);
    expect(getLocalHighScore('heap-aaa')).toBe(4200);
    expect(getLocalHighScore('heap-bbb')).toBe(8800);
  });

  it('overwriting a heapId score stores the new value', () => {
    setLocalHighScore('heap-aaa', 4200);
    setLocalHighScore('heap-aaa', 9999);
    expect(getLocalHighScore('heap-aaa')).toBe(9999);
  });
});

describe('save migration — missing playerGuid/playerName/highScores', () => {
  it('generates playerGuid when field is absent in stored save', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(typeof getPlayerGuid()).toBe('string');
    expect(getPlayerGuid().length).toBeGreaterThan(0);
  });

  it('defaults playerName to Trashbag#XXXXX when field is absent', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(getPlayerName()).toMatch(/^Trashbag#\d{5}$/);
  });

  it('defaults highScores to {} when field is absent', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(getLocalHighScore('any-heap')).toBe(0);
  });
});

describe('SaveData v1→v2 migration', () => {
  beforeEach(() => {
    localStorage.clear();
    resetCacheForTests();
  });

  it('migrates v1 flat placed[] into _legacyPlaced', () => {
    localStorage.setItem('heap_save', JSON.stringify({
      balance: 100,
      upgrades: {},
      inventory: {},
      placed: [{ id: 'ibeam', x: 10, y: 20 }],
      playerGuid: 'p1',
      playerName: 'tester',
      highScores: {},
    }));

    expect(getPlaced('any-heap')).toEqual([]);                 // fresh key is empty
    expect(getLegacyPlacedForTests()).toEqual([{ id: 'ibeam', x: 10, y: 20 }]);
    expect(getSchemaVersionForTests()).toBe(3);
  });

  it('finalizeLegacyPlaced moves items onto a heap id', () => {
    localStorage.setItem('heap_save', JSON.stringify({
      balance: 0,
      upgrades: {}, inventory: {},
      placed: [{ id: 'ibeam', x: 1, y: 2 }, { id: 'ladder', x: 3, y: 4 }],
      playerGuid: 'p', playerName: 'n', highScores: {},
    }));

    finalizeLegacyPlaced('heap-abc');

    expect(getPlaced('heap-abc')).toEqual([
      { id: 'ibeam',  x: 1, y: 2 },
      { id: 'ladder', x: 3, y: 4 },
    ]);
    expect(getLegacyPlacedForTests()).toBeUndefined();
  });

  it('v2 save passes through unchanged', () => {
    localStorage.setItem('heap_save', JSON.stringify({
      schemaVersion: 2,
      balance: 50,
      upgrades: {}, inventory: {},
      placed: { 'heap-a': [{ id: 'ibeam', x: 0, y: 0 }] },
      selectedHeapId: 'heap-a',
      playerGuid: 'p', playerName: 'n', highScores: {},
    }));
    expect(getPlaced('heap-a')).toHaveLength(1);
    expect(getSelectedHeapId()).toBe('heap-a');
  });
});

describe('SaveData per-heap placeables', () => {
  beforeEach(() => { localStorage.clear(); resetCacheForTests(); });

  it('addPlaced is isolated per heap', () => {
    addPlaced('h1', { id: 'ibeam', x: 0, y: 0 });
    addPlaced('h2', { id: 'ladder', x: 0, y: 0 });
    expect(getPlaced('h1')).toHaveLength(1);
    expect(getPlaced('h2')).toHaveLength(1);
    expect(getPlaced('h3')).toEqual([]);
  });

  it('selectedHeapId persists', () => {
    setSelectedHeapId('heap-xyz');
    expect(getSelectedHeapId()).toBe('heap-xyz');
  });
});

// ── Verbose logging ───────────────────────────────────────────────────────────

describe('verboseLogging', () => {
  beforeEach(() => { localStorage.clear(); resetCacheForTests(); });

  it('defaults to false on fresh saves', () => {
    expect(getVerboseLogging()).toBe(false);
  });

  it('persists when set', () => {
    setVerboseLogging(true);
    resetCacheForTests();
    expect(getVerboseLogging()).toBe(true);
  });

  it('returns false when field missing on legacy saves', () => {
    localStorage.setItem('heap_save', JSON.stringify({ schemaVersion: 3, balance: 0, upgrades: {}, inventory: {}, placed: {}, selectedHeapId: '', playerGuid: 'g', playerName: 'n', highScores: {} }));
    resetCacheForTests();
    expect(getVerboseLogging()).toBe(false);
  });
});

// ── Cloud save merging ────────────────────────────────────────────────────────

import { mergeCloudSave } from '../SaveData';

describe('mergeCloudSave', () => {
  const base = () => ({
    schemaVersion: 3,
    balance:        100,
    upgrades:       { air_jump: 1, dash: 0 },
    inventory:      { ladder: 2 },
    placed:         { 'heap-1': [{ id: 'ladder', x: 10, y: 20 }] },
    selectedHeapId: 'heap-1',
    playerGuid:     'local-guid',
    playerName:     'LocalPlayer',
    highScores:     { 'heap-1': 500 },
  });

  it('takes the higher balance', () => {
    const local = { ...base(), balance: 200 };
    const cloud = { ...base(), balance: 300 };
    expect(mergeCloudSave(local, cloud).balance).toBe(300);
  });

  it('takes the higher balance from local if local wins', () => {
    const local = { ...base(), balance: 400 };
    const cloud = { ...base(), balance: 300 };
    expect(mergeCloudSave(local, cloud).balance).toBe(400);
  });

  it('takes the max upgrade level per key', () => {
    const local = { ...base(), upgrades: { air_jump: 2, dash: 1 } };
    const cloud = { ...base(), upgrades: { air_jump: 1, wall_jump: 1 } };
    const merged = mergeCloudSave(local, cloud);
    expect(merged.upgrades).toEqual({ air_jump: 2, dash: 1, wall_jump: 1 });
  });

  it('takes the max inventory count per key', () => {
    const local = { ...base(), inventory: { ladder: 3 } };
    const cloud = { ...base(), inventory: { ladder: 1, checkpoint: 2 } };
    const merged = mergeCloudSave(local, cloud);
    expect(merged.inventory).toEqual({ ladder: 3, checkpoint: 2 });
  });

  it('unions placed items by heapId + item id', () => {
    const item1 = { id: 'ladder',     x: 10, y: 20 };
    const item2 = { id: 'checkpoint', x: 30, y: 40 };
    const local = { ...base(), placed: { 'heap-1': [item1] } };
    const cloud = { ...base(), placed: { 'heap-1': [item1, item2] } };
    const merged = mergeCloudSave(local, cloud);
    // item1 appears once (deduplicated), item2 appears once
    expect(merged.placed['heap-1']).toHaveLength(2);
    expect(merged.placed['heap-1'].map((i: { id: string }) => i.id)).toEqual(['ladder', 'checkpoint']);
  });

  it('unions placed items across all heapIds', () => {
    const item1 = { id: 'ladder',     x: 10, y: 20 };
    const item2 = { id: 'checkpoint', x: 30, y: 40 };
    const local = { ...base(), placed: { 'heap-1': [item1] } };
    const cloud = { ...base(), placed: { 'heap-2': [item2] } };
    const merged = mergeCloudSave(local, cloud);
    expect(merged.placed['heap-1']).toHaveLength(1);
    expect(merged.placed['heap-2']).toHaveLength(1);
  });

  it('takes the higher high score per heapId', () => {
    const local = { ...base(), highScores: { 'heap-1': 1000 } };
    const cloud = { ...base(), highScores: { 'heap-1': 800, 'heap-2': 500 } };
    const merged = mergeCloudSave(local, cloud);
    expect(merged.highScores).toEqual({ 'heap-1': 1000, 'heap-2': 500 });
  });

  it('prefers the name/selectedHeapId from whichever has higher balance', () => {
    const local = { ...base(), balance: 100, playerName: 'Local',  selectedHeapId: 'heap-1' };
    const cloud = { ...base(), balance: 200, playerName: 'Cloud',  selectedHeapId: 'heap-2' };
    const merged = mergeCloudSave(local, cloud);
    expect(merged.playerName).toBe('Cloud');
    expect(merged.selectedHeapId).toBe('heap-2');
  });

  it('prefers local name/selectedHeapId when balances are equal', () => {
    const local = { ...base(), balance: 200, playerName: 'Local', selectedHeapId: 'heap-1' };
    const cloud = { ...base(), balance: 200, playerName: 'Cloud', selectedHeapId: 'heap-2' };
    const merged = mergeCloudSave(local, cloud);
    expect(merged.playerName).toBe('Local');
    expect(merged.selectedHeapId).toBe('heap-1');
  });

  it('preserves playerGuid from local', () => {
    const local = { ...base(), playerGuid: 'local-guid' };
    const cloud = { ...base(), playerGuid: 'cloud-guid' };
    expect(mergeCloudSave(local, cloud).playerGuid).toBe('local-guid');
  });
});
