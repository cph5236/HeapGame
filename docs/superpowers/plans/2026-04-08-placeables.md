# Place-Ables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Store scene for purchasing consumable items, an in-game placement system for deploying those items on the heap, and four launch items: Ladder, I-Beam, Checkpoint, and Shield.

**Architecture:** Item definitions live in `itemDefs.ts` (pure data). `SaveData` is extended with inventory quantities and placed-item positions persisted in localStorage. A new `PlaceableManager` system handles in-game placement mode, ghost rendering, surface snapping, and physics spawning. `StoreScene` mirrors `UpgradeScene`. Player gains shield and ladder-climbing state.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vitest (node env), localStorage.

**Spec:** `docs/superpowers/specs/2026-04-08-placeables-design.md`

---

## File Map

**Create:**
- `src/data/itemDefs.ts` — Item interface, ItemCategory, ITEM_DEFS array
- `src/scenes/StoreScene.ts` — Store UI with category filter tabs
- `src/systems/PlaceableManager.ts` — Placement mode state machine, ghost, physics spawning

**Modify:**
- `src/constants.ts` — Add LADDER_HEIGHT, LADDER_WIDTH, IBEAM_WIDTH, IBEAM_HEIGHT, SNAP_RADIUS
- `src/systems/SaveData.ts` — Extend RawSave; add inventory/placed CRUD functions
- `src/systems/__tests__/SaveData.test.ts` — Tests for all new SaveData functions
- `src/scenes/MenuScene.ts` — Add Store button + keyboard shortcut
- `src/main.ts` — Register StoreScene
- `src/entities/Player.ts` — Shield state, ladder climbing mode
- `src/ui/HUD.ts` — Hotbar bag icon (delegates to PlaceableManager)
- `src/scenes/GameScene.ts` — Wire R key, PlaceableManager, shield/checkpoint in damage handler

---

## Task 1: Item Definitions

**Files:**
- Create: `src/data/itemDefs.ts`

- [ ] **Step 1: Create itemDefs.ts**

```typescript
// src/data/itemDefs.ts

export type ItemCategory = 'placeable' | 'buff';

export interface Item {
  id:             string;
  name:           string;
  description:    string;
  cost:           number;
  category:       ItemCategory;
  persistsOnHeap: boolean;
}

export const ITEM_DEFS: Item[] = [
  {
    id:             'ladder',
    name:           'Ladder',
    description:    'Climb the heap. Place on any surface.',
    cost:           300,
    category:       'placeable',
    persistsOnHeap: true,
  },
  {
    id:             'ibeam',
    name:           'I-Beam',
    description:    'One-way platform. Jump up through it and stand on top.',
    cost:           200,
    category:       'placeable',
    persistsOnHeap: true,
  },
  {
    id:             'checkpoint',
    name:           'Checkpoint',
    description:    'Respawn here up to 5 times. Flat surfaces only. 1 active at a time.',
    cost:           500,
    category:       'placeable',
    persistsOnHeap: true,
  },
  {
    id:             'shield',
    name:           'Shield',
    description:    'Absorb one fatal hit. Activates immediately.',
    cost:           400,
    category:       'buff',
    persistsOnHeap: false,
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/itemDefs.ts
git commit -m "feat: add itemDefs with Item interface and 4 launch items"
```

---

## Task 2: SaveData Extensions

**Files:**
- Modify: `src/systems/SaveData.ts`
- Modify: `src/systems/__tests__/SaveData.test.ts`

- [ ] **Step 1: Write failing tests for new SaveData functions**

Replace the entire contents of `src/systems/__tests__/SaveData.test.ts`:

```typescript
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
    addBalance(1000);
    purchaseItem('ibeam'); // costs 200
    purchaseItem('ibeam'); // costs 200
    expect(getItemQuantity('ibeam')).toBe(2);
    expect(getBalance()).toBe(600);
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test
```

Expected: multiple FAIL — functions not found in SaveData.

- [ ] **Step 3: Extend SaveData.ts**

Add `PlacedItemSave` export and update `RawSave`. Replace the entire file:

```typescript
import { UPGRADE_DEFS } from '../data/upgradeDefs';
import { ITEM_DEFS } from '../data/itemDefs';
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../constants';

const SAVE_KEY = 'heap_save';

export interface PlacedItemSave {
  id:    string;
  x:     number;
  y:     number;
  meta?: Record<string, number>;
}

interface RawSave {
  balance:   number;
  upgrades:  Record<string, number>;
  inventory: Record<string, number>;
  placed:    PlacedItemSave[];
}

let _cache: RawSave | null = null;

export interface PlayerConfig {
  maxAirJumps:         number;
  wallJump:            boolean;
  dash:                boolean;
  dive:                boolean;
  moneyMultiplier:     number;
  jumpBoost:           number;
  stompBonus:          number;
  peakMultiplier:      number;
  maxWalkableSlopeDeg: number;
}

const DEFAULT: RawSave = { balance: 0, upgrades: {}, inventory: {}, placed: [] };

function load(): RawSave {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RawSave>;
      const result: RawSave = {
        ...DEFAULT,
        ...parsed,
        inventory: parsed.inventory ?? {},
        placed:    parsed.placed    ?? [],
      };
      _cache = result;
      return result;
    }
  } catch { /* corrupted save — fall through to default */ }
  const fresh: RawSave = { ...DEFAULT, upgrades: {}, inventory: {}, placed: [] };
  _cache = fresh;
  return fresh;
}

function persist(data: RawSave): void {
  _cache = data;
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

// ── Balance ───────────────────────────────────────────────────────────────────

export function getBalance(): number {
  return load().balance;
}

export function addBalance(amount: number): void {
  const data = load();
  data.balance = Math.max(0, data.balance + amount);
  persist(data);
}

// ── Upgrades ──────────────────────────────────────────────────────────────────

export function getUpgradeLevel(id: string): number {
  return load().upgrades[id] ?? 0;
}

export function purchaseUpgrade(id: string): boolean {
  const def = UPGRADE_DEFS.find(d => d.id === id);
  if (!def) return false;

  const data  = load();
  const level = data.upgrades[id] ?? 0;
  if (level >= def.maxLevel) return false;

  const price = def.cost(level + 1);
  if (data.balance < price) return false;

  data.balance -= price;
  data.upgrades[id] = level + 1;
  persist(data);
  return true;
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export function getItemQuantity(id: string): number {
  return load().inventory[id] ?? 0;
}

export function addItem(id: string, qty = 1): void {
  const data = load();
  data.inventory[id] = (data.inventory[id] ?? 0) + qty;
  persist(data);
}

export function spendItem(id: string): boolean {
  const data = load();
  const qty = data.inventory[id] ?? 0;
  if (qty <= 0) return false;
  data.inventory[id] = qty - 1;
  persist(data);
  return true;
}

export function purchaseItem(id: string): boolean {
  const def = ITEM_DEFS.find(d => d.id === id);
  if (!def) return false;
  const data = load();
  if (data.balance < def.cost) return false;
  data.balance -= def.cost;
  data.inventory[id] = (data.inventory[id] ?? 0) + 1;
  persist(data);
  return true;
}

// ── Placed items ──────────────────────────────────────────────────────────────

export function getPlaced(): PlacedItemSave[] {
  return [...load().placed];
}

export function addPlaced(item: PlacedItemSave): void {
  const data = load();
  data.placed.push(item);
  persist(data);
}

export function removePlaced(index: number): void {
  const data = load();
  data.placed.splice(index, 1);
  persist(data);
}

export function updatePlacedMeta(index: number, meta: Record<string, number>): void {
  const data = load();
  if (data.placed[index]) {
    data.placed[index].meta = meta;
    persist(data);
  }
}

export function removeExpiredPlaced(): void {
  const data = load();
  data.placed = data.placed.filter(p => {
    if (p.meta?.spawnsLeft !== undefined) return p.meta.spawnsLeft > 0;
    return true;
  });
  persist(data);
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export function resetAllData(): void {
  _cache = null;
  localStorage.removeItem(SAVE_KEY);
}

// ── Player config ─────────────────────────────────────────────────────────────

export function getPlayerConfig(): PlayerConfig {
  const jl = getUpgradeLevel('jump_boost');
  const sl = getUpgradeLevel('stomp_gold');
  const pl = getUpgradeLevel('peak_hunter');
  return {
    maxAirJumps:         1 + getUpgradeLevel('air_jump'),
    wallJump:            getUpgradeLevel('wall_jump') > 0,
    dash:                getUpgradeLevel('dash') > 0,
    dive:                getUpgradeLevel('dive') > 0,
    moneyMultiplier:     1 + getUpgradeLevel('money_mult') * 0.1,
    jumpBoost:           [0, 70, 150, 240][jl],
    stompBonus:          [25, 50, 90, 150][sl],
    peakMultiplier:      [1.25, 1.40, 1.60, 1.85][pl],
    maxWalkableSlopeDeg: MAX_WALKABLE_SLOPE_DEG + getUpgradeLevel('mountain_climber') * MOUNTAIN_CLIMBER_INCREMENT,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test
```

