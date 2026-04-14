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
} from '../SaveData';

// Stub localStorage — vitest runs in node environment
const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
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
  it('returns empty array by default', () => {
    expect(getPlaced()).toEqual([]);
  });

  it('addPlaced appends an item', () => {
    addPlaced({ id: 'ladder', x: 100, y: 200 });
    expect(getPlaced()).toHaveLength(1);
    expect(getPlaced()[0]).toMatchObject({ id: 'ladder', x: 100, y: 200 });
  });

  it('removePlaced removes by index', () => {
    addPlaced({ id: 'ladder', x: 100, y: 200 });
    addPlaced({ id: 'ibeam', x: 300, y: 400 });
    removePlaced(0);
    const placed = getPlaced();
    expect(placed).toHaveLength(1);
    expect(placed[0].id).toBe('ibeam');
  });

  it('getPlaced returns a copy (mutating it does not affect save)', () => {
    addPlaced({ id: 'ladder', x: 100, y: 200 });
    const copy = getPlaced();
    copy.push({ id: 'ibeam', x: 0, y: 0 });
    expect(getPlaced()).toHaveLength(1);
  });
});

describe('updatePlacedMeta', () => {
  it('updates meta on a placed item', () => {
    addPlaced({ id: 'checkpoint', x: 50, y: 50, meta: { spawnsLeft: 5 } });
    updatePlacedMeta(0, { spawnsLeft: 3 });
    expect(getPlaced()[0].meta?.spawnsLeft).toBe(3);
  });

  it('does nothing for out-of-bounds index', () => {
    addPlaced({ id: 'checkpoint', x: 50, y: 50 });
    updatePlacedMeta(99, { spawnsLeft: 0 });
    expect(getPlaced()).toHaveLength(1);
  });
});

describe('removeExpiredPlaced', () => {
  it('removes placed items where spawnsLeft === 0', () => {
    addPlaced({ id: 'checkpoint', x: 0, y: 0, meta: { spawnsLeft: 0 } });
    addPlaced({ id: 'ladder', x: 0, y: 0 }); // no meta — not expired
    removeExpiredPlaced();
    const placed = getPlaced();
    expect(placed).toHaveLength(1);
    expect(placed[0].id).toBe('ladder');
  });

  it('keeps items with spawnsLeft > 0', () => {
    addPlaced({ id: 'checkpoint', x: 0, y: 0, meta: { spawnsLeft: 2 } });
    removeExpiredPlaced();
    expect(getPlaced()).toHaveLength(1);
  });
});

describe('save migration — missing inventory/placed fields', () => {
  it('defaults inventory to {} when field is absent', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(getItemQuantity('ladder')).toBe(0);
  });

  it('defaults placed to [] when field is absent', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(getPlaced()).toEqual([]);
  });
});
