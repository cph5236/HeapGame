# Mountain Climber Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-level "Mountain Climber" upgrade that raises `MAX_WALKABLE_SLOPE_DEG` so the player can walk steeper heap surfaces at higher upgrade levels.

**Architecture:** A new constant `MOUNTAIN_CLIMBER_INCREMENT` drives both the `upgradeDefs` description and `getPlayerConfig`. `HeapEdgeCollider` receives the computed threshold via its constructor and uses it during slab classification. `GameScene` passes the value from `PlayerConfig` when constructing the collider.

**Tech Stack:** TypeScript, Phaser 3.90, Vitest (node environment)

---

## File Map

| File | Change |
|------|--------|
| `src/constants.ts` | Add `MOUNTAIN_CLIMBER_INCREMENT` constant |
| `src/data/upgradeDefs.ts` | Add `mountain_climber` entry to `UPGRADE_DEFS` |
| `src/systems/SaveData.ts` | Add `maxWalkableSlopeDeg` to `PlayerConfig`; compute in `getPlayerConfig` |
| `src/systems/HeapEdgeCollider.ts` | Add `walkableSlopeDeg` constructor param; replace constant in `buildSlabs` |
| `src/scenes/GameScene.ts` | Move `edgeCollider` construction after `playerConfig`; pass `maxWalkableSlopeDeg` |
| `src/systems/__tests__/HeapEdgeCollider.test.ts` | New: verify custom threshold classifies slabs correctly |
| `src/systems/__tests__/SaveData.test.ts` | New: verify `maxWalkableSlopeDeg` computed correctly from upgrade level |

---

## Task 1: Add `MOUNTAIN_CLIMBER_INCREMENT` to constants

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add the constant after `MAX_WALKABLE_SLOPE_DEG` (line 70)**

In `src/constants.ts`, after the line:
```ts
export const MAX_WALKABLE_SLOPE_DEG  = 35;  // surfaces steeper than this are treated as walls
```
Add:
```ts
export const MOUNTAIN_CLIMBER_INCREMENT = 0; // degrees added per upgrade level — set by designer
```

- [ ] **Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add MOUNTAIN_CLIMBER_INCREMENT constant (placeholder 0)"
```

---

## Task 2: Add `mountain_climber` to upgrade definitions

**Files:**
- Modify: `src/data/upgradeDefs.ts`

- [ ] **Step 1: Add import of new constants at the top of upgradeDefs.ts**

Replace the existing first line (no imports currently) with:
```ts
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../constants';
```

- [ ] **Step 2: Append the `mountain_climber` entry to `UPGRADE_DEFS`**

At the end of the `UPGRADE_DEFS` array (after the `dive` entry, before the closing `]`), add:
```ts
  {
    id: 'mountain_climber',
    name: 'Mountain Climber',
    description: (l) => `Walk slopes up to ${MAX_WALKABLE_SLOPE_DEG + l * MOUNTAIN_CLIMBER_INCREMENT}°`,
    maxLevel: 3,        // designer: set to desired max
    cost: (l) => [0, 0, 0][l - 1], // designer: replace with actual costs
  },
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `npm run build 2>&1 | head -30`
Expected: no TS errors related to upgradeDefs.ts

- [ ] **Step 4: Commit**

```bash
git add src/data/upgradeDefs.ts
git commit -m "feat: add mountain_climber upgrade definition (costs TBD by designer)"
```

---

## Task 3: Add `maxWalkableSlopeDeg` to `PlayerConfig` and `getPlayerConfig`

**Files:**
- Modify: `src/systems/SaveData.ts`
- Create: `src/systems/__tests__/SaveData.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/SaveData.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../../constants';
import { getPlayerConfig, resetAllData } from '../SaveData';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/systems/__tests__/SaveData.test.ts 2>&1 | tail -20`
Expected: FAIL — `config.maxWalkableSlopeDeg` is `undefined`

- [ ] **Step 3: Add `maxWalkableSlopeDeg` to `PlayerConfig` interface**

In `src/systems/SaveData.ts`, add the field to the `PlayerConfig` interface (after `peakMultiplier`):
```ts
export interface PlayerConfig {
  maxAirJumps:        number;
  wallJump:           boolean;
  dash:               boolean;
  dive:               boolean;
  moneyMultiplier:    number;
  jumpBoost:          number;
  stompBonus:         number;
  peakMultiplier:     number;
  maxWalkableSlopeDeg: number;
}
```

- [ ] **Step 4: Add the import and computation to `getPlayerConfig`**

At the top of `src/systems/SaveData.ts`, update the import from `../constants`:
```ts
import { UPGRADE_DEFS } from '../data/upgradeDefs';
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../constants';
```

In `getPlayerConfig()`, add the new field to the returned object (after `peakMultiplier`):
```ts
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/systems/__tests__/SaveData.test.ts 2>&1 | tail -20`
Expected: PASS — both tests green

- [ ] **Step 6: Run full test suite to confirm no regressions**

Run: `npm test 2>&1 | tail -20`
Expected: all previously passing tests still pass

- [ ] **Step 7: Commit**

```bash
git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts
git commit -m "feat: add maxWalkableSlopeDeg to PlayerConfig, driven by mountain_climber upgrade"
```

---

## Task 4: Parameterize `HeapEdgeCollider` threshold