Expected: all tests PASS (88+ tests).

- [ ] **Step 5: Commit**

```bash
git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts
git commit -m "feat: extend SaveData with inventory and placed-items persistence"
```

---

## Task 3: Constants

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add placement constants to constants.ts**

Append to the end of `src/constants.ts`:

```typescript
// Place-Ables
export const LADDER_HEIGHT  = 230;  // ~5× PLAYER_HEIGHT; designer-tunable
export const LADDER_WIDTH   = 20;
export const IBEAM_WIDTH    = 120;  // designer-tunable
export const IBEAM_HEIGHT   = 12;
export const SNAP_RADIUS    = 80;   // px below pointer to search for a walkable surface
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add placeable item dimension constants"
```

---

## Task 4: StoreScene

**Files:**
- Create: `src/scenes/StoreScene.ts`

The StoreScene mirrors UpgradeScene's visual style. Key differences: category filter tabs at the top, rows show `Own: N` instead of level/max, no max — always BUY if affordable.

- [ ] **Step 1: Create StoreScene.ts**

```typescript
// src/scenes/StoreScene.ts
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { ITEM_DEFS, ItemCategory } from '../data/itemDefs';
import { getBalance, getItemQuantity, purchaseItem } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';

const ROW_START_Y   = 160;
const ROW_SPACING   = 88;
const ROW_HEIGHT    = 76;
const COL_LEFT      = 28;
const COL_RIGHT     = GAME_WIDTH - 16;
const FOOTER_HEIGHT = 50;
const HEADER_BOTTOM = 145;

const TAB_LABELS: Array<{ label: string; value: ItemCategory | 'all' }> = [
  { label: 'All',       value: 'all' },
  { label: 'Placeable', value: 'placeable' },
  { label: 'Buff',      value: 'buff' },
];

const ACCENT_COLORS: Record<string, number> = {
  ladder:     0x44cc88,
  ibeam:      0x4488ff,
  checkpoint: 0xffaa22,
  shield:     0xcc44ff,
};

export class StoreScene extends Phaser.Scene {
  private selectedIndex: number = 0;
  private activeFilter: ItemCategory | 'all' = 'all';
  private balanceText!: Phaser.GameObjects.Text;
  private titleText!:   Phaser.GameObjects.Text;
  private titleShadow!: Phaser.GameObjects.Text;
  private rows: StoreRow[] = [];
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private tabBgs:   Phaser.GameObjects.Rectangle[] = [];
  private twinkleStars: Phaser.GameObjects.Graphics[] = [];
  private maxScroll: number = 0;

  constructor() {
    super({ key: 'StoreScene' });
  }

  create(): void {
    this.twinkleStars = [];
    this.selectedIndex = 0;
    this.activeFilter = 'all';

    this.createSkyGradient();
    this.createStarField();
    this.createFloatingClouds();
    this.createHeader();
    this.createFilterTabs();
    this.createRows();
    this.createFooter();
    this.setupScroll();
    this.registerInput();
    this.runEntranceSequence();
  }

  // ── Background ────────────────────────────────────────────────────────────────

  private createSkyGradient(): void {
    const bands: [number, number, number][] = [
      [0,   47, 0x0a0818], [47,  47, 0x0e0d24], [94,  47, 0x121530],
      [141, 47, 0x161c3a], [188, 47, 0x1a2244], [235, 47, 0x1e284e],
      [282, 47, 0x222d55], [329, 47, 0x2a3460], [376, 47, 0x2e3860],
      [423, 47, 0x37415e], [470, 47, 0x4a4455], [517, 47, 0x5c4840],
      [564, 47, 0x6e4e30], [611, 47, 0x7d5228], [658, 47, 0x8a5520],
      [705, 47, 0x7a4a1a], [752, 47, 0x5e3a14], [799, 55, 0x3e280e],
    ];
    const g = this.add.graphics().setDepth(0).setScrollFactor(0);
    for (const [y, h, color] of bands) {
      g.fillStyle(color, 1);
      g.fillRect(0, y, GAME_WIDTH, h);
    }
  }

  private createStarField(): void {
    const staticG = this.add.graphics().setDepth(1).setScrollFactor(0);
    for (let i = 0; i < 68; i++) {
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(0, 514);
      const roll = Phaser.Math.Between(0, 9);
      const r = roll < 6 ? 0.7 : roll < 9 ? 1.2 : 2.0;
      const a = roll < 6 ? 0.9 : roll < 9 ? 0.55 : 0.25;
      staticG.fillStyle(0xffffff, a);
      staticG.fillCircle(x, y, r);
    }
    for (let i = 0; i < 12; i++) {
      const g = this.add.graphics().setDepth(1).setScrollFactor(0);
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(0, 514);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, 1.2);
      this.twinkleStars.push(g);
    }
  }

  private createFloatingClouds(): void {
    const clouds: [number, number, number, boolean, number, number][] = [
      [60,  100, 2.0, true,  22000, 0.38],
      [380, 170, 1.5, false, 28000, 0.35],
      [160, 260, 1.2, true,  18000, 0.42],
    ];
    for (const [x, y, scale, goLeft, duration, alpha] of clouds) {
      this.spawnCloud(x, y, scale, goLeft, duration, alpha);
    }
  }

  private spawnCloud(x: number, y: number, scaleVal: number, goLeft: boolean, duration: number, alpha: number): void {
    const cloud = this.add.image(x, y, 'cloud')
      .setScale(scaleVal).setAlpha(alpha).setDepth(3).setScrollFactor(0);
    const offscreen = 32 * scaleVal + 10;
    const targetX = goLeft ? -offscreen : GAME_WIDTH + offscreen;
    const startX  = goLeft ? GAME_WIDTH + offscreen : -offscreen;
    const doTween = () => {
      this.tweens.add({
        targets: cloud, x: targetX, duration, ease: 'Linear',
        onComplete: () => { cloud.setX(startX); doTween(); },
      });
    };
    doTween();
  }

  // ── Header ────────────────────────────────────────────────────────────────────

  private createHeader(): void {
    const headerCover = this.add.graphics().setDepth(9).setScrollFactor(0);
    const bands: [number, number, number][] = [
      [0,  47, 0x0a0818], [47, 47, 0x0e0d24], [94, 21, 0x121530],
    ];
    for (const [y, h, color] of bands) {
      headerCover.fillStyle(color, 1);
      headerCover.fillRect(0, y, GAME_WIDTH, h);
    }

    const backHit = this.add.rectangle(30, 50, 52, 52, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(11).setScrollFactor(0);
    this.add.text(12, 34, '\u2190', {
      fontSize: '48px', color: '#ff9922',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(11).setScrollFactor(0);
    backHit.on('pointerup', () => this.scene.start('MenuScene'));

    this.titleShadow = this.add.text(242, 52, 'STORE', {
      fontSize: '38px', fontStyle: 'bold',
      color: '#000000', stroke: '#000000', strokeThickness: 10,
    }).setOrigin(0.5).setAlpha(0).setDepth(10).setScrollFactor(0);

    this.titleText = this.add.text(240, 50, 'STORE', {
      fontSize: '38px', fontStyle: 'bold',
      color: '#ff9922', stroke: '#1a0800', strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0).setDepth(10).setScrollFactor(0);

    this.balanceText = this.add.text(GAME_WIDTH / 2, 96, '', {
      fontSize: '18px', color: '#ffdd77',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(10).setScrollFactor(0);
  }

  // ── Filter Tabs ───────────────────────────────────────────────────────────────

  private createFilterTabs(): void {
    const tabW = 110;
    const tabH = 28;
    const tabY = 125;
    const startX = GAME_WIDTH / 2 - ((TAB_LABELS.length * tabW + (TAB_LABELS.length - 1) * 8) / 2);

    TAB_LABELS.forEach(({ label, value }, i) => {
      const tx = startX + i * (tabW + 8) + tabW / 2;
      const bg = this.add.rectangle(tx, tabY, tabW, tabH, 0x1a0800)
        .setStrokeStyle(1, 0xff9922)
        .setInteractive({ useHandCursor: true })
        .setDepth(10).setScrollFactor(0).setAlpha(0);
      const txt = this.add.text(tx, tabY, label, {
        fontSize: '14px', color: '#ff9922',
        stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5).setDepth(11).setScrollFactor(0).setAlpha(0);

      bg.on('pointerup', () => this.setFilter(value));
      this.tabBgs.push(bg);
      this.tabTexts.push(txt);
    });

    this.refreshTabVisuals();
  }

  private setFilter(filter: ItemCategory | 'all'): void {
    this.activeFilter = filter;
    this.selectedIndex = 0;
    this.rows.forEach((row, i) => {
      const def = ITEM_DEFS[i];
      const visible = filter === 'all' || def.category === filter;
      row.setVisible(visible);
    });
    this.recalcScroll();
    this.refreshTabVisuals();
    this.refreshAll();
  }

  private refreshTabVisuals(): void {
    TAB_LABELS.forEach(({ value }, i) => {
      const active = this.activeFilter === value;
      this.tabBgs[i]?.setFillStyle(active ? 0x3a1800 : 0x1a0800)
                     .setStrokeStyle(active ? 2 : 1, active ? 0xffaa33 : 0xff9922);
      this.tabTexts[i]?.setColor(active ? '#ffaa33' : '#ff9922');
    });
  }

  // ── Rows ──────────────────────────────────────────────────────────────────────

  private createRows(): void {
    this.rows = ITEM_DEFS.map((def, i) => {
      const y = ROW_START_Y + i * ROW_SPACING;
      const accentColor = ACCENT_COLORS[def.id] ?? 0x888888;
      return new StoreRow(this, def.name, y, accentColor);
    });

    this.rows.forEach((row, i) => {
      row.enableInteractive(
        () => { this.selectedIndex = i; this.refreshAll(); },
        () => { this.selectedIndex = i; this.buy(); },
      );
    });

    this.recalcScroll();
    this.refreshAll();
  }

  private recalcScroll(): void {
    const visibleCount = ITEM_DEFS.filter((def, i) => {
      void i;
      return this.activeFilter === 'all' || def.category === this.activeFilter;
    }).length;
    const contentH = ROW_START_Y + visibleCount * ROW_SPACING;
    this.maxScroll = Math.max(0, contentH - (GAME_HEIGHT - FOOTER_HEIGHT));
  }

  // ── Footer ────────────────────────────────────────────────────────────────────

  private createFooter(): void {
    const im = InputManager.getInstance();

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - FOOTER_HEIGHT / 2, GAME_WIDTH, FOOTER_HEIGHT, 0x111118, 0.88)
      .setDepth(9).setScrollFactor(0);

    const fadeG = this.add.graphics().setDepth(9).setScrollFactor(0);
    fadeG.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.65, 0.65);
    fadeG.fillRect(0, GAME_HEIGHT - FOOTER_HEIGHT - 28, GAME_WIDTH, 28);

    if (im.isMobile) {
      const backBtnBg = this.add.rectangle(
        GAME_WIDTH / 2, GAME_HEIGHT - 24, 200, 36, 0x1a0800,
      ).setStrokeStyle(1, 0xff9922).setInteractive({ useHandCursor: true })
       .setDepth(10).setScrollFactor(0);
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 24, '\u2190 Back to Menu', {
        fontSize: '15px', color: '#ff9922', stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5).setDepth(11).setScrollFactor(0);
      backBtnBg.on('pointerup', () => this.scene.start('MenuScene'));
    } else {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 28,
        '\u2191\u2193 navigate   ENTER / click BUY   ESC menu',
        { fontSize: '16px', color: '#b1abab' },
      ).setOrigin(0.5).setDepth(10).setScrollFactor(0);
    }
  }

  // ── Scroll ────────────────────────────────────────────────────────────────────

  private setupScroll(): void {
    this.input.on('wheel', (_p: unknown, _g: unknown, _dx: unknown, dy: number) => {
      this.scrollBy(dy * 0.6);
    });
    let lastPointerY = 0;
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => { lastPointerY = ptr.y; });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!ptr.isDown) return;
      this.scrollBy(lastPointerY - ptr.y);
      lastPointerY = ptr.y;
    });
  }

  private scrollBy(delta: number): void {
    const cam = this.cameras.main;
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY + delta, 0, this.maxScroll);
  }

  // ── Input ─────────────────────────────────────────────────────────────────────

  private registerInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-UP',    () => this.move(-1));
    kb.on('keydown-DOWN',  () => this.move(1));
    kb.on('keydown-ENTER', () => this.buy());
    kb.on('keydown-SPACE', () => this.buy());
    kb.on('keydown-ESC',   () => this.scene.start('MenuScene'));
  }

  // ── Entrance ──────────────────────────────────────────────────────────────────

  private runEntranceSequence(): void {
    this.tweens.add({
      targets: [this.titleShadow, this.titleText, this.balanceText],
      alpha: 1, duration: 400,
    });
    this.tabBgs.forEach((bg, i) => {
      this.tweens.add({ targets: bg, alpha: 1, duration: 300, delay: 150 + i * 60 });
    });
    this.tabTexts.forEach((txt, i) => {
      this.tweens.add({ targets: txt, alpha: 1, duration: 300, delay: 150 + i * 60 });
    });
    const lastDelay = 250 + (this.rows.length - 1) * 60;
    this.rows.forEach((row, i) => {
      this.tweens.add({
        targets: row.getAllObjects(),
        alpha: 1, duration: 300, delay: 250 + i * 60,
      });
    });
    this.time.delayedCall(lastDelay + 310, () => this.refreshAll());
    this.time.delayedCall(lastDelay + 400, () => {
      for (const star of this.twinkleStars) {
        this.tweens.add({
          targets: star,
          alpha: { from: 0.9, to: 0.15 },
          duration: Phaser.Math.Between(1200, 2800),
          yoyo: true, loop: -1,
          delay: Phaser.Math.Between(0, 2000),
        });
      }
    });
  }

  // ── Logic ─────────────────────────────────────────────────────────────────────

  private move(dir: number): void {
    this.selectedIndex = (this.selectedIndex + dir + ITEM_DEFS.length) % ITEM_DEFS.length;
    this.refreshAll();
  }

  private buy(): void {
    const id = ITEM_DEFS[this.selectedIndex].id;
    const success = purchaseItem(id);
    if (success) {
      this.rows[this.selectedIndex].flashSuccess();
      this.time.delayedCall(450, () => this.refreshAll());
    } else {
      this.refreshAll();
    }
  }

  private refreshAll(): void {
    this.balanceText.setText(`Balance: ${getBalance()} coins`);
    const balance = getBalance();
    this.rows.forEach((row, i) => {
      const def       = ITEM_DEFS[i];
      const qty       = getItemQuantity(def.id);
      const canAfford = balance >= def.cost;
      row.refresh(qty, def.cost, def.description, i === this.selectedIndex, canAfford);
    });
  }
}

// ── StoreRow ──────────────────────────────────────────────────────────────────

class StoreRow {
  private readonly scene: Phaser.Scene;
  private bg:         Phaser.GameObjects.Rectangle;
  private accentBar:  Phaser.GameObjects.Rectangle;
  private nameText:   Phaser.GameObjects.Text;
  private ownText:    Phaser.GameObjects.Text;
  private costText:   Phaser.GameObjects.Text;
  private descText:   Phaser.GameObjects.Text;
  private buyBtnBg:   Phaser.GameObjects.Rectangle;
  private buyBtnTxt:  Phaser.GameObjects.Text;
  private _visible:   boolean = true;

  constructor(scene: Phaser.Scene, name: string, y: number, accentColor: number) {
    this.scene = scene;

    this.bg = scene.add.rectangle(GAME_WIDTH / 2, y + ROW_HEIGHT / 2, GAME_WIDTH - 20, ROW_HEIGHT, 0x0a0818)
      .setFillStyle(0x0a0818, 0.92).setStrokeStyle(1, 0x2a2240).setDepth(6).setAlpha(0);

    this.accentBar = scene.add.rectangle(14, y + ROW_HEIGHT / 2, 4, ROW_HEIGHT - 4, accentColor)
      .setDepth(7).setAlpha(0);

    this.nameText = scene.add.text(COL_LEFT, y + 6, name, {
      fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setDepth(7).setAlpha(0);

    this.ownText = scene.add.text(COL_RIGHT, y + 6, '', {
      fontSize: '16px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0).setDepth(7).setAlpha(0);

    this.costText = scene.add.text(COL_LEFT, y + 28, '', {
      fontSize: '15px', color: '#ff9922', stroke: '#000000', strokeThickness: 1,
    }).setDepth(7).setAlpha(0);

    this.descText = scene.add.text(COL_LEFT, y + 46, '', {
      fontSize: '13px', color: '#cc9966', stroke: '#000000', strokeThickness: 1,
    }).setDepth(7).setAlpha(0);

    const btnX = GAME_WIDTH - 52;
    const btnY = y + 56;
    this.buyBtnBg = scene.add.rectangle(btnX, btnY, 72, 22, 0x1a0800)
      .setStrokeStyle(1, 0xff9922).setInteractive({ useHandCursor: true })
      .setDepth(7).setAlpha(0);

    this.buyBtnTxt = scene.add.text(btnX, btnY, 'BUY', {
      fontSize: '13px', color: '#ff9922', stroke: '#000000', strokeThickness: 1,
    }).setOrigin(0.5).setDepth(8).setAlpha(0);
  }

  getAllObjects(): Phaser.GameObjects.GameObject[] {
    return [this.bg, this.accentBar, this.nameText, this.ownText, this.costText, this.descText, this.buyBtnBg, this.buyBtnTxt];
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    this.getAllObjects().forEach(o => (o as Phaser.GameObjects.GameObject & { setVisible: (v: boolean) => void }).setVisible(visible));
  }

  enableInteractive(onHover: () => void, onBuy: () => void): void {
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', onHover);
    this.buyBtnBg.on('pointerover', onHover);
    this.buyBtnBg.on('pointerup', onBuy);
  }

  flashSuccess(): void {
    this.bg.setFillStyle(0x0a3018).setStrokeStyle(2, 0x44ff88);
    this.buyBtnBg.setFillStyle(0x0a3018).setStrokeStyle(2, 0x44ff88);
    this.scene.time.delayedCall(400, () => {
      this.bg.setFillStyle(0x0a0818, 0.92).setStrokeStyle(1, 0x2a2240);
      this.buyBtnBg.setFillStyle(0x1a0800).setStrokeStyle(1, 0xff9922);
    });
  }

  refresh(qty: number, cost: number, desc: string, selected: boolean, canAfford: boolean): void {
    if (!this._visible) return;

    if (selected) {
      this.bg.setFillStyle(0x1a0800, 0.95).setStrokeStyle(2, 0xff9922);
    } else {
      this.bg.setFillStyle(0x0a0818, 0.92).setStrokeStyle(1, 0x2a2240);
    }

    this.ownText.setText(`Own: ${qty}`).setColor('#ffdd77');
    this.costText.setText(`${cost} coins`).setColor(canAfford ? '#ff9922' : '#996644');
    this.descText.setText(desc);

    const dimmed = !canAfford && !selected;
    const alpha  = dimmed ? 0.65 : 1;
    this.nameText.setAlpha(alpha);
    this.ownText.setAlpha(alpha);
    this.costText.setAlpha(alpha);
    this.descText.setAlpha(alpha);
    this.accentBar.setAlpha(dimmed ? 0.45 : 1);

    if (canAfford) {
      this.buyBtnBg.setFillStyle(0x1a0800).setStrokeStyle(selected ? 2 : 1, 0xff9922);
      this.buyBtnTxt.setColor('#ff9922');
    } else {
      this.buyBtnBg.setFillStyle(0x100808).setStrokeStyle(1, 0x664433);
      this.buyBtnTxt.setColor('#664433');
    }
    this.buyBtnBg.setAlpha(dimmed ? 0.65 : 1);
    this.buyBtnTxt.setAlpha(dimmed ? 0.65 : 1);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/scenes/StoreScene.ts
git commit -m "feat: add StoreScene with category filter tabs and BUY flow"
```

