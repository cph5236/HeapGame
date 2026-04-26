# Portal System Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the portal system to spawn trashcan-sprite portals on eligible heap surfaces using a Y-interval trigger, with recycle-item particle effects and a surface-query callback for geometry decoupling.

**Architecture:** `PortalManager` receives a `findEligibleSurface` callback from `InfiniteGameScene` which queries `LayerGenerator.rowsForBand()` and enforces clearance — keeping `PortalManager` free of heap geometry knowledge. Spawning is player-Y driven (replacing the rigid band counter). Each portal pair consists of two `Phaser.GameObjects.Image` sprites at 45° with particle emitters (suction on entrance, ejection on exit).

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/data/portalDefs.ts` | Modify | Replace old fields with Y-interval config + sprite fields |
| `src/constants.ts` | Modify | Add `RECYCLE_ITEM_COUNT = 16` |
| `src/data/portalRecycleUrls.ts` | Create | Vite `?url` imports for all 16 recycle item PNGs |
| `src/scenes/BootScene.ts` | Modify | Load portal sprite + 16 recycle item textures |
| `src/systems/__tests__/PortalManager.test.ts` | Modify | Replace `pickDifferentColumn` tests; add tests for `findPortalSurface` + `randBetween` |
| `src/systems/PortalManager.ts` | Rewrite | Y-driven spawning, surface callback, sprites, particles, culling |
| `src/scenes/InfiniteGameScene.ts` | Modify | Remove `onBandLoaded` portal hook; pass `findEligibleSurface` callback |

---

### Task 1: Update `PortalDef` + `RECYCLE_ITEM_COUNT`

**Files:**
- Modify: `src/data/portalDefs.ts`
- Modify: `src/constants.ts`

- [ ] **Step 1: Replace `portalDefs.ts`**

```typescript
// src/data/portalDefs.ts
import portalUrl from '../sprites/Portal/Trashcan-portal.jpg?url';

export interface PortalDef {
  spawnPortalEveryY:  [number, number];  // [min, max] px of climb between entrance spawns
  portalRange:        [number, number];  // [min, max] px above entrance to place exit
  invincibilityMs:    number;
  width:              number;
  height:             number;
  clearanceRequired:  number;            // px of clear air above surface point
  spriteKey:          string;            // Phaser texture key
  spritePath:         string;            // Vite-resolved asset URL, loaded in BootScene
}

export const PORTAL_DEF: PortalDef = {
  spawnPortalEveryY:  [200, 400],
  portalRange:        [300, 500],
  invincibilityMs:    2_000,
  width:              40,
  height:             50,
  clearanceRequired:  72,               // PLAYER_HEIGHT (46) * 1.5 ≈ 69, rounded to 72
  spriteKey:          'portal-trashcan',
  spritePath:         portalUrl,
};
```

- [ ] **Step 2: Add `RECYCLE_ITEM_COUNT` to `constants.ts`**

Open `src/constants.ts` and add after the existing enemy constants (around line 72):

```typescript
export const RECYCLE_ITEM_COUNT = 16;
```

- [ ] **Step 3: Commit**

```bash
git add src/data/portalDefs.ts src/constants.ts
git commit -m "feat: update PortalDef with Y-interval spawn config and sprite fields"
```

---

### Task 2: Create `portalRecycleUrls.ts`

**Files:**
- Create: `src/data/portalRecycleUrls.ts`

- [ ] **Step 1: Create the URL import file**

```typescript
// src/data/portalRecycleUrls.ts
import r00 from '../sprites/Heap_sprites/recycle_items/recycle_items_00.png?url';
import r01 from '../sprites/Heap_sprites/recycle_items/recycle_items_01.png?url';
import r02 from '../sprites/Heap_sprites/recycle_items/recycle_items_02.png?url';
import r03 from '../sprites/Heap_sprites/recycle_items/recycle_items_03.png?url';
import r04 from '../sprites/Heap_sprites/recycle_items/recycle_items_04.png?url';
import r05 from '../sprites/Heap_sprites/recycle_items/recycle_items_05.png?url';
import r06 from '../sprites/Heap_sprites/recycle_items/recycle_items_06.png?url';
import r07 from '../sprites/Heap_sprites/recycle_items/recycle_items_07.png?url';
import r08 from '../sprites/Heap_sprites/recycle_items/recycle_items_08.png?url';
import r09 from '../sprites/Heap_sprites/recycle_items/recycle_items_09.png?url';
import r10 from '../sprites/Heap_sprites/recycle_items/recycle_items_10.png?url';
import r11 from '../sprites/Heap_sprites/recycle_items/recycle_items_11.png?url';
import r12 from '../sprites/Heap_sprites/recycle_items/recycle_items_12.png?url';
import r13 from '../sprites/Heap_sprites/recycle_items/recycle_items_13.png?url';
import r14 from '../sprites/Heap_sprites/recycle_items/recycle_items_14.png?url';
import r15 from '../sprites/Heap_sprites/recycle_items/recycle_items_15.png?url';