**Files:**
- Modify: `src/systems/HeapEdgeCollider.ts`
- Create: `src/systems/__tests__/HeapEdgeCollider.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/HeapEdgeCollider.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ScanlineRow } from '../HeapPolygon';
import { HeapEdgeCollider } from '../HeapEdgeCollider';

// Phaser StaticGroup mock — HeapEdgeCollider only calls group.create() + a few
// methods on the returned image object.
function makeMockImg() {
  return {
    setVisible:       vi.fn().mockReturnThis(),
    setDisplaySize:   vi.fn().mockReturnThis(),
    setDebugBodyColor: vi.fn().mockReturnThis(),
    refreshBody:      vi.fn(),
    body: { checkCollision: { down: true } },
  };
}

function makeMockGroup() {
  return { create: vi.fn(() => makeMockImg()) };
}

// 3 rows where the left edge has a ~45° slope (deltaX = SCAN_STEP = 4 per row).
// 45° > default 35° threshold → normally a wall body.
// 45° < 60° custom threshold → walkable body.
// Right edge is vertical (90°) in all cases → always a wall body.
const rows45deg: ScanlineRow[] = [
  { y: 0, leftX: 100, rightX: 200 },
  { y: 4, leftX: 104, rightX: 200 },
  { y: 8, leftX: 108, rightX: 200 },
];

describe('HeapEdgeCollider – walkableSlopeDeg', () => {
  it('classifies 45° left-edge slabs as walkable when threshold is 60°', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup     = makeMockGroup();

    const collider = new HeapEdgeCollider(null as any, 60);
    collider.buildFromScanlines(0, rows45deg, walkableGroup as any, wallGroup as any);

    // Left spans (45° < 60°) go to walkableGroup
    expect(walkableGroup.create).toHaveBeenCalled();
  });

  it('classifies the same 45° left-edge slabs as walls at the default 35° threshold', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup     = makeMockGroup();

    // No second argument → defaults to MAX_WALKABLE_SLOPE_DEG (35°)
    const collider = new HeapEdgeCollider(null as any);
    collider.buildFromScanlines(0, rows45deg, walkableGroup as any, wallGroup as any);

    // Both left (45°) and right (90°) exceed 35° → all slabs go to wallGroup
    expect(walkableGroup.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/systems/__tests__/HeapEdgeCollider.test.ts 2>&1 | tail -20`
Expected: FAIL — constructor signature mismatch or `walkableGroup.create` assertion failures

- [ ] **Step 3: Add `walkableSlopeDeg` to `HeapEdgeCollider`**

In `src/systems/HeapEdgeCollider.ts`:

1. Add a private field after the `bandBodies` declaration (line 31):
```ts
private readonly walkableSlopeDeg: number;
```

2. Replace the constructor (line 33):
```ts
constructor(_scene: Phaser.Scene, walkableSlopeDeg = MAX_WALKABLE_SLOPE_DEG) {
  this.walkableSlopeDeg = walkableSlopeDeg;
}
```

3. In `buildSlabs` (lines 103–104), replace both occurrences of `MAX_WALKABLE_SLOPE_DEG` with `this.walkableSlopeDeg`:
```ts
const leftIsWall  = computeRowSlopeAngleDeg(rows, i, 'left')  > this.walkableSlopeDeg;
const rightIsWall = computeRowSlopeAngleDeg(rows, i, 'right') > this.walkableSlopeDeg;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/systems/__tests__/HeapEdgeCollider.test.ts 2>&1 | tail -20`
Expected: PASS — both tests green

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `npm test 2>&1 | tail -20`
Expected: all previously passing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/systems/HeapEdgeCollider.ts src/systems/__tests__/HeapEdgeCollider.test.ts
git commit -m "feat: parameterize HeapEdgeCollider walkable slope threshold via constructor"
```

---

## Task 5: Wire `GameScene` to pass `maxWalkableSlopeDeg`

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Move `edgeCollider` construction after `playerConfig` is assigned**

In `src/scenes/GameScene.ts`, `create()` currently has:

```ts
// line 85-86 (current)
this.chunkRenderer = new HeapChunkRenderer(this);
this.edgeCollider = new HeapEdgeCollider(this);
```

And later (line 118-119):
```ts
this.playerConfig = getPlayerConfig();
this.player = new Player(this, WORLD_WIDTH * 0.0625, this.spawnY, this.playerConfig);
```

Remove the `this.edgeCollider` line from its current position (line 86) and add it immediately after `this.playerConfig = getPlayerConfig()`:

```ts
// After line 118:
this.playerConfig = getPlayerConfig();
this.edgeCollider = new HeapEdgeCollider(this, this.playerConfig.maxWalkableSlopeDeg);
this.player = new Player(this, WORLD_WIDTH * 0.0625, this.spawnY, this.playerConfig);
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `npm run build 2>&1 | head -30`
Expected: no errors

- [ ] **Step 3: Run full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: pass maxWalkableSlopeDeg from PlayerConfig to HeapEdgeCollider"
```

---

## Verification

After all tasks complete, run:

```bash
npm test 2>&1 | tail -5
```

Expected: all tests pass with no failures.

The upgrade is now wired end-to-end. The designer can set `MOUNTAIN_CLIMBER_INCREMENT` in `src/constants.ts` and the `cost`/`maxLevel` in `src/data/upgradeDefs.ts` independently.