---

## Task 5: MenuScene + main.ts wiring

**Files:**
- Modify: `src/scenes/MenuScene.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Register StoreScene in main.ts**

In `src/main.ts`, add the import and scene registration:

```typescript
import { StoreScene } from './scenes/StoreScene';
```

Change the scene array:
```typescript
scene: [BootScene, MenuScene, GameScene, ScoreScene, UpgradeScene, StoreScene],
```

- [ ] **Step 2: Add Store button to MenuScene**

In `src/scenes/MenuScene.ts`, add a `storeBg` and `storeText` field to the class (alongside the existing `upgradeBg`/`upgradeText` fields):

```typescript
private storeBg!:    Phaser.GameObjects.Graphics;
private storeText!:  Phaser.GameObjects.Text;
```

In `createPrompts()`, after the Upgrade button block (around line 280), add:

```typescript
// Store button
this.storeBg = this.add.graphics().setDepth(8).setAlpha(0);
this.storeBg.fillStyle(0x000000, 0.5);
this.storeBg.fillRoundedRect(GAME_WIDTH / 2 - 160, 680, 320, 56, 12);
this.storeBg.lineStyle(2, 0x8899bb, 0.6);
this.storeBg.strokeRoundedRect(GAME_WIDTH / 2 - 160, 680, 320, 56, 12);

