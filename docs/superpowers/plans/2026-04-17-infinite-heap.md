# Infinite Heap Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Infinite Heap — a survival mode with 3 parallel procedurally-generated heap columns, gap bridges, trash-can portals, ramping difficulty, and a shared leaderboard.

**Architecture:** `InfiniteGameScene` (new Phaser Scene) composes 3 `HeapGenerator` + 3 X-bounded `EnemyManager` instances plus `BridgeSpawner`, `PortalManager`, `TrashWallManager`, and `PlaceableManager`. The infinite heap is injected as a local `HeapSummary` into the catalog in `BootScene` with `isInfinite: true`; `MenuScene` routes to `InfiniteGameScene` on that flag.

**Tech Stack:** Phaser 3.90, TypeScript, Vitest, `HeapState` (seeded PRNG), `HeapSurface.findSurfaceY`, `HeapGenerator` (unchanged), existing scene lifecycle.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `src/data/infiniteDefs.ts` | Difficulty-ramp constants, `computeDifficultyFactor`, `INFINITE_HEAP_ID` |
| `src/data/bridgeDefs.ts` | `BridgeDef` type + `BRIDGE_DEF` tuning values |
| `src/data/portalDefs.ts` | `PortalDef` type + `PORTAL_DEF` tuning values |
| `src/systems/CameraController.ts` | Extracted camera setup (shared by both scenes) |
| `src/systems/InfiniteColumnGenerator.ts` | `buildColumnEntries(seed, xMin, xMax, n)` |
| `src/systems/BridgeSpawner.ts` | Bridge physics bodies across gap zones |
| `src/systems/PortalManager.ts` | Paired trash-can portal spawning + teleport |
| `src/scenes/InfiniteGameScene.ts` | Main infinite mode scene |
| `src/systems/__tests__/infiniteDefs.test.ts` | Tests for `computeDifficultyFactor` |
| `src/systems/__tests__/InfiniteColumnGenerator.test.ts` | Tests for `buildColumnEntries` |
| `src/systems/__tests__/BridgeSpawner.test.ts` | Tests for `shouldSpawnBridge` |
| `src/systems/__tests__/PortalManager.test.ts` | Tests for `pickDifferentColumn` |

### Modified files
| File | Change |
|---|---|
| `shared/heapTypes.ts` | Add `isInfinite?: boolean` to `HeapParams` |
| `src/constants.ts` | Add `INFINITE_WORLD_WIDTH`, `INFINITE_GAP_WIDTH` |
| `src/systems/EnemyManager.ts` | Add `xMin/xMax` ctor params; `setSpawnRateMult()`; extract `computeGhostFlip` |
| `src/systems/PlaceableManager.ts` | Add `surfaceChecker` + `excludeCheckpoint` ctor params; export `passesSurfaceCheck` |
| `src/scenes/GameScene.ts` | Use `CameraController.setup()` |
| `src/scenes/BootScene.ts` | Inject infinite `HeapSummary` into catalog |
| `src/scenes/HeapSelectScene.ts` | Skip `HeapClient.load` for `isInfinite` heaps |
| `src/scenes/MenuScene.ts` | Route to `InfiniteGameScene` when `isInfinite` |
| `src/main.ts` | Register `InfiniteGameScene` |

---

## Task 1: Foundation — types, constants, and defs files

**Files:**
- Modify: `shared/heapTypes.ts`
- Modify: `src/constants.ts`
- Create: `src/data/infiniteDefs.ts`
- Create: `src/data/bridgeDefs.ts`
- Create: `src/data/portalDefs.ts`
- Create: `src/systems/__tests__/infiniteDefs.test.ts`

- [ ] **Step 1: Add `isInfinite` to `HeapParams`**

In `shared/heapTypes.ts`, update `HeapParams`:

```ts
export interface HeapParams {
  name: string;
  difficulty: number;
  spawnRateMult: number;
  coinMult: number;
  scoreMult: number;
  isInfinite?: boolean;
}
```

- [ ] **Step 2: Add infinite world constants to `src/constants.ts`**

Append after the existing `WORLD_WIDTH` line:

```ts
export const INFINITE_GAP_WIDTH   = 250;
export const INFINITE_WORLD_WIDTH  = WORLD_WIDTH * 3 + INFINITE_GAP_WIDTH * 2;
```

- [ ] **Step 3: Create `src/data/infiniteDefs.ts`**

```ts
export const INFINITE_HEAP_ID = 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';

export const INFINITE_MAX_RAMP_HEIGHT  = 40_000;  // px climbed for full height difficulty
export const INFINITE_MAX_RAMP_TIME    = 600_000; // ms (10 min) for full time difficulty
export const INFINITE_HEIGHT_WEIGHT    = 0.7;
export const INFINITE_TIME_WEIGHT      = 0.3;

export const INFINITE_MIN_SPAWN_MULT   = 1.0;
export const INFINITE_MAX_SPAWN_MULT   = 3.0;

export const INFINITE_SURFACE_SNAP_THRESHOLD = 100; // px — placed item surface tolerance

/** 0 at start, approaches 1.0 as height and time increase. May exceed 1.0 if weights sum > 1. */
export function computeDifficultyFactor(heightClimbed: number, timeElapsed: number): number {
  const heightFactor = Math.min(1, Math.max(0, heightClimbed / INFINITE_MAX_RAMP_HEIGHT));
  const timeFactor   = Math.min(1, Math.max(0, timeElapsed   / INFINITE_MAX_RAMP_TIME));
  return heightFactor * INFINITE_HEIGHT_WEIGHT + timeFactor * INFINITE_TIME_WEIGHT;
}
```

- [ ] **Step 4: Create `src/data/bridgeDefs.ts`**

```ts
export interface BridgeDef {
  minBridgesPerBand: number;
  maxBridgesPerBand: number;
  bodyHeight:        number;  // px — physics body height
  snapThresholdY:    number;  // max vertical delta between left/right surface Y
}

export const BRIDGE_DEF: BridgeDef = {
  minBridgesPerBand: 1,
  maxBridgesPerBand: 2,
  bodyHeight:        12,
  snapThresholdY:    150,
};
```

- [ ] **Step 5: Create `src/data/portalDefs.ts`**