/** Vite-resolved URLs for all recycle item sprites, indexed 0–15. */
export const RECYCLE_ITEM_URLS: string[] = [
  r00, r01, r02, r03, r04, r05, r06, r07,
  r08, r09, r10, r11, r12, r13, r14, r15,
];
```

- [ ] **Step 2: Commit**

```bash
git add src/data/portalRecycleUrls.ts
git commit -m "feat: add portalRecycleUrls with Vite-resolved recycle item URLs"
```

---

### Task 3: Load portal assets in `BootScene`

**Files:**
- Modify: `src/scenes/BootScene.ts`

- [ ] **Step 1: Add imports at the top of `BootScene.ts`**

After the existing imports, add:

```typescript
import { PORTAL_DEF } from '../data/portalDefs';
import { RECYCLE_ITEM_URLS } from '../data/portalRecycleUrls';
import { RECYCLE_ITEM_COUNT } from '../constants';
```

- [ ] **Step 2: Add load calls inside `preload()`**

After the existing `this.load.spritesheet('rat', ...)` call, add:

```typescript
    this.load.image(PORTAL_DEF.spriteKey, PORTAL_DEF.spritePath);
    for (let i = 0; i < RECYCLE_ITEM_COUNT; i++) {
      this.load.image(`recycle-item-${i}`, RECYCLE_ITEM_URLS[i]);
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/scenes/BootScene.ts
git commit -m "feat: load portal sprite and recycle item textures in BootScene"
```

---

### Task 4: Write failing tests for `findPortalSurface` and `randBetween`

**Files:**
- Modify: `src/systems/__tests__/PortalManager.test.ts`

- [ ] **Step 1: Replace the test file contents**

```typescript
import { describe, it, expect } from 'vitest';
import { findPortalSurface, randBetween } from '../PortalManager';
import type { ScanlineRow } from '../HeapPolygon';

// rows ordered top→bottom (ascending Y, as LayerGenerator produces them)
const surfaceRows: ScanlineRow[] = [
  { y: 100, leftX: 50, rightX: 200 },
  { y: 104, leftX: 50, rightX: 200 },
  { y: 108, leftX: 50, rightX: 200 },
  { y: 112, leftX: 50, rightX: 200 },
];

describe('findPortalSurface', () => {
  it('returns the topmost row Y when x is on heap and clearance is free', () => {
    expect(findPortalSurface(surfaceRows, 125, 10)).toBe(100);
  });

  it('returns null when x is outside all rows', () => {
    expect(findPortalSurface(surfaceRows, 25, 10)).toBeNull();
  });

  it('returns null when a row in the clearance zone contains x', () => {
    const rowsWithObstruction: ScanlineRow[] = [
      { y: 50,  leftX: 50, rightX: 200 }, // inside clearance zone: 100 - 60 = 40 < 50 < 100
      { y: 100, leftX: 50, rightX: 200 }, // surface
    ];
    // clearanceRequired=60 → clearTop=40; y=50 is in (40, 100) and contains x=125 → blocked
    expect(findPortalSurface(rowsWithObstruction, 125, 60)).toBeNull();
  });

  it('returns surface Y when clearance zone rows do not contain x', () => {
    const rowsNarrowObstruction: ScanlineRow[] = [
      { y: 50,  leftX: 50, rightX: 100 }, // contains x=125? no (125 > 100) → not an obstruction
      { y: 100, leftX: 50, rightX: 200 }, // surface contains x=125
    ];
    expect(findPortalSurface(rowsNarrowObstruction, 125, 60)).toBe(100);
  });

  it('returns null when x is exactly on clearance boundary row', () => {
    const rows: ScanlineRow[] = [
      { y: 41,  leftX: 50, rightX: 200 }, // y=41 > clearTop(40), < surface(100) → obstruction
      { y: 100, leftX: 50, rightX: 200 },
    ];
    expect(findPortalSurface(rows, 125, 60)).toBeNull();
  });
});

describe('randBetween', () => {
  it('returns min when rng returns 0', () => {
    expect(randBetween([200, 400], () => 0)).toBe(200);
  });

  it('returns max when rng returns 1', () => {
    expect(randBetween([200, 400], () => 1)).toBe(400);
  });

  it('returns midpoint when rng returns 0.5', () => {
    expect(randBetween([200, 400], () => 0.5)).toBe(300);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- --reporter=verbose src/systems/__tests__/PortalManager.test.ts
```

Expected: FAIL — `findPortalSurface` and `randBetween` are not yet exported from `PortalManager.ts`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/systems/__tests__/PortalManager.test.ts
git commit -m "test: add findPortalSurface + randBetween tests (failing)"
```

---

### Task 5: Implement `findPortalSurface` and `randBetween`

**Files:**
- Modify: `src/systems/PortalManager.ts` (pure function exports only — class rewrite comes in Task 6)

- [ ] **Step 1: Add the two exported pure functions at the top of `PortalManager.ts`**

Replace the existing `pickDifferentColumn` export with the two new functions. Keep everything else in the file intact for now — just swap out the exported helpers:

```typescript
import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { PortalDef } from '../data/portalDefs';
import type { ScanlineRow } from './HeapPolygon';

/**
 * Scans `rows` (ordered top→bottom, ascending Y) to find the topmost row
 * containing `x`, then verifies `clearanceRequired` px of clear air above it.
 * Returns the surface Y, or null if no surface or clearance is blocked.
 */
export function findPortalSurface(
  rows: ScanlineRow[],
  x: number,
  clearanceRequired: number,
): number | null {
  const surfaceRow = rows.find(r => x >= r.leftX && x <= r.rightX);
  if (!surfaceRow) return null;
  const clearTop = surfaceRow.y - clearanceRequired;
  const hasObstruction = rows.some(
    r => r.y > clearTop && r.y < surfaceRow.y && x >= r.leftX && x <= r.rightX,
  );
  return hasObstruction ? null : surfaceRow.y;
}

/** Returns a random number in [range[0], range[1]]. Injectable rng for testing. */
export function randBetween(range: [number, number], rng: () => number = Math.random): number {
  return range[0] + rng() * (range[1] - range[0]);
}
```

Leave the rest of the existing file (the `PortalPair` interface, `pickDifferentColumn`, and `PortalManager` class) below these new exports for now — they will be replaced in Task 6.

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose src/systems/__tests__/PortalManager.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/systems/PortalManager.ts
git commit -m "feat: export findPortalSurface + randBetween from PortalManager"
```

---

### Task 6: Rewrite `PortalManager` class

**Files:**
- Modify: `src/systems/PortalManager.ts`

- [ ] **Step 1: Replace the full file content**

Keep the two exported pure functions from Task 5 at the top, then replace everything else with the new class:

```typescript
import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { PortalDef } from '../data/portalDefs';
import type { ScanlineRow } from './HeapPolygon';
import { RECYCLE_ITEM_COUNT } from '../constants';

/**
 * Scans `rows` (ordered top→bottom, ascending Y) to find the topmost row
 * containing `x`, then verifies `clearanceRequired` px of clear air above it.
 * Returns the surface Y, or null if no surface or clearance is blocked.
 */
export function findPortalSurface(
  rows: ScanlineRow[],
  x: number,
  clearanceRequired: number,
): number | null {
  const surfaceRow = rows.find(r => x >= r.leftX && x <= r.rightX);
  if (!surfaceRow) return null;
  const clearTop = surfaceRow.y - clearanceRequired;
  const hasObstruction = rows.some(
    r => r.y > clearTop && r.y < surfaceRow.y && x >= r.leftX && x <= r.rightX,
  );
  return hasObstruction ? null : surfaceRow.y;
}

/** Returns a random number in [range[0], range[1]]. Injectable rng for testing. */
export function randBetween(range: [number, number], rng: () => number = Math.random): number {
  return range[0] + rng() * (range[1] - range[0]);
}

interface PortalPair {
  aX: number; aY: number;
  bX: number; bY: number;
  aSprite:  Phaser.GameObjects.Image;
  bSprite:  Phaser.GameObjects.Image;
  aEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  bEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
}

export class PortalManager {
  private readonly pairs: PortalPair[] = [];
  private nextPortalY: number;
  private teleportCooldownUntil = 0;
  private readonly textureKeys: string[];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
    private readonly colBounds: [number, number][],
    private readonly def: PortalDef,
    private readonly onTeleport: (invincibilityMs: number) => void,
    private readonly findEligibleSurface: (colIdx: number, x: number, nearY: number) => number | null,
  ) {
    this.nextPortalY  = player.sprite.y - randBetween(def.spawnPortalEveryY);
    this.textureKeys  = Array.from({ length: RECYCLE_ITEM_COUNT }, (_, i) => `recycle-item-${i}`);
  }

  update(): void {
    const camBottom   = this.scene.cameras.main.worldView.bottom;
    const screenHeight = this.scene.scale.height;

    // Cull pairs where even the exit portal (smaller Y = higher up) is off-screen
    for (let i = this.pairs.length - 1; i >= 0; i--) {
      const p = this.pairs[i];
      // exit is always above entrance so min(aY,bY) = bY; cull when both are below camera
      if (Math.min(p.aY, p.bY) > camBottom + screenHeight) {
        p.aSprite.destroy(); p.bSprite.destroy();
        p.aEmitter.destroy(); p.bEmitter.destroy();
        this.pairs.splice(i, 1);
      }
    }

    // Spawn trigger — fires once per Y interval as player climbs
    if (this.player.sprite.y <= this.nextPortalY) {
      this.attemptSpawnPair(this.nextPortalY);
      this.nextPortalY -= randBetween(this.def.spawnPortalEveryY);
    }

    // Teleport overlap check
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

  private attemptSpawnPair(entranceY: number): void {
    // Entrance — random column + X
    const aColIdx   = Math.floor(Math.random() * this.colBounds.length);
    const [aMin, aMax] = this.colBounds[aColIdx];
    const aX        = aMin + Math.random() * (aMax - aMin);
    const aSurfaceY = this.findEligibleSurface(aColIdx, aX, entranceY);
    if (aSurfaceY === null) return;

    // Exit — random column + X, portalRange px above entrance surface
    const exitNearY = aSurfaceY - randBetween(this.def.portalRange);
    const bColIdx   = Math.floor(Math.random() * this.colBounds.length);
    const [bMin, bMax] = this.colBounds[bColIdx];
    const bX        = bMin + Math.random() * (bMax - bMin);
    const bSurfaceY = this.findEligibleSurface(bColIdx, bX, exitNearY);
    if (bSurfaceY === null) return;

    this.createPair(aX, aSurfaceY, bX, bSurfaceY);
  }

  private createPair(aX: number, aY: number, bX: number, bY: number): void {
    const aSprite  = this.createPortalSprite(aX, aY);
    const bSprite  = this.createPortalSprite(bX, bY);
    const aEmitter = this.createSuctionEmitter(aX, aY);
    const bEmitter = this.createEjectionEmitter(bX, bY);
    this.pairs.push({ aX, aY, bX, bY, aSprite, bSprite, aEmitter, bEmitter });
  }

  private createPortalSprite(x: number, y: number): Phaser.GameObjects.Image {
    return this.scene.add.image(x, y, this.def.spriteKey)
      .setDisplaySize(this.def.width, this.def.height)
      .setAngle(45)
      .setOrigin(0.5, 1.0)
      .setDepth(10);
  }

  // Entrance: particles spawn in radius and move toward portal center (suction)
  private createSuctionEmitter(x: number, y: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.scene.add.particles(x, y, this.textureKeys, {
      x:       { min: -60, max: 60 },
      y:       { min: -60, max: 60 },
      moveToX: x,
      moveToY: y,
      scale:   { start: 0.25, end: 0 },
      lifespan: 1200,
      quantity: 1,
      frequency: 200,
    }).setDepth(11);
  }

  // Exit: particles shoot outward at 315° (up-right, matching 45° trashcan rotation)
  private createEjectionEmitter(x: number, y: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.scene.add.particles(x, y, this.textureKeys, {
      speed:    { min: 80, max: 160 },
      angle:    { min: 295, max: 335 },
      scale:    { start: 0.25, end: 0 },
      alpha:    { start: 1,    end: 0 },
      lifespan: 800,
      gravityY: 200,
      quantity: 3,
      frequency: 500,
    }).setDepth(11);
  }
}
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

```bash
npm test
```

Expected: same pass count as before (only PortalManager tests exist for this system).

- [ ] **Step 3: Commit**

```bash
git add src/systems/PortalManager.ts
git commit -m "feat: rewrite PortalManager with Y-driven spawning, sprites, particles, culling"
```

---

### Task 7: Wire `InfiniteGameScene`

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts`

- [ ] **Step 1: Add `findPortalSurface` to the import from `PortalManager`**

Find the existing import:
```typescript
import { PortalManager } from '../systems/PortalManager';
```

Replace with:
```typescript
import { PortalManager, findPortalSurface } from '../systems/PortalManager';
```

- [ ] **Step 2: Remove the `onBandLoaded` portal hook from col 0's generator callback**

Find this block in `create()` (around line 129):
```typescript
      if (colIdx === 0) {
        this.bridgeSpawner?.onBandLoaded(bandTopY);
        this.portalManager?.onBandLoaded(bandTopY);
      }
```

Replace with:
```typescript
      if (colIdx === 0) {
        this.bridgeSpawner?.onBandLoaded(bandTopY);
      }
```

- [ ] **Step 3: Update the `PortalManager` constructor call**

Find the existing `PortalManager` construction in `create()`:
```typescript
    this.portalManager = new PortalManager(
      this, this.player, this.colBounds, PORTAL_DEF,
      (ms) => {
        this.invincible = true;
        this.time.delayedCall(ms, () => { this.invincible = false; });
      },
    );
```

Replace with:
```typescript
    this.portalManager = new PortalManager(
      this, this.player, this.colBounds, PORTAL_DEF,
      (ms) => {
        this.invincible = true;
        this.time.delayedCall(ms, () => { this.invincible = false; });
      },
      (colIdx, x, nearY) => {
        const layerGen = this.layerGenerators[colIdx];
        const bandTop  = Math.floor(nearY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
        const rows     = layerGen.rowsForBand(bandTop);
        return findPortalSurface(rows, x, PORTAL_DEF.clearanceRequired);
      },
    );
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass (TypeScript compile errors would appear here if any signatures are wrong).

- [ ] **Step 5: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat: wire InfiniteGameScene to new PortalManager with findEligibleSurface callback"
```

---

## Smoke Test Checklist

After all tasks complete, start the dev server (`npm run dev`) and verify in the browser:

- [ ] Portals appear as rotated trashcan sprites sitting on heap surfaces (not floating in mid-air or buried)
- [ ] Entrance portal has particles being sucked inward
- [ ] Exit portal has particles shooting outward (up-right direction)
- [ ] Walking into entrance teleports player to exit with brief invincibility
- [ ] Walking into exit teleports player to entrance
- [ ] Portals continue to appear regularly as the player climbs
- [ ] No stale portals accumulate over a long run (culling working)
- [ ] TypeScript build passes: `npm run build`