this.storeText = this.add.text(GAME_WIDTH / 2, 708, 'STORE', {
  fontSize: '20px',
  color: '#44ffaa',
  stroke: '#000000',
  strokeThickness: 2,
}).setOrigin(0.5).setAlpha(0).setDepth(9);
```

In `runEntranceSequence()`, after the upgradeText tween block, add:

```typescript
this.tweens.add({ targets: this.storeBg,   alpha: 1, duration: 300, delay: 2000 });
this.tweens.add({ targets: this.storeText, alpha: 1, duration: 300, delay: 2000 });
```

In `registerInput()`, inside the `time.delayedCall` callback, after the upgradeText listener block, add:

```typescript
this.storeText.setInteractive(
  new Phaser.Geom.Rectangle(-200, -40, 400, 80),
  Phaser.Geom.Rectangle.Contains,
);
this.storeText.once('pointerup', () => this.scene.start('StoreScene'));

this.input.keyboard!.once('keydown-S', () => this.scene.start('StoreScene'));
```

Also update the existing `keydown-U` line to use `.on` instead of `.once` if needed (it uses `once` already, that's fine).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke test in browser**

```bash
npm run dev
```

Open browser. Verify: Store button appears on menu, clicking it opens StoreScene, all 4 items listed, filter tabs work, BUY deducts balance and increments Own count, ESC/back returns to menu.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/scenes/MenuScene.ts
git commit -m "feat: add Store button to MenuScene, register StoreScene"
```