```ts
export interface PortalDef {
  bandsPerPair:     number;  // one portal pair every N bands
  minHeightDelta:   number;  // min Y difference between paired portals (px)
  maxHeightDelta:   number;  // max Y difference
  invincibilityMs:  number;  // player invincibility after teleport
  width:            number;  // portal hitbox width
  height:           number;  // portal hitbox height
}

export const PORTAL_DEF: PortalDef = {
  bandsPerPair:    3,
  minHeightDelta:  500,
  maxHeightDelta:  3_000,
  invincibilityMs: 2_000,
  width:           40,
  height:          50,
};
```

- [ ] **Step 6: Write failing tests for `computeDifficultyFactor`**

Create `src/systems/__tests__/infiniteDefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeDifficultyFactor,
  INFINITE_MAX_RAMP_HEIGHT,
  INFINITE_MAX_RAMP_TIME,
} from '../../data/infiniteDefs';

describe('computeDifficultyFactor', () => {
  it('returns 0 at start (no height, no time)', () => {
    expect(computeDifficultyFactor(0, 0)).toBe(0);
  });

  it('returns 0.7 at full height, no time', () => {
    expect(computeDifficultyFactor(INFINITE_MAX_RAMP_HEIGHT, 0)).toBeCloseTo(0.7);
  });

  it('returns 0.3 at full time, no height', () => {
    expect(computeDifficultyFactor(0, INFINITE_MAX_RAMP_TIME)).toBeCloseTo(0.3);
  });

  it('returns 1.0 at both full height and full time', () => {
    expect(computeDifficultyFactor(INFINITE_MAX_RAMP_HEIGHT, INFINITE_MAX_RAMP_TIME)).toBeCloseTo(1.0);
  });

  it('clamps at 1.0 beyond max values', () => {
    expect(computeDifficultyFactor(INFINITE_MAX_RAMP_HEIGHT * 2, INFINITE_MAX_RAMP_TIME * 2)).toBe(1.0);
  });
});
```

- [ ] **Step 7: Run tests — expect them to fail (file not found)**

```bash
cd /home/connor/Documents/Repos/HeapGame
npm run test -- src/systems/__tests__/infiniteDefs.test.ts
```

Expected: FAIL — `Cannot find module '../../data/infiniteDefs'`

- [ ] **Step 8: Run tests — expect them to pass now that files exist**

```bash
npm run test -- src/systems/__tests__/infiniteDefs.test.ts
```

Expected: 5 passed

- [ ] **Step 9: Commit**

```bash
git add shared/heapTypes.ts src/constants.ts src/data/infiniteDefs.ts src/data/bridgeDefs.ts src/data/portalDefs.ts src/systems/__tests__/infiniteDefs.test.ts
git commit -m "feat: add infinite heap types, constants, and tuning defs"
```

---

## Task 2: CameraController + GameScene update

**Files:**
- Create: `src/systems/CameraController.ts`
- Modify: `src/scenes/GameScene.ts:219-223`

- [ ] **Step 1: Create `src/systems/CameraController.ts`**

```ts
import Phaser from 'phaser';

export class CameraController {
  static setup(
    scene: Phaser.Scene,
    target: Phaser.GameObjects.Sprite,
    worldWidth: number,
    worldHeight: number,
  ): void {
    scene.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    scene.cameras.main.startFollow(target, true, 1, 0.1);
    scene.cameras.main.centerOn(target.x, target.y);
  }
}
```

- [ ] **Step 2: Update `GameScene.ts` to use CameraController**

In `src/scenes/GameScene.ts`, add import at the top:
```ts
import { CameraController } from '../systems/CameraController';
```

Replace lines 219–223 (the three camera setup lines):
```ts
// Before:
this.cameras.main.setBounds(0, 0, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);
this.cameras.main.startFollow(this.player.sprite, true, 1, 0.1);
this.cameras.main.centerOn(this.player.sprite.x, this.player.sprite.y);

// After:
CameraController.setup(this, this.player.sprite, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);
```

- [ ] **Step 3: Run existing tests to confirm no regression**

```bash
npm run test
```

Expected: all tests pass (same count as before)

- [ ] **Step 4: Commit**

```bash
git add src/systems/CameraController.ts src/scenes/GameScene.ts
git commit -m "refactor: extract CameraController from GameScene"
```

---

## Task 3: InfiniteColumnGenerator

**Files:**
- Create: `src/systems/InfiniteColumnGenerator.ts`
- Create: `src/systems/__tests__/InfiniteColumnGenerator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/systems/__tests__/InfiniteColumnGenerator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildColumnEntries } from '../InfiniteColumnGenerator';

describe('buildColumnEntries', () => {
  it('generates entries with x within [xMin, xMax]', () => {
    const entries = buildColumnEntries(42, 100, 500, 50);
    for (const e of entries) {
      expect(e.x).toBeGreaterThanOrEqual(100);
      expect(e.x).toBeLessThanOrEqual(500);
    }
  });

  it('generates the requested number of entries', () => {
    const entries = buildColumnEntries(42, 0, 960, 100);
    expect(entries.length).toBe(100);
  });

  it('is deterministic for the same seed', () => {
    const a = buildColumnEntries(42, 0, 960, 20);
    const b = buildColumnEntries(42, 0, 960, 20);
    expect(a).toEqual(b);
  });

  it('produces different entries for different seeds', () => {
    const a = buildColumnEntries(1, 0, 960, 10);
    const b = buildColumnEntries(2, 0, 960, 10);
    expect(a[0].x).not.toBe(b[0].x);
  });

  it('all entries have valid keyid (≥ 0)', () => {
    const entries = buildColumnEntries(7, 0, 960, 30);
    for (const e of entries) {
      expect(e.keyid).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test -- src/systems/__tests__/InfiniteColumnGenerator.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/systems/InfiniteColumnGenerator.ts`**