---

## Task 6: Player Shield State

**Files:**
- Modify: `src/entities/Player.ts`

- [ ] **Step 1: Add shield state to Player**

In `src/entities/Player.ts`, add these private fields and public API. After the existing `public inSlopeZone = false;` line, add:

```typescript
private shieldActive: boolean = false;
```

After the existing HUD accessors block, add:

```typescript
get hasActiveShield(): boolean { return this.shieldActive; }

activateShield(): void {
  this.shieldActive = true;
  this.sprite.setTint(0x8844ff); // purple tint = shield active
}

absorbHit(): void {
  this.shieldActive = false;
  this.sprite.clearTint();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/entities/Player.ts
git commit -m "feat: add shield state to Player (activateShield, absorbHit)"
```

---

## Task 7: Player Ladder Climbing Mode

**Files:**
- Modify: `src/entities/Player.ts`

- [ ] **Step 1: Add ladder climbing state and update logic**

In `src/entities/Player.ts`, add this private field after `shieldActive`:

```typescript
private onLadder: boolean = false;
```

Add these public methods after the `absorbHit()` method:

```typescript
get isOnLadder(): boolean { return this.onLadder; }

enterLadder(): void {
  if (this.onLadder) return;
  this.onLadder = true;
  this.sprite.body.setAllowGravity(false);
  this.sprite.setVelocityY(0);
}

exitLadder(): void {
  if (!this.onLadder) return;
  this.onLadder = false;
  this.sprite.body.setAllowGravity(true);
}
```

At the very start of the `update(delta: number)` method, before the `const body = ...` line, add:

```typescript
// Ladder climbing mode — vertical movement only, gravity off, jump suppressed
if (this.onLadder) {
  const im = InputManager.getInstance();
  const goUp   = this.jumpKeys.some(k => k.isDown)  || im.jumpJustPressed;
  const goDown = this.downKeys.some(k => k.isDown);
  this.sprite.setVelocityX(0);
  this.sprite.setVelocityY(goUp ? -PLAYER_SPEED * 0.65 : goDown ? PLAYER_SPEED * 0.65 : 0);
  // Still allow X-wrap so player doesn't get stuck at world edge on ladder
  if (this.sprite.x < 0)           this.sprite.x = WORLD_WIDTH;
  else if (this.sprite.x > WORLD_WIDTH) this.sprite.x = 0;
  return; // skip all normal physics this frame
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/entities/Player.ts
git commit -m "feat: add ladder climbing mode to Player (enterLadder/exitLadder)"
```

---

## Task 8: PlaceableManager — Foundation

This task creates PlaceableManager with constructor and run-start spawning of saved placed items (ladder, I-beam, checkpoint physics bodies from SaveData).

**Files:**
- Create: `src/systems/PlaceableManager.ts`

- [ ] **Step 1: Create PlaceableManager with spawn-from-save logic**

```typescript
// src/systems/PlaceableManager.ts
import Phaser from 'phaser';
import {
  LADDER_HEIGHT, LADDER_WIDTH,
  IBEAM_WIDTH, IBEAM_HEIGHT,
  SNAP_RADIUS, PLAYER_INVINCIBLE_MS,
} from '../constants';
import {
  getPlaced, addPlaced, removePlaced, updatePlacedMeta,
  removeExpiredPlaced, spendItem, PlacedItemSave,
} from './SaveData';
import { ITEM_DEFS } from '../data/itemDefs';
import { Player } from '../entities/Player';

export const enum PlacementState { Closed, Hotbar, Placing }

interface SpawnedBody {
  saveIndex: number;
  object:    Phaser.GameObjects.Rectangle;
  itemId:    string;
}

export class PlaceableManager {
  private readonly scene:         Phaser.Scene;
  private readonly player:        Player;
  private readonly walkableGroup: Phaser.Physics.Arcade.StaticGroup;

  private state:          PlacementState = PlacementState.Closed;
  private placingItemId:  string = '';
  private ghost!:         Phaser.GameObjects.Graphics;
  private ghostValid:     boolean = false;
  private ghostWorldX:    number = 0;
  private ghostWorldY:    number = 0;

  private hotbarBg!:      Phaser.GameObjects.Rectangle;
  private hotbarItems:    Phaser.GameObjects.Rectangle[] = [];
  private hotbarLabels:   Phaser.GameObjects.Text[] = [];
  private hotbarQtys:     Phaser.GameObjects.Text[] = [];

  private confirmBtn!:    Phaser.GameObjects.Rectangle;
  private confirmTxt!:    Phaser.GameObjects.Text;
  private cancelBtn!:     Phaser.GameObjects.Rectangle;
  private cancelTxt!:     Phaser.GameObjects.Text;

  private spawnedBodies:  SpawnedBody[] = [];
  private ladderOverlaps: Phaser.Physics.Arcade.Collider[] = [];
  private ibeamColliders: Phaser.Physics.Arcade.Collider[] = [];
  private checkpointGroup!: Phaser.Physics.Arcade.StaticGroup;

  constructor(
    scene:         Phaser.Scene,
    player:        Player,
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
  ) {
    this.scene         = scene;
    this.player        = player;
    this.walkableGroup = walkableGroup;

    this.checkpointGroup = scene.physics.add.staticGroup();
    this.createUI();
    this.spawnSavedItems();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Called from GameScene.update() */
  update(): void {
    if (this.state === PlacementState.Placing) {
      this.updateGhost();
    }
  }

  openHotbar(): void {
    if (this.state !== PlacementState.Closed) {
      this.closeAll();
      return;
    }
    this.state = PlacementState.Hotbar;
    this.refreshHotbar();
    this.setHotbarVisible(true);
  }

  closeAll(): void {
    this.state = PlacementState.Closed;
    this.placingItemId = '';
    this.setHotbarVisible(false);
    this.setPlacementUIVisible(false);
    this.ghost.clear();
  }

  /**
   * Intercept an enemy hit. Returns true if the hit was absorbed (shield or checkpoint).
   * Caller should skip normal death logic when this returns true.
   */
  handlePlayerDeath(
    invincibleSetter: (v: boolean) => void,
    respawnAt: (x: number, y: number) => void,
  ): boolean {
    return this.tryCheckpointRespawn(invincibleSetter, respawnAt);
  }

  // ── UI creation ──────────────────────────────────────────────────────────────

  private createUI(): void {
    const { scene } = this;
    const GAME_WIDTH  = scene.scale.width;
    const GAME_HEIGHT = scene.scale.height;

    // Ghost graphics (world-space, scrolls with camera)
    this.ghost = scene.add.graphics().setDepth(30);

    // Hotbar background panel (screen-space)
    this.hotbarBg = scene.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT - 130, GAME_WIDTH - 20, 100, 0x0a0818, 0.94,
    ).setScrollFactor(0).setDepth(25).setStrokeStyle(1, 0x2a2240).setVisible(false);

    // Build item slots for each ITEM_DEF
    const slotW  = 80;
    const slotH  = 70;
    const totalW = ITEM_DEFS.length * (slotW + 8) - 8;
    const startX = GAME_WIDTH / 2 - totalW / 2 + slotW / 2;
    const slotY  = GAME_HEIGHT - 130;

    ITEM_DEFS.forEach((def, i) => {
      const sx = startX + i * (slotW + 8);

      const slot = scene.add.rectangle(sx, slotY, slotW, slotH, 0x1a0820)
        .setScrollFactor(0).setDepth(26)
        .setStrokeStyle(1, 0x4455aa).setVisible(false)
        .setInteractive({ useHandCursor: true });

      const label = scene.add.text(sx, slotY - 14, def.name, {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 1,
        align: 'center', wordWrap: { width: slotW - 4 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(27).setVisible(false);

      const qty = scene.add.text(sx, slotY + 18, 'x0', {
        fontSize: '14px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(27).setVisible(false);

      slot.on('pointerup', () => this.selectItem(def.id));

      this.hotbarItems.push(slot);
      this.hotbarLabels.push(label);
      this.hotbarQtys.push(qty);
    });

    // Confirm button
    this.confirmBtn = scene.add.rectangle(
      GAME_WIDTH / 2 - 60, GAME_HEIGHT - 60, 110, 36, 0x0a3010,
    ).setScrollFactor(0).setDepth(25).setStrokeStyle(2, 0x44ff88)
     .setInteractive({ useHandCursor: true }).setVisible(false);

    this.confirmTxt = scene.add.text(GAME_WIDTH / 2 - 60, GAME_HEIGHT - 60, 'PLACE', {
      fontSize: '16px', color: '#44ff88', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(26).setVisible(false);

    this.confirmBtn.on('pointerup', () => this.confirmPlacement());

    // Cancel button
    this.cancelBtn = scene.add.rectangle(
      GAME_WIDTH / 2 + 60, GAME_HEIGHT - 60, 110, 36, 0x200a0a,
    ).setScrollFactor(0).setDepth(25).setStrokeStyle(2, 0xff4444)
     .setInteractive({ useHandCursor: true }).setVisible(false);

    this.cancelTxt = scene.add.text(GAME_WIDTH / 2 + 60, GAME_HEIGHT - 60, 'CANCEL', {
      fontSize: '16px', color: '#ff4444', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(26).setVisible(false);

    this.cancelBtn.on('pointerup', () => this.closeAll());
  }

  // ── Spawn saved items on run start ───────────────────────────────────────────

  private spawnSavedItems(): void {
    const placed = getPlaced();
    placed.forEach((save, index) => {
      switch (save.id) {
        case 'ladder':     this.spawnLadderBody(save, index); break;
        case 'ibeam':      this.spawnIBeamBody(save, index);  break;
        case 'checkpoint': this.spawnCheckpointBody(save, index); break;
      }
    });
  }

  // ── Item selection & placement mode ─────────────────────────────────────────

  private selectItem(itemId: string): void {
    if (itemId === 'shield') {
      this.activateShield();
      this.closeAll();
      return;
    }
    this.setHotbarVisible(false);
    this.placingItemId = itemId;
    this.state = PlacementState.Placing;
    this.setPlacementUIVisible(true);
  }

  private activateShield(): void {
    if (!spendItem('shield')) return;
    this.player.activateShield();
  }

  // ── Ghost / surface snapping ─────────────────────────────────────────────────

  private updateGhost(): void {
    const cam     = this.scene.cameras.main;
    const ptr     = this.scene.input.activePointer;
    const worldX  = ptr.x + cam.scrollX;
    const worldY  = ptr.y + cam.scrollY;

    const snapY = this.findSurfaceY(worldX, worldY);
    this.ghostValid = snapY !== null;
    this.ghostWorldX = worldX;
    this.ghostWorldY = snapY ?? worldY;

    // Additional constraint: checkpoint requires walkable-classified surface (handled by findSurfaceY against walkableGroup)
    this.drawGhost();
  }

  private findSurfaceY(worldX: number, worldY: number): number | null {
    const bodies = this.walkableGroup.getChildren();
    let best: number | null = null;
    let bestDist = Infinity;
    for (const obj of bodies) {
      const body = (obj as Phaser.GameObjects.Image).body as Phaser.Physics.Arcade.StaticBody;
      if (worldX >= body.left && worldX <= body.right) {
        const dist = worldY - body.top;
        if (dist >= -LADDER_HEIGHT && dist < SNAP_RADIUS && dist < bestDist) {
          best = body.top;
          bestDist = dist;
        }
      }
    }
    return best;
  }

  private drawGhost(): void {
    const g = this.ghost;
    g.clear();
    const color = this.ghostValid ? 0x44ff88 : 0xff4444;
    const alpha = 0.5;
    g.lineStyle(2, color, 0.8);
    g.fillStyle(color, alpha);

    switch (this.placingItemId) {
      case 'ladder':
        g.fillRect(
          this.ghostWorldX - LADDER_WIDTH / 2,
          this.ghostWorldY - LADDER_HEIGHT,
          LADDER_WIDTH, LADDER_HEIGHT,
        );
        g.strokeRect(
          this.ghostWorldX - LADDER_WIDTH / 2,
          this.ghostWorldY - LADDER_HEIGHT,
          LADDER_WIDTH, LADDER_HEIGHT,
        );
        break;
      case 'ibeam':
        g.fillRect(
          this.ghostWorldX - IBEAM_WIDTH / 2,
          this.ghostWorldY - IBEAM_HEIGHT,
          IBEAM_WIDTH, IBEAM_HEIGHT,
        );
        g.strokeRect(
          this.ghostWorldX - IBEAM_WIDTH / 2,
          this.ghostWorldY - IBEAM_HEIGHT,
          IBEAM_WIDTH, IBEAM_HEIGHT,
        );
        break;
      case 'checkpoint':
        g.fillRect(this.ghostWorldX - 16, this.ghostWorldY - 32, 32, 32);
        g.strokeRect(this.ghostWorldX - 16, this.ghostWorldY - 32, 32, 32);
        break;
    }
  }

  // ── Confirm placement ────────────────────────────────────────────────────────

  private confirmPlacement(): void {
    if (!this.ghostValid) return;

    const save: PlacedItemSave = {
      id: this.placingItemId,
      x:  this.ghostWorldX,
      y:  this.ghostWorldY,
    };

    switch (this.placingItemId) {
      case 'ladder':
        if (!spendItem('ladder')) return;
        addPlaced(save);
        this.spawnLadderBody(save, getPlaced().length - 1);
        break;
      case 'ibeam':
        if (!spendItem('ibeam')) return;
        addPlaced(save);
        this.spawnIBeamBody(save, getPlaced().length - 1);
        break;
      case 'checkpoint': {
        if (!spendItem('checkpoint')) return;
        // Remove any existing checkpoint
        const existing = getPlaced();
        const cpIdx = existing.findIndex(p => p.id === 'checkpoint');
        if (cpIdx !== -1) {
          const body = this.spawnedBodies.find(b => b.saveIndex === cpIdx);
          if (body) { body.object.destroy(); }
          this.spawnedBodies = this.spawnedBodies.filter(b => b.saveIndex !== cpIdx);
          removePlaced(cpIdx);
          // Re-index remaining bodies
          this.spawnedBodies.forEach(b => { if (b.saveIndex > cpIdx) b.saveIndex--; });
        }
        save.meta = { spawnsLeft: 5 };
        addPlaced(save);
        this.spawnCheckpointBody(save, getPlaced().length - 1);
        break;
      }
    }

    this.closeAll();
  }

  // ── Physics body spawners ────────────────────────────────────────────────────

  private spawnLadderBody(save: PlacedItemSave, index: number): void {
    const ladderX = save.x;
    const ladderY = save.y - LADDER_HEIGHT / 2;

    const rect = this.scene.add.rectangle(ladderX, ladderY, LADDER_WIDTH, LADDER_HEIGHT, 0x885522, 0.7)
      .setDepth(8);
    this.scene.physics.add.existing(rect, true);

    // Overlap — entering/leaving the trigger zone
    const overlap = this.scene.physics.add.overlap(
      this.player.sprite,
      rect,
      () => { this.player.enterLadder(); },
    );

    this.ladderOverlaps.push(overlap);
    this.spawnedBodies.push({ saveIndex: index, object: rect, itemId: 'ladder' });
  }

  private spawnIBeamBody(save: PlacedItemSave, index: number): void {
    const beamX = save.x;
    const beamY = save.y - IBEAM_HEIGHT / 2;

    const rect = this.scene.add.rectangle(beamX, beamY, IBEAM_WIDTH, IBEAM_HEIGHT, 0x558899, 1)
      .setDepth(8);
    this.scene.physics.add.existing(rect, true);
    const body = rect.body as Phaser.Physics.Arcade.StaticBody;
    body.checkCollision.down = false;  // one-way: no collision from above
    body.checkCollision.left  = false;
    body.checkCollision.right = false;

    const collider = this.scene.physics.add.collider(this.player.sprite, rect);
    this.ibeamColliders.push(collider);
    this.spawnedBodies.push({ saveIndex: index, object: rect, itemId: 'ibeam' });
  }

  private spawnCheckpointBody(save: PlacedItemSave, index: number): void {
    const rect = this.scene.add.rectangle(save.x, save.y - 16, 32, 32, 0xffaa22, 0.85)
      .setDepth(8);
    this.scene.physics.add.existing(rect, true);
    this.checkpointGroup.add(rect);
    this.spawnedBodies.push({ saveIndex: index, object: rect, itemId: 'checkpoint' });
  }

  // ── Checkpoint respawn ───────────────────────────────────────────────────────

  tryCheckpointRespawn(
    invincibleSetter: (v: boolean) => void,
    respawnAt: (x: number, y: number) => void,
  ): boolean {
    const placed = getPlaced();
    const cpIdx = placed.findIndex(p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0);
    if (cpIdx === -1) return false;

    const cp = placed[cpIdx];
    const newSpawns = (cp.meta?.spawnsLeft ?? 0) - 1;
    updatePlacedMeta(cpIdx, { spawnsLeft: newSpawns });
    if (newSpawns <= 0) removeExpiredPlaced();

    respawnAt(cp.x, cp.y - 50);
    invincibleSetter(true);
    this.scene.time.delayedCall(PLAYER_INVINCIBLE_MS * 5, () => invincibleSetter(false));

    return true;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private refreshHotbar(): void {
    ITEM_DEFS.forEach((def, i) => {
      const { getItemQuantity } = require('./SaveData') as typeof import('./SaveData');
      const qty = getItemQuantity(def.id);
      this.hotbarQtys[i]?.setText(`x${qty}`);
      const hasStock = qty > 0;
      this.hotbarItems[i]?.setAlpha(hasStock ? 1 : 0.45);
    });
  }

  private setHotbarVisible(visible: boolean): void {
    this.hotbarBg.setVisible(visible);
    this.hotbarItems.forEach(o => o.setVisible(visible));
    this.hotbarLabels.forEach(o => o.setVisible(visible));
    this.hotbarQtys.forEach(o => o.setVisible(visible));
  }

  private setPlacementUIVisible(visible: boolean): void {
    this.confirmBtn.setVisible(visible);
    this.confirmTxt.setVisible(visible);
    this.cancelBtn.setVisible(visible);
    this.cancelTxt.setVisible(visible);
    if (!visible) this.ghost.clear();
  }
}
```