```ts
import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { HeapState } from './HeapState';
import { findSurfaceY } from './HeapSurface';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';

const OBJECT_COUNT = Object.keys(OBJECT_DEFS).length;

/**
 * Procedurally generates HeapEntry[] for one column of the infinite heap.
 * Entries are stacked using findSurfaceY so blocks sit on each other naturally.
 *
 * @param seed      - Deterministic PRNG seed (different per run per column)
 * @param xMin      - Left edge of column in world coords
 * @param xMax      - Right edge of column in world coords
 * @param numBlocks - Number of blocks to generate
 */
export function buildColumnEntries(
  seed: number,
  xMin: number,
  xMax: number,
  numBlocks: number,
): HeapEntry[] {
  const state = new HeapState(MOCK_HEAP_HEIGHT_PX, seed);
  const entries: HeapEntry[] = [];

  for (let i = 0; i < numBlocks; i++) {
    const keyid = Math.floor(state.seededRandom(i * 3) * OBJECT_COUNT);
    const def   = OBJECT_DEFS[keyid] ?? OBJECT_DEFS[0];

    const usableMin = xMin + def.width / 2;
    const usableMax = xMax - def.width / 2;
    if (usableMax <= usableMin) continue;

    const cx       = usableMin + state.seededRandom(i * 3 + 1) * (usableMax - usableMin);
    const surfaceY = findSurfaceY(cx, def.width, entries);
    const y        = surfaceY - def.height / 2;

    entries.push({ x: cx, y, keyid });
  }

  return entries;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test -- src/systems/__tests__/InfiniteColumnGenerator.test.ts
```

Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/systems/InfiniteColumnGenerator.ts src/systems/__tests__/InfiniteColumnGenerator.test.ts
git commit -m "feat: add InfiniteColumnGenerator for procedural column entries"
```

---

## Task 4: EnemyManager — X bounds and dynamic spawn rate

**Files:**
- Modify: `src/systems/EnemyManager.ts`
- Modify: `src/systems/__tests__/EnemyManager.test.ts`

- [ ] **Step 1: Export `computeGhostFlip` pure function and add tests**

Add to `src/systems/__tests__/EnemyManager.test.ts`:

```ts
import { computeGhostFlip } from '../EnemyManager';

describe('computeGhostFlip', () => {
  it('flips right when at left bound moving left', () => {
    expect(computeGhostFlip(0, -50, 50, 0, 960)).toBe(50);
  });

  it('flips left when at right bound moving right', () => {
    expect(computeGhostFlip(960, 50, 50, 0, 960)).toBe(-50);
  });

  it('preserves velocity when not at bounds', () => {
    expect(computeGhostFlip(400, -50, 50, 0, 960)).toBe(-50);
  });

  it('uses custom xMin/xMax bounds', () => {
    expect(computeGhostFlip(100, -50, 50, 100, 500)).toBe(50);
    expect(computeGhostFlip(500, 50, 50, 100, 500)).toBe(-50);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (function not exported)**

```bash
npm run test -- src/systems/__tests__/EnemyManager.test.ts
```

Expected: FAIL on the new `computeGhostFlip` tests

- [ ] **Step 3: Update `src/systems/EnemyManager.ts`**

Add after the existing `scaleSpawnChance` function:

```ts
/**
 * Returns the new velocity X for a ghost based on world X bounds.
 * Extracted for unit testing.
 */
export function computeGhostFlip(
  x: number,
  velocityX: number,
  speed: number,
  xMin: number,
  xMax: number,
): number {
  if (x <= xMin && velocityX < 0) return speed;
  if (x >= xMax && velocityX > 0) return -speed;
  return velocityX;
}
```

Update the `EnemyManager` class:

```ts
// Add private fields after _spawnRateMult:
private readonly _xMin: number;
private readonly _xMax: number;

// Update constructor signature:
constructor(scene: Phaser.Scene, spawnRateMult: number = 1.0, xMin: number = 0, xMax: number = WORLD_WIDTH) {
  this.scene = scene;
  this.group = scene.physics.add.group();
  this._spawnRateMult = spawnRateMult;
  this._xMin = xMin;
  this._xMax = xMax;
}

// Add public setter after constructor:
setSpawnRateMult(mult: number): void {
  this._spawnRateMult = mult;
}
```

In the `update()` method, replace the ghost flip logic:

```ts
// Before:
if (s.x <= 0 && body.velocity.x < 0) {
  body.setVelocityX(speed);
} else if (s.x >= WORLD_WIDTH && body.velocity.x > 0) {
  body.setVelocityX(-speed);
}

// After:
const newVx = computeGhostFlip(s.x, body.velocity.x, speed, this._xMin, this._xMax);
if (newVx !== body.velocity.x) body.setVelocityX(newVx);
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test -- src/systems/__tests__/EnemyManager.test.ts
```

Expected: all tests pass

- [ ] **Step 5: Run full test suite**

```bash
npm run test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/systems/EnemyManager.ts src/systems/__tests__/EnemyManager.test.ts
git commit -m "feat: add EnemyManager X bounds and setSpawnRateMult"
```

---

## Task 5: PlaceableManager — surface filtering and checkpoint gate

**Files:**
- Modify: `src/systems/PlaceableManager.ts`
- Create: `src/systems/__tests__/PlaceableManager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/systems/__tests__/PlaceableManager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { passesSurfaceCheck } from '../PlaceableManager';

describe('passesSurfaceCheck', () => {
  it('returns true when surface is within threshold', () => {
    expect(passesSurfaceCheck(1000, 1050, 100)).toBe(true);
  });

  it('returns false when surface is outside threshold', () => {
    expect(passesSurfaceCheck(1000, 1200, 100)).toBe(false);
  });

  it('returns true at exact threshold boundary', () => {
    expect(passesSurfaceCheck(1000, 1100, 100)).toBe(true);
  });

  it('works with savedY above surfaceY', () => {
    expect(passesSurfaceCheck(1100, 1050, 100)).toBe(true);
    expect(passesSurfaceCheck(1300, 1050, 100)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test -- src/systems/__tests__/PlaceableManager.test.ts
```

Expected: FAIL — `passesSurfaceCheck` not exported

- [ ] **Step 3: Add `passesSurfaceCheck` export to `PlaceableManager.ts`**

Add after the `PlacementState` enum:

```ts
/** Pure helper — exported for unit testing. */
export function passesSurfaceCheck(
  savedY: number,
  surfaceY: number,
  threshold: number,
): boolean {
  return Math.abs(savedY - surfaceY) <= threshold;
}
```

- [ ] **Step 4: Add `surfaceChecker` and `excludeCheckpoint` constructor params**

Update the `PlaceableManager` class fields after `_heapId`:

```ts
private readonly _surfaceChecker?: (x: number, savedY: number) => boolean;
private readonly _excludeCheckpoint: boolean;
```

Update the constructor signature:

```ts
constructor(
  scene:          Phaser.Scene,
  player:         Player,
  walkableGroup:  Phaser.Physics.Arcade.StaticGroup,
  wallGroup:      Phaser.Physics.Arcade.StaticGroup,
  heapId:         string,
  surfaceChecker?: (x: number, savedY: number) => boolean,
  excludeCheckpoint?: boolean,
) {
  this.scene              = scene;
  this.player             = player;
  this.walkableGroup      = walkableGroup;
  this.wallGroup          = wallGroup;
  this._heapId            = heapId;
  this._surfaceChecker    = surfaceChecker;
  this._excludeCheckpoint = excludeCheckpoint ?? false;

  this.checkpointGroup = scene.physics.add.staticGroup();
  this.createUI();
  this.spawnSavedItems();
}
```

- [ ] **Step 5: Update `spawnSavedItems` to filter by surface**

Replace the existing `spawnSavedItems` body:

```ts
private spawnSavedItems(): void {
  const placed = getPlaced(this._heapId);
  placed.forEach((save, index) => {
    if (this._surfaceChecker && !this._surfaceChecker(save.x, save.y)) return;
    switch (save.id) {
      case 'ladder':     this.spawnLadderBody(save, index);     break;
      case 'ibeam':      this.spawnIBeamBody(save, index);      break;
      case 'checkpoint':
        if (!this._excludeCheckpoint) this.spawnCheckpointBody(save, index);
        break;
    }
  });
}
```

- [ ] **Step 6: Gate checkpoint slot in hotbar when excluded**

In `createUI()`, after `this.hotbarItems.push(slot)` loop completes, add at the end of `createUI()`:

```ts
if (this._excludeCheckpoint) {
  const cpIdx = ITEM_DEFS.findIndex(d => d.id === 'checkpoint');
  if (cpIdx >= 0) {
    this.hotbarItems[cpIdx]?.setVisible(false).disableInteractive();
    this.hotbarLabels[cpIdx]?.setVisible(false);
    this.hotbarQtys[cpIdx]?.setVisible(false);
  }
}
```

- [ ] **Step 7: Run — expect PASS**

```bash
npm run test -- src/systems/__tests__/PlaceableManager.test.ts
```

Expected: 4 passed

- [ ] **Step 8: Run full suite**

```bash
npm run test
```

Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/systems/PlaceableManager.ts src/systems/__tests__/PlaceableManager.test.ts
git commit -m "feat: PlaceableManager surface filtering and checkpoint gate for infinite mode"
```

---

## Task 6: BridgeSpawner

**Files:**
- Create: `src/systems/BridgeSpawner.ts`
- Create: `src/systems/__tests__/BridgeSpawner.test.ts`

- [ ] **Step 1: Write failing tests for the pure bridge logic**

Create `src/systems/__tests__/BridgeSpawner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldSpawnBridge } from '../BridgeSpawner';

describe('shouldSpawnBridge', () => {
  it('returns true when surfaces match and are within band', () => {
    // Band 1000–1500, surfaces at 1200 and 1250
    expect(shouldSpawnBridge(1200, 1250, 1000, 1500, 150)).toBe(true);
  });

  it('returns false when surface Y delta exceeds snap threshold', () => {
    expect(shouldSpawnBridge(1200, 1400, 1000, 1500, 150)).toBe(false);
  });

  it('returns false when both surfaces are above the band', () => {
    expect(shouldSpawnBridge(800, 820, 1000, 1500, 150)).toBe(false);
  });

  it('returns false when both surfaces are below the band', () => {
    expect(shouldSpawnBridge(1600, 1620, 1000, 1500, 150)).toBe(false);
  });

  it('returns true at the exact band boundary', () => {
    expect(shouldSpawnBridge(1000, 1050, 1000, 1500, 150)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test -- src/systems/__tests__/BridgeSpawner.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/systems/BridgeSpawner.ts`**

```ts
import Phaser from 'phaser';
import { HeapGenerator } from './HeapGenerator';
import { findSurfaceY } from './HeapSurface';
import { CHUNK_BAND_HEIGHT } from '../constants';
import type { BridgeDef } from '../data/bridgeDefs';

/**
 * Pure predicate — exported for unit testing.
 * Returns true if the two gap surface Y values warrant a bridge in this band.
 */
export function shouldSpawnBridge(
  leftSurfaceY: number,
  rightSurfaceY: number,
  bandTopY: number,
  bandBottomY: number,
  snapThresholdY: number,
): boolean {
  if (Math.abs(leftSurfaceY - rightSurfaceY) > snapThresholdY) return false;
  const surfY = Math.min(leftSurfaceY, rightSurfaceY);
  return surfY >= bandTopY && surfY <= bandBottomY;
}

export class BridgeSpawner {
  /** Arcade static group — add collider in InfiniteGameScene */
  readonly group: Phaser.Physics.Arcade.StaticGroup;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly generators: [HeapGenerator, HeapGenerator, HeapGenerator],
    private readonly colBounds: [number, number][],
    private readonly def: BridgeDef,
  ) {
    this.group = scene.physics.add.staticGroup();
  }

  /**
   * Call from InfiniteGameScene after each band loads.
   * Tries to place bridges across each gap for this band.
   */
  onBandLoaded(bandTopY: number): void {
    const bandBottomY = bandTopY + CHUNK_BAND_HEIGHT;

    // Gap 0: between col 0 and col 1
    // Gap 1: between col 1 and col 2
    for (let gapIdx = 0; gapIdx < 2; gapIdx++) {
      const leftColIdx  = gapIdx;
      const rightColIdx = gapIdx + 1;

      const [, leftColXMax]  = this.colBounds[leftColIdx];
      const [rightColXMin]   = this.colBounds[rightColIdx];

      // Sample surface Y from the inner edges of each column
      const leftSurfY  = findSurfaceY(leftColXMax  - 20, 10, this.generators[leftColIdx].entries);
      const rightSurfY = findSurfaceY(rightColXMin + 20, 10, this.generators[rightColIdx].entries);

      const count = this.def.minBridgesPerBand +
        Math.floor(Math.random() * (this.def.maxBridgesPerBand - this.def.minBridgesPerBand + 1));

      for (let i = 0; i < count; i++) {
        if (!shouldSpawnBridge(leftSurfY, rightSurfY, bandTopY, bandBottomY, this.def.snapThresholdY)) {
          continue;
        }
        const bridgeCX = (leftColXMax + rightColXMin) / 2;
        const bridgeW  = rightColXMin - leftColXMax;
        const bridgeY  = Math.min(leftSurfY, rightSurfY);

        const body = this.group.create(bridgeCX, bridgeY, '') as Phaser.Physics.Arcade.Sprite;
        body.setVisible(false);
        (body.body as Phaser.Physics.Arcade.StaticBody).setSize(bridgeW, this.def.bodyHeight);
        body.refreshBody();
      }
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test -- src/systems/__tests__/BridgeSpawner.test.ts
```

Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/systems/BridgeSpawner.ts src/systems/__tests__/BridgeSpawner.test.ts
git commit -m "feat: add BridgeSpawner for infinite heap gap bridges"
```

---

## Task 7: PortalManager

**Files:**
- Create: `src/systems/PortalManager.ts`
- Create: `src/systems/__tests__/PortalManager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/systems/__tests__/PortalManager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickDifferentColumn } from '../PortalManager';

describe('pickDifferentColumn', () => {
  it('never returns the same index as source', () => {
    for (let source = 0; source < 3; source++) {
      for (let trial = 0; trial < 20; trial++) {
        const rng = () => trial / 20;
        const result = pickDifferentColumn(source, 3, rng);
        expect(result).not.toBe(source);
      }
    }
  });

  it('returns a value within [0, numCols)', () => {
    for (let trial = 0; trial < 20; trial++) {
      const result = pickDifferentColumn(0, 3, () => trial / 20);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(3);
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test -- src/systems/__tests__/PortalManager.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/systems/PortalManager.ts`**

```ts
import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { PortalDef } from '../data/portalDefs';

interface PortalPair {
  aX: number; aY: number;
  bX: number; bY: number;
  aRect: Phaser.GameObjects.Rectangle;
  bRect: Phaser.GameObjects.Rectangle;
}

/** Pure helper — exported for unit testing. */
export function pickDifferentColumn(
  source: number,
  numCols: number,
  rng: () => number,
): number {
  const offset = 1 + Math.floor(rng() * (numCols - 1));
  return (source + offset) % numCols;
}

export class PortalManager {
  private readonly pairs: PortalPair[] = [];
  private bandsSinceLastPair = 0;
  private teleportCooldownUntil = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
    private readonly colBounds: [number, number][],
    private readonly def: PortalDef,
    private readonly onTeleport: (invincibilityMs: number) => void,
  ) {}

  onBandLoaded(bandTopY: number): void {
    this.bandsSinceLastPair++;
    if (this.bandsSinceLastPair < this.def.bandsPerPair) return;
    this.bandsSinceLastPair = 0;
    this.spawnPair(bandTopY);
  }

  update(): void {
    if (this.scene.time.now < this.teleportCooldownUntil) return;

    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const hw = this.def.width  / 2;
    const hh = this.def.height / 2;

    for (const pair of this.pairs) {
      if (Math.abs(px - pair.aX) < hw && Math.abs(py - pair.aY) < hh) {
        this.teleport(pair.bX, pair.bY);
        return;
      }
      if (Math.abs(px - pair.bX) < hw && Math.abs(py - pair.bY) < hh) {
        this.teleport(pair.aX, pair.aY);
        return;
      }
    }
  }

  private teleport(toX: number, toY: number): void {
    this.player.sprite.setPosition(toX, toY - 30);
    (this.player.sprite.body as Phaser.Physics.Arcade.Body).reset(toX, toY - 30);
    this.onTeleport(this.def.invincibilityMs);
    this.teleportCooldownUntil = this.scene.time.now + 1_000;
  }

  private spawnPair(bandTopY: number): void {
    const numCols  = this.colBounds.length;
    const aColIdx  = Math.floor(Math.random() * numCols);
    const bColIdx  = pickDifferentColumn(aColIdx, numCols, Math.random);

    const deltaY   = this.def.minHeightDelta +
      Math.random() * (this.def.maxHeightDelta - this.def.minHeightDelta);

    const [aMin, aMax] = this.colBounds[aColIdx];
    const [bMin, bMax] = this.colBounds[bColIdx];

    const aX = (aMin + aMax) / 2;
    const aY = bandTopY;
    const bX = (bMin + bMax) / 2;
    const bY = bandTopY + deltaY;

    const aRect = this.scene.add.rectangle(aX, aY, this.def.width, this.def.height, 0x00ff88, 0.75);
    const bRect = this.scene.add.rectangle(bX, bY, this.def.width, this.def.height, 0x00ff88, 0.75);

    this.pairs.push({ aX, aY, bX, bY, aRect, bRect });
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test -- src/systems/__tests__/PortalManager.test.ts
```

Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/systems/PortalManager.ts src/systems/__tests__/PortalManager.test.ts
git commit -m "feat: add PortalManager for cross-heap trash can portals"
```

---

## Task 8: BootScene catalog injection + scene routing

**Files:**
- Modify: `src/scenes/BootScene.ts`
- Modify: `src/scenes/HeapSelectScene.ts`
- Modify: `src/scenes/MenuScene.ts`

- [ ] **Step 1: Inject infinite heap into the catalog in BootScene**

In `src/scenes/BootScene.ts`, add import:
```ts
import { INFINITE_HEAP_ID } from '../data/infiniteDefs';
import type { HeapSummary } from '../../shared/heapTypes';
```

In `create()`, after `HeapClient.list().then((summaries) => {`, insert before `this.game.registry.set('heapCatalog', summaries)`:

```ts
const infiniteEntry: HeapSummary = {
  id: INFINITE_HEAP_ID,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  params: {
    name: '∞ Infinite Heap',
    difficulty: 5.0,
    spawnRateMult: 1.0,
    coinMult: 1.0,
    scoreMult: 1.0,
    isInfinite: true,
  },
};
summaries.push(infiniteEntry);
```

- [ ] **Step 2: Skip HeapClient.load for isInfinite in HeapSelectScene**

In `src/scenes/HeapSelectScene.ts`, find the `select(heap: HeapSummary)` method and replace its body:

```ts
private select(heap: HeapSummary): void {
  setSelectedHeapId(heap.id);
  this.game.registry.set('activeHeapId', heap.id);
  this.game.registry.set('heapParams',   heap.params);

  if (heap.params.isInfinite) {
    // Infinite heap has no server polygon — skip load, go directly to menu
    this.game.registry.set('heapPolygon', []);
    finalizeLegacyPlaced(heap.id);
    this.scene.start('MenuScene');
    return;
  }

  HeapClient.load(heap.id).then((polygon) => {
    this.game.registry.set('heapPolygon', polygon);
  }).finally(() => {
    finalizeLegacyPlaced(heap.id);
    this.scene.start('MenuScene');
  });
}
```

- [ ] **Step 3: Route to InfiniteGameScene in MenuScene**

In `src/scenes/MenuScene.ts`, find line 568:
```ts
this.scene.start('GameScene', hasCheckpoint ? { useCheckpoint: true } : undefined);
```

Replace with:
```ts
if (params.isInfinite) {
  this.scene.start('InfiniteGameScene');
} else {
  this.scene.start('GameScene', hasCheckpoint ? { useCheckpoint: true } : undefined);
}
```

Ensure `params` is in scope — it is read at line 356 in MenuScene: `const params = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;`. Move this read to before the start-button handler if needed, or re-read it inline:

```ts
const activeParams = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;
if (activeParams.isInfinite) {
  this.scene.start('InfiniteGameScene');
} else {
  this.scene.start('GameScene', hasCheckpoint ? { useCheckpoint: true } : undefined);
}
```

- [ ] **Step 4: Run full test suite**

```bash
npm run test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/scenes/BootScene.ts src/scenes/HeapSelectScene.ts src/scenes/MenuScene.ts
git commit -m "feat: inject infinite heap into catalog and route to InfiniteGameScene"
```

---

## Task 9: Server seed record + main.ts registration

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Register InfiniteGameScene in main.ts**

Add import:
```ts
import { InfiniteGameScene } from './scenes/InfiniteGameScene';
```

Add to the `scene` array (before `TexturePreviewScene`):
```ts
scene: [BootScene, MenuScene, HeapSelectScene, GameScene, ScoreScene, UpgradeScene, StoreScene, InfiniteGameScene, TexturePreviewScene],
```

- [ ] **Step 2: Seed the infinite heap server record (local D1)**

Run this once to create the heap record that the leaderboard writes to:

```bash
npx wrangler d1 execute DB --local --command "INSERT OR IGNORE INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', '[]', 'infinite', '2026-01-01T00:00:00.000Z');"
npx wrangler d1 execute DB --local --command "INSERT OR IGNORE INTO heap (id, base_id, live_zone, freeze_y, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult) VALUES ('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', '[]', 0, 1, '2026-01-01T00:00:00.000Z', 'Infinite Heap', 5.0, 1.0, 1.0, 1.0);"
```

For production, run the same commands against the production D1:
```bash
npx wrangler d1 execute DB --command "INSERT OR IGNORE INTO heap_base ..."
npx wrangler d1 execute DB --command "INSERT OR IGNORE INTO heap ..."
```

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: register InfiniteGameScene in Phaser scene list"
```

---

## Task 10: InfiniteGameScene

**Files:**
- Create: `src/scenes/InfiniteGameScene.ts`

- [ ] **Step 1: Create `src/scenes/InfiniteGameScene.ts`**

```ts
import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HeapGenerator } from '../systems/HeapGenerator';
import { HeapChunkRenderer } from '../systems/HeapChunkRenderer';
import { HeapEdgeCollider } from '../systems/HeapEdgeCollider';
import { EnemyManager } from '../systems/EnemyManager';
import { TrashWallManager } from '../systems/TrashWallManager';
import { PlaceableManager } from '../systems/PlaceableManager';
import { BridgeSpawner } from '../systems/BridgeSpawner';
import { PortalManager } from '../systems/PortalManager';
import { CameraController } from '../systems/CameraController';
import { InputManager } from '../systems/InputManager';
import { HUD } from '../ui/HUD';
import { ParallaxBackground } from '../systems/ParallaxBackground';
import { buildColumnEntries } from '../systems/InfiniteColumnGenerator';
import { findSurfaceY } from '../systems/HeapSurface';
import { buildRunScore } from '../systems/buildRunScore';
import { getPlayerConfig, addBalance } from '../systems/SaveData';
import { ENEMY_DEFS } from '../data/enemyDefs';
import { BRIDGE_DEF } from '../data/bridgeDefs';
import { PORTAL_DEF } from '../data/portalDefs';
import { TRASH_WALL_DEF } from '../data/trashWallDef';
import {
  INFINITE_HEAP_ID,
  INFINITE_SURFACE_SNAP_THRESHOLD,
  INFINITE_MIN_SPAWN_MULT,
  INFINITE_MAX_SPAWN_MULT,
  computeDifficultyFactor,
} from '../data/infiniteDefs';
import {
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  GEN_LOOKAHEAD,
  INFINITE_WORLD_WIDTH,
  INFINITE_GAP_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_JUMP_VELOCITY,
  PLAYER_INVINCIBLE_MS,
} from '../constants';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import type { EnemyKind } from '../entities/Enemy';

const BLOCKS_PER_COLUMN = 300;

function makeColBounds(): [number, number][] {
  return [
    [0,                                     WORLD_WIDTH],
    [WORLD_WIDTH + INFINITE_GAP_WIDTH,      WORLD_WIDTH * 2 + INFINITE_GAP_WIDTH],
    [WORLD_WIDTH * 2 + INFINITE_GAP_WIDTH * 2, INFINITE_WORLD_WIDTH],
  ];
}

export class InfiniteGameScene extends Phaser.Scene {
  private player!: Player;
  private hud!: HUD;
  private im!: InputManager;
  private scoreText!: Phaser.GameObjects.Text;

  private walkableGroups: Phaser.Physics.Arcade.StaticGroup[] = [];
  private wallGroups:     Phaser.Physics.Arcade.StaticGroup[] = [];
  private generators:     HeapGenerator[]  = [];
  private enemyManagers:  EnemyManager[]   = [];
  private trashWallManager!: TrashWallManager;
  private placeableManager!: PlaceableManager;
  private bridgeSpawner!:    BridgeSpawner;
  private portalManager!:    PortalManager;

  private spawnY:        number  = 0;
  private invincible:    boolean = false;
  private _runStartTime: number | null = null;
  private _runKills:     Partial<Record<EnemyKind, number>> = {};
  private colBounds:     [number, number][] = [];
  private playerConfig!: ReturnType<typeof getPlayerConfig>;

  constructor() { super({ key: 'InfiniteGameScene' }); }

  create(): void {
    this._runKills     = {};
    this._runStartTime = null;
    this.invincible    = false;
    this.generators    = [];
    this.enemyManagers = [];
    this.walkableGroups = [];
    this.wallGroups     = [];

    this.physics.world.setBounds(0, 0, INFINITE_WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);
    this.colBounds    = makeColBounds();
    this.playerConfig = getPlayerConfig();

    // ── 3 heap columns ───────────────────────────────────────────────────────
    for (let i = 0; i < 3; i++) {
      const seed    = Math.floor(Math.random() * 1_000_000);
      const [xMin, xMax] = this.colBounds[i];
      const walkable = this.physics.add.staticGroup();
      const wall     = this.physics.add.staticGroup();
      const renderer = new HeapChunkRenderer(this);
      const edge     = new HeapEdgeCollider(this, this.playerConfig.maxWalkableSlopeDeg);
      const entries  = buildColumnEntries(seed, xMin, xMax, BLOCKS_PER_COLUMN);
      const gen      = new HeapGenerator(this, walkable, wall, entries, renderer, edge);

      const em = new EnemyManager(this, 1.0, xMin, xMax);

      gen.onPlatformSpawned = (entry, platformTopY) => {
        em.onPlatformSpawned(entry.x, platformTopY, false, entry);
      };

      const colIdx = i;
      gen.onBandLoaded = (bandTopY, vertices) => {
        em.onBandLoaded(bandTopY, vertices);
        if (colIdx === 0) {
          this.bridgeSpawner?.onBandLoaded(bandTopY);
          this.portalManager?.onBandLoaded(bandTopY);
        }
      };

      this.walkableGroups.push(walkable);
      this.wallGroups.push(wall);
      this.generators.push(gen);
      this.enemyManagers.push(em);
    }

    // ── Player (center column) ────────────────────────────────────────────────
    const [cMin, cMax] = this.colBounds[1];
    const centerX = (cMin + cMax) / 2;
    this.spawnY   = MOCK_HEAP_HEIGHT_PX - PLAYER_HEIGHT / 2 - 1;
    this.player   = new Player(this, centerX, this.spawnY, this.playerConfig);

    // ── Colliders ─────────────────────────────────────────────────────────────
    type AP = Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;
    for (let i = 0; i < 3; i++) {
      this.physics.add.collider(this.player.sprite, this.walkableGroups[i]);
      this.physics.add.collider(
        this.player.sprite, this.wallGroups[i],
        this.onHeapWallCollide as unknown as AP, undefined, this,
      );
    }

    // ── Bridge spawner ────────────────────────────────────────────────────────
    this.bridgeSpawner = new BridgeSpawner(
      this,
      this.generators as [HeapGenerator, HeapGenerator, HeapGenerator],
      this.colBounds,
      BRIDGE_DEF,
    );
    this.physics.add.collider(this.player.sprite, this.bridgeSpawner.group);

    // ── Portal manager ────────────────────────────────────────────────────────
    this.portalManager = new PortalManager(
      this, this.player, this.colBounds, PORTAL_DEF,
      (ms) => {
        this.invincible = true;
        this.time.delayedCall(ms, () => { this.invincible = false; });
      },
    );

    // ── Trash wall ────────────────────────────────────────────────────────────
    this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
      this.handleDeath();
    });
    this.trashWallManager.spawn(this.player.sprite.y);

    // ── Placeable manager ─────────────────────────────────────────────────────
    this.placeableManager = new PlaceableManager(
      this, this.player, this.walkableGroups[0], this.wallGroups[0],
      INFINITE_HEAP_ID,
      (x, savedY) => {
        for (const gen of this.generators) {
          const surfY = findSurfaceY(x, 10, gen.entries);
          if (Math.abs(surfY - savedY) <= INFINITE_SURFACE_SNAP_THRESHOLD) return true;
        }
        return false;
      },
      true, // excludeCheckpoint
    );

    // ── Enemy overlaps ────────────────────────────────────────────────────────
    for (const em of this.enemyManagers) {
      this.physics.add.overlap(
        this.player.sprite, em.group,
        this.handleStomp as unknown as AP,
        this.isStomping as unknown as AP,
        this,
      );
      this.physics.add.overlap(
        this.player.sprite, em.group,
        this.handleEnemyDamage as unknown as AP,
        this.isDamaging as unknown as AP,
        this,
      );
    }

    // ── Camera ────────────────────────────────────────────────────────────────
    CameraController.setup(this, this.player.sprite, INFINITE_WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);

    // ── HUD / score text ──────────────────────────────────────────────────────
    this.hud = new HUD(this, this.player, this.placeableManager);
    this.scoreText = this.add.text(8, 8, '0 ft', {
      fontSize: '18px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(20);

    this.im = InputManager.getInstance();
    this.input.keyboard!.on('keydown-R', () => this.placeableManager.openHotbar());

    // ── Background ────────────────────────────────────────────────────────────
    new ParallaxBackground(this);

    // ── Initial generation (sync so collision is ready frame 1) ──────────────
    for (const gen of this.generators) {
      gen.generateUpToSync(this.spawnY - GEN_LOOKAHEAD);
    }
  }

  update(_time: number, delta: number): void {
    const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    if (score > 0 && this._runStartTime === null) {
      this._runStartTime = this.time.now;
    }
    this.scoreText.setText(`${Math.floor(score / 100)} ft`);

    // ── World wrap ────────────────────────────────────────────────────────────
    if (this.player.sprite.x < 0) {
      this.player.sprite.setX(INFINITE_WORLD_WIDTH - 1);
      (this.player.sprite.body as Phaser.Physics.Arcade.Body).reset(
        INFINITE_WORLD_WIDTH - 1, this.player.sprite.y,
      );
    } else if (this.player.sprite.x > INFINITE_WORLD_WIDTH) {
      this.player.sprite.setX(1);
      (this.player.sprite.body as Phaser.Physics.Arcade.Body).reset(1, this.player.sprite.y);
    }

    // ── Player + input ────────────────────────────────────────────────────────
    this.im.update?.();
    this.player.update(this.im);
    this.placeableManager.update();
    this.hud.update();

    // ── Heap generation ───────────────────────────────────────────────────────
    const cam    = this.cameras.main;
    const camTop = cam.worldView.top;
    const camBot = cam.worldView.bottom;

    for (const gen of this.generators) {
      gen.generateUpTo(camTop - GEN_LOOKAHEAD);
      gen.flushWorkerResults();
    }

    // ── Difficulty ramp ───────────────────────────────────────────────────────
    const elapsed = this._runStartTime !== null ? this.time.now - this._runStartTime : 0;
    const factor  = computeDifficultyFactor(score, elapsed);
    const spawnMult = INFINITE_MIN_SPAWN_MULT +
      factor * (INFINITE_MAX_SPAWN_MULT - INFINITE_MIN_SPAWN_MULT);

    for (const em of this.enemyManagers) {
      em.setSpawnRateMult(spawnMult);
      em.update(camTop, camBot);
    }

    this.trashWallManager.update(this.player.sprite.y, delta);
    this.portalManager.update();
  }

  // ── Death ──────────────────────────────────────────────────────────────────

  private handleDeath(): void {
    if (!this.scene.isActive()) return;
    this.player.freeze();
    const score      = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    const elapsedMs  = this._runStartTime !== null ? this.time.now - this._runStartTime : 0;
    const runResult  = buildRunScore(
      { baseHeightPx: score, kills: this._runKills, elapsedMs },
      ENEMY_DEFS,
      true,
      1.0,
    );
    this.time.delayedCall(800, () => {
      this.scene.launch('ScoreScene', {
        score:               runResult.finalScore,
        heapId:              INFINITE_HEAP_ID,
        isPeak:              false,
        checkpointAvailable: false,
        isFailure:           true,
        baseHeightPx:        score,
        kills:               this._runKills,
        elapsedMs,
        heapParams:          {
          ...DEFAULT_HEAP_PARAMS,
          name: '∞ Infinite Heap',
          difficulty: 5.0,
          isInfinite: true,
        },
      });
      this.scene.pause();
    });
  }

  // ── Enemy callbacks (same pattern as GameScene) ────────────────────────────

  private readonly isStomping = (
    player: Phaser.GameObjects.GameObject,
    enemy:  Phaser.GameObjects.GameObject,
  ): boolean => {
    const p = player as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    const e = enemy  as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    return p.body.velocity.y > 0 && p.body.center.y < e.body.center.y;
  };

  private readonly isDamaging = (
    player: Phaser.GameObjects.GameObject,
    enemy:  Phaser.GameObjects.GameObject,
  ): boolean => !this.invincible && !this.isStomping(player, enemy);

  private readonly handleStomp = (
    _player: Phaser.GameObjects.GameObject,
    enemy:   Phaser.GameObjects.GameObject,
  ): void => {
    const e    = enemy as Phaser.Physics.Arcade.Sprite;
    const kind = e.getData('kind') as EnemyKind;
    e.destroy();

    this._runKills[kind] = (this._runKills[kind] ?? 0) + 1;
    this.player.refundAirJump();
    this.player.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);

    const reward = this.playerConfig.stompBonus;
    addBalance(reward);
    const marker = this.add.text(e.x, e.y - 16, `+${reward}`, {
      fontSize: '22px', color: '#ffdd44', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({
      targets: marker, y: e.y - 80, alpha: 0,
      duration: 2000, ease: 'Cubic.Out',
      onComplete: () => marker.destroy(),
    });

    this.invincible = true;
    this.time.delayedCall(PLAYER_INVINCIBLE_MS, () => { this.invincible = false; });
  };

  private readonly handleEnemyDamage = (): void => {
    if (this.player.hasActiveShield) {
      this.player.absorbHit();
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }
    this.handleDeath();
  };

  private readonly onHeapWallCollide = (
    playerObj: Phaser.GameObjects.GameObject,
  ): void => {
    const body = (playerObj as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody).body;
    if (body.blocked.down) this.player.inSlopeZone = true;
  };
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Fix any type mismatches before continuing.

- [ ] **Step 3: Run full test suite**

```bash
npm run test
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat: add InfiniteGameScene — 3-column infinite survival mode"
```

---

## Task 11: Smoke test

This task is manual — no automated tests for Phaser scene integration.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify infinite heap appears in HeapSelectScene**

1. Open `http://localhost:3000`
2. Navigate to Select Heap
3. Confirm "∞ Infinite Heap" row appears (difficulty 5 stars, sorted last)
4. Select it — should return to MenuScene with heap name shown

- [ ] **Step 3: Verify InfiniteGameScene loads**

1. From MenuScene press START RUN
2. Confirm game launches without errors in browser console
3. Confirm 3 heap columns are visible with gaps between them
4. Confirm player spawns in the center column

- [ ] **Step 4: Verify core gameplay**

1. Climb upward — confirm heap generates ahead of the player in all 3 columns
2. Walk off right edge — confirm player wraps to left edge of left column
3. Find a bridge over a gap — confirm player can stand on it
4. Find a trash can portal — confirm teleport works
5. Let the trash wall catch the player — confirm ScoreScene appears with failure state
6. Confirm leaderboard loads (requires local D1 seeded in Task 9)

- [ ] **Step 5: Verify difficulty ramps**

1. Use browser DevTools to override `INFINITE_MAX_RAMP_HEIGHT = 500` in `infiniteDefs.ts`, then re-run
2. Climb 500px — confirm enemy spawn rate is noticeably higher
3. Revert the override

- [ ] **Step 6: Final commit if any fixes were made during smoke test**

```bash
git add -p  # stage only intentional changes
git commit -m "fix: smoke test corrections for InfiniteGameScene"
```

---

## Self-Review Checklist

Verifying all spec sections are covered:

| Spec section | Task(s) |
|---|---|
| 1. World layout (3 cols, wrap, dimensions) | Task 1 (constants), Task 10 (world bounds + wrap) |
| 2. Heap generation (3 generators, seeded) | Task 3 (buildColumnEntries), Task 10 |
| 3. Scene architecture (all systems) | Task 10 |
| 4. Entry point / GUID / isInfinite routing | Task 1 (GUID), Task 8, Task 9 |
| 5. Bridges (BridgeSpawner, bridgeDefs) | Task 1, Task 6 |
| 6. Portals (PortalManager, portalDefs) | Task 1, Task 7 |
| 7. Difficulty ramp (computeDifficultyFactor) | Task 1, Task 10 |
| 8. Placed items (surface filter, no checkpoint) | Task 5 |
| 9. Win/loss + score | Task 10 (handleDeath) |
| 10/11. New/modified files | All tasks |