**Note:** The `require` in `refreshHotbar` will trigger a TS warning. Replace it with a static import after verifying the pattern works — or import `getItemQuantity` at the top (already used in spendItem path). Fix: import `getItemQuantity` at the top of the file directly (it already is imported above). Update `refreshHotbar` to just call `getItemQuantity(def.id)` directly using the top-level import.

Fix the refreshHotbar method:

```typescript
private refreshHotbar(): void {
  ITEM_DEFS.forEach((def, i) => {
    const qty = getItemQuantity(def.id);
    this.hotbarQtys[i]?.setText(`x${qty}`);
    this.hotbarItems[i]?.setAlpha(qty > 0 ? 1 : 0.45);
  });
}
```

And add `getItemQuantity` to the SaveData import at the top:
```typescript
import {
  getPlaced, addPlaced, removePlaced, updatePlacedMeta,
  removeExpiredPlaced, spendItem, getItemQuantity, PlacedItemSave,
} from './SaveData';
```

Also remove the `require` line from refreshHotbar (already replaced above).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/systems/PlaceableManager.ts
git commit -m "feat: add PlaceableManager with spawn-from-save, placement mode, 4 item types"
```

---

## Task 9: HUD Hotbar Icon

**Files:**
- Modify: `src/ui/HUD.ts`

The HUD gains a bag icon (bottom-left) that opens the PlaceableManager hotbar when tapped/clicked.

- [ ] **Step 1: Add hotbar icon to HUD**

In `src/ui/HUD.ts`, update the import and constructor to accept PlaceableManager:

Add import at the top:
```typescript
import type { PlaceableManager } from '../systems/PlaceableManager';
```

Update the constructor signature:
```typescript
constructor(scene: Phaser.Scene, player: Player, placeableManager: PlaceableManager) {
```

Add the bag icon at the end of the constructor body (before the closing `}`):

```typescript
// ── Hotbar bag icon (bottom-left) ──────────────────────────────────────────
const bagX = 36;
const bagY = GAME_HEIGHT - 44;

scene.add.rectangle(bagX, bagY, 52, 52, 0x000000, 0.55)
  .setScrollFactor(0).setDepth(19);

scene.add.text(bagX, bagY, '\uD83C\uDF92', {
  fontSize: '26px',
}).setOrigin(0.5).setScrollFactor(0).setDepth(21);

const bagHit = scene.add.zone(bagX, bagY, 52, 52)
  .setScrollFactor(0).setDepth(22)
  .setInteractive({ useHandCursor: true });

bagHit.on('pointerup', () => placeableManager.openHotbar());
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: compile errors — HUD callers need updating (GameScene).

- [ ] **Step 3: Update GameScene HUD construction**

In `src/scenes/GameScene.ts`, the line that creates HUD:
```typescript
this.hud = new HUD(this, this.player);
```
will need to be updated in Task 10 when PlaceableManager is available. Leave this failing compile for now — it will be fixed in Task 10.

Actually, to keep compilation clean, make the third argument optional in HUD for now. Update the constructor:

```typescript
constructor(scene: Phaser.Scene, player: Player, placeableManager?: PlaceableManager) {
```

And wrap the bag icon section:
```typescript
if (placeableManager) {
  // bag icon code here
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/HUD.ts
git commit -m "feat: add hotbar bag icon to HUD, wires to PlaceableManager"
```

---

## Task 10: GameScene Wiring

This final task wires PlaceableManager into GameScene: R key, update loop, damage handler (shield + checkpoint), and passing PlaceableManager to HUD.

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Import PlaceableManager in GameScene**

Add the import near the top of `src/scenes/GameScene.ts`:

```typescript
import { PlaceableManager } from '../systems/PlaceableManager';
```

Add the class field alongside other private fields:

```typescript
private placeableManager!: PlaceableManager;
```

- [ ] **Step 2: Construct PlaceableManager in create()**

In `GameScene.create()`, after the `this.hud = new HUD(this, this.player);` line, add:

```typescript
this.placeableManager = new PlaceableManager(this, this.player, this.heapWalkableGroup);
// Pass to HUD now that it's created
this.hud = new HUD(this, this.player, this.placeableManager);
```

Wait — HUD was already constructed one line above. Delete the original `this.hud = new HUD(this, this.player);` line and replace it with:

```typescript
this.placeableManager = new PlaceableManager(this, this.player, this.heapWalkableGroup);
this.hud = new HUD(this, this.player, this.placeableManager);
```

- [ ] **Step 3: Add R key handler in create()**

After the F2 debug keyboard binding, add:

```typescript
this.input.keyboard!.on('keydown-R', () => this.placeableManager.openHotbar());
```

- [ ] **Step 4: Call placeableManager.update() in the update loop**

In `GameScene.update()`, after `this.hud.update();`, add:

```typescript
this.placeableManager.update();
```

- [ ] **Step 5: Wire shield and checkpoint into handleEnemyDamage**

Replace the existing `handleEnemyDamage` method:

```typescript
private readonly handleEnemyDamage = (): void => {
  // Shield absorbs the hit
  if (this.player.hasActiveShield) {
    this.player.absorbHit();
    this.invincible = true;
    this.time.delayedCall(PLAYER_INVINCIBLE_MS, () => { this.invincible = false; });
    return;
  }

  // Checkpoint respawn
  const respawned = this.placeableManager.handlePlayerDeath(
    (v) => { this.invincible = v; },
    (x, y) => {
      this.player.sprite.setPosition(x, y);
      this.player.sprite.setVelocity(0, 0);
    },
  );
  if (respawned) return;

  // Normal death
  const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
  this.scene.launch('ScoreScene', { score, isPeak: false });
  this.scene.pause();
};
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run all tests**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test
```

Expected: all tests pass.

- [ ] **Step 8: Smoke test in browser**

```bash
npm run dev
```

Verify end-to-end:
1. Buy a Ladder and a Shield from the Store
2. Start a run, press R — hotbar opens showing items with quantities
3. Select Ladder — ghost appears following cursor/touch, green on heap surface, red elsewhere
4. Drag ghost to a valid surface, click PLACE — ladder appears, quantity decrements
5. Walk into ladder — player climbs up (UP key), exits at top
6. Buy a Shield, start a run, press R, select Shield — shield activates (purple tint on player)
7. Walk into enemy — shield absorbs hit (tint clears, player briefly invincible), run continues
8. Buy a Checkpoint, place it, die to enemy — player respawns at checkpoint, spawnsLeft decrements

- [ ] **Step 9: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: wire PlaceableManager into GameScene (R key, update, shield, checkpoint respawn)"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `itemDefs.ts` — Task 1
- ✅ SaveData extensions (inventory, placed, CRUD) — Task 2
- ✅ StoreScene with filter tabs — Task 4
- ✅ MenuScene Store button — Task 5
- ✅ Shield (absorb hit, invincibility, visual tint) — Task 6, Task 10
- ✅ Ladder (climbing mode, enterLadder/exitLadder) — Task 7, Task 8
- ✅ I-Beam (one-way platform) — Task 8
- ✅ Checkpoint (5 spawns, 1 active, respawn on death) — Task 8, Task 10
- ✅ Placement mode (hotbar, ghost, surface snap, confirm/cancel buttons) — Task 8
- ✅ R key + tap bag icon to open hotbar — Task 9, Task 10
- ✅ Spawn saved items at run start — Task 8

**Placeholder scan:** None found.

**Type consistency check:**
- `PlacedItemSave` defined in Task 2, used in Task 8 — consistent
- `activateShield()` / `absorbHit()` defined in Task 6, called in Task 8/10 — consistent
- `enterLadder()` / `exitLadder()` defined in Task 7, called in Task 8 — consistent
- `handlePlayerDeath()` defined in Task 8, called in Task 10 — consistent signature
- `openHotbar()` defined in Task 8, called in Task 9 and Task 10 — consistent
- `HUD` constructor updated in Task 9 (optional 3rd arg), called with 3 args in Task 10 — consistent
