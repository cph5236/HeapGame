# Enemy Defs & Spawn Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a typed `ENEMY_DEFS` data file and fix the enemy spawn bug on server-loaded heaps.

**Architecture:** A new `src/data/enemyDefs.ts` defines `EnemyDef` and `ENEMY_DEFS` keyed by `EnemyKind`. `EnemyManager` reads exclusively from `ENEMY_DEFS`, collapses two spawn methods into one, and gains `onBandLoaded` to handle server-path bands. `HeapGenerator.applyBandPolygon` gains an `onBandLoaded` callback so `GameScene` can wire enemies to the polygon loading path.

**Tech Stack:** TypeScript, Phaser 3.90, Vitest (tests in `src/systems/__tests__/`)

---

## File Map

| File | Action |
|---|---|
| `src/data/enemyDefs.ts` | **Create** — `EnemyDef` interface + `ENEMY_DEFS` |
| `src/entities/Enemy.ts` | **Modify** — accept `EnemyDef`, texture fallback |
| `src/systems/EnemyManager.ts` | **Modify** — remove constant imports, unified `trySpawn`, add `onBandLoaded` |
| `src/systems/__tests__/EnemyManager.test.ts` | **Create** — unit tests for `computeSurfaceAngle` and spawn chance formula |
| `src/systems/HeapGenerator.ts` | **Modify** — add `onBandLoaded` callback, call from `applyBandPolygon` |
| `src/scenes/GameScene.ts` | **Modify** — wire `onBandLoaded`, generate fallback texture |
| `src/constants.ts` | **Modify** — remove 6 per-enemy constants |

---

## Task 1: Create `src/data/enemyDefs.ts`

**Files:**
- Create: `src/data/enemyDefs.ts`

- [ ] **Step 1: Create the file**

```ts
// src/data/enemyDefs.ts
import type { EnemyKind } from '../entities/Enemy';

export interface EnemyDef {
  kind: EnemyKind;

  // Visuals / physics
  textureKey: string;     // Phaser texture key; falls back to 'enemy-fallback' if not loaded
  width: number;
  height: number;
  speed: number;          // px/sec horizontal patrol speed; 0 = stationary

  // Surface spawn eligibility
  spawnOnHeapSurface: boolean;  // spawn on roughly horizontal surfaces (angle < 30°)
  spawnOnHeapWall: boolean;     // spawn on steep surfaces (angle ≥ 30°)

  // Geographic spawn zone (world Y; lower Y = higher on heap)
  spawnStartY: number;    // enemy does not appear below this Y value
  spawnEndY: number;      // enemy does not appear above this Y value; -1 = no ceiling

  // Spawn chance linear ramp
  spawnChanceMin: number; // probability at spawnStartY (0–1)
  spawnChanceMax: number; // probability at spawnRampEndY (0–1)
  spawnRampEndY: number;  // Y at which spawnChanceMax is reached; -1 = ramp never arrives
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  percher: {
    kind: 'percher',
    textureKey: 'enemy-percher',
    width: 24,
    height: 24,
    speed: 0,
    spawnOnHeapSurface: true,
    spawnOnHeapWall: false,
    spawnStartY: 50000,
    spawnEndY: -1,
    spawnChanceMin: 0.1,
    spawnChanceMax: 0.35,
    spawnRampEndY: 10000,
  },
  ghost: {
    kind: 'ghost',
    textureKey: 'enemy-ghost',
    width: 36,
    height: 36,
    speed: 240,
    spawnOnHeapSurface: true,
    spawnOnHeapWall: false,
    spawnStartY: 40000,
    spawnEndY: -1,
    spawnChanceMin: 0.03,
    spawnChanceMax: 0.12,
    spawnRampEndY: 5000,
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```
Expected: no errors referencing `enemyDefs.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/data/enemyDefs.ts
git commit -m "feat: add EnemyDef interface and ENEMY_DEFS record"
```

---

## Task 2: Refactor `Enemy` to accept `EnemyDef`

**Files:**
- Modify: `src/entities/Enemy.ts`

- [ ] **Step 1: Rewrite `Enemy.ts`**

Replace the entire file contents:

```ts
// src/entities/Enemy.ts
import Phaser from 'phaser';
import type { EnemyDef } from '../data/enemyDefs';

export type EnemyKind = 'percher' | 'ghost';

export class Enemy {
  readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  readonly kind: EnemyKind;

  constructor(
    scene: Phaser.Scene,
    group: Phaser.Physics.Arcade.Group,
    x: number,
    y: number,
    def: EnemyDef,
  ) {
    this.kind = def.kind;
    const key = scene.textures.exists(def.textureKey) ? def.textureKey : 'enemy-fallback';
    this.sprite = scene.physics.add.sprite(x, y, key) as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    this.sprite.setData('kind', def.kind);
    this.sprite.setDepth(7);

    group.add(this.sprite);

    // Must be set after group.add — adding to a group can reset body flags
    this.sprite.body.setAllowGravity(false);

    if (def.kind === 'percher') {
      this.sprite.setImmovable(true);
    } else {
      // Patrol left→right across the full world width, bouncing off world bounds
      this.sprite.setCollideWorldBounds(true);
      this.sprite.setBounce(1, 0);
      this.sprite.setVelocityX(-def.speed); // start moving left
    }
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```
Expected: errors in `EnemyManager.ts` (it still passes `EnemyKind` — that's expected, will be fixed in Task 3).

- [ ] **Step 3: Commit**

```bash
git add src/entities/Enemy.ts
git commit -m "refactor: Enemy constructor accepts EnemyDef, texture fallback to enemy-fallback"
```

---

## Task 3: Write failing tests for `EnemyManager` pure logic

These tests cover `computeSurfaceAngle` and the spawn chance formula — the two new pure functions that can be tested without Phaser.

**Files:**
- Create: `src/systems/__tests__/EnemyManager.test.ts`

- [ ] **Step 1: Create test file**

```ts
// src/systems/__tests__/EnemyManager.test.ts
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// computeSurfaceAngle — exported for testing
// Returns degrees from horizontal for a directed edge v1→v2.
// ---------------------------------------------------------------------------
import { computeSurfaceAngle } from '../EnemyManager';

describe('computeSurfaceAngle', () => {
  it('returns 0 for a flat horizontal edge', () => {
    expect(computeSurfaceAngle({ x: 0, y: 100 }, { x: 100, y: 100 })).toBeCloseTo(0);
  });

  it('returns 90 for a perfectly vertical edge', () => {
    expect(computeSurfaceAngle({ x: 50, y: 0 }, { x: 50, y: 100 })).toBeCloseTo(90);
  });

  it('returns ~45 for a 45-degree edge', () => {
    expect(computeSurfaceAngle({ x: 0, y: 0 }, { x: 100, y: 100 })).toBeCloseTo(45);
  });

  it('returns <30 for a shallow slope (surface)', () => {
    // dx=100, dy=10 → atan(10/100) ≈ 5.7°
    expect(computeSurfaceAngle({ x: 0, y: 0 }, { x: 100, y: 10 })).toBeLessThan(30);
  });

  it('returns ≥30 for a steep slope (wall)', () => {
    // dx=10, dy=100 → atan(100/10) ≈ 84.3°
    expect(computeSurfaceAngle({ x: 0, y: 0 }, { x: 10, y: 100 })).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// spawnChance — exported for testing
// Computes spawn probability for a given def and world Y.
// ---------------------------------------------------------------------------
import { spawnChance } from '../EnemyManager';
import type { EnemyDef } from '../../data/enemyDefs';

const baseDef: EnemyDef = {
  kind: 'percher',
  textureKey: 'enemy-percher',
  width: 24,
  height: 24,
  speed: 0,
  spawnOnHeapSurface: true,
  spawnOnHeapWall: false,
  spawnStartY: 50000,
  spawnEndY: -1,
  spawnChanceMin: 0.1,
  spawnChanceMax: 0.5,
  spawnRampEndY: 10000,
};

describe('spawnChance', () => {
  it('returns null below spawnStartY (too low on heap)', () => {
    // Y > spawnStartY means below the start zone
    expect(spawnChance(baseDef, 60000)).toBeNull();
  });

  it('returns spawnChanceMin at spawnStartY', () => {
    expect(spawnChance(baseDef, 50000)).toBeCloseTo(0.1);
  });

  it('returns spawnChanceMax at spawnRampEndY', () => {
    expect(spawnChance(baseDef, 10000)).toBeCloseTo(0.5);
  });

  it('returns spawnChanceMax (clamped) above spawnRampEndY', () => {
    expect(spawnChance(baseDef, 5000)).toBeCloseTo(0.5);
  });

  it('returns interpolated value between start and ramp end', () => {
    // At midpoint Y = (50000 + 10000) / 2 = 30000, t = 0.5, chance = lerp(0.1, 0.5, 0.5) = 0.3
    const result = spawnChance(baseDef, 30000);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.3);
  });

  it('returns null above spawnEndY when endY is set', () => {
    const def = { ...baseDef, spawnEndY: 20000 };
    // Y < spawnEndY means above the ceiling
    expect(spawnChance(def, 15000)).toBeNull();
  });

  it('returns flat spawnChanceMin when spawnRampEndY is -1', () => {
    const def = { ...baseDef, spawnRampEndY: -1 };
    expect(spawnChance(def, 30000)).toBeCloseTo(0.1);
    expect(spawnChance(def, 5000)).toBeCloseTo(0.1);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx vitest run src/systems/__tests__/EnemyManager.test.ts
```
Expected: FAIL — `computeSurfaceAngle` and `spawnChance` not exported from `EnemyManager`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/systems/__tests__/EnemyManager.test.ts
git commit -m "test: add failing tests for EnemyManager computeSurfaceAngle and spawnChance"
```

---

## Task 4: Rewrite `EnemyManager` — make tests pass

**Files:**
- Modify: `src/systems/EnemyManager.ts`

- [ ] **Step 1: Rewrite `EnemyManager.ts`**

Replace the entire file:

```ts
// src/systems/EnemyManager.ts
import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ENEMY_DEFS, EnemyDef } from '../data/enemyDefs';
import { ENEMY_CULL_DISTANCE } from '../constants';
import type { Vertex } from './HeapPolygon';

const SURFACE_ANGLE_THRESHOLD = 30; // degrees — below this is a surface, above is a wall

/** Returns degrees from horizontal for edge v1→v2 (0 = flat, 90 = vertical). */
export function computeSurfaceAngle(v1: Vertex, v2: Vertex): number {
  const dx = Math.abs(v2.x - v1.x);
  const dy = Math.abs(v2.y - v1.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Returns spawn probability for the given def at world Y.
 * Returns null if Y is outside the enemy's spawn zone.
 */
export function spawnChance(def: EnemyDef, y: number): number | null {
  if (y > def.spawnStartY) return null;
  if (def.spawnEndY !== -1 && y < def.spawnEndY) return null;

  if (def.spawnRampEndY === -1) return def.spawnChanceMin;

  const t = Math.min(1, Math.max(0,
    (def.spawnStartY - y) / (def.spawnStartY - def.spawnRampEndY)
  ));
  return def.spawnChanceMin + t * (def.spawnChanceMax - def.spawnChanceMin);
}

export class EnemyManager {
  /** Arcade group — use this for overlap registration in GameScene */
  readonly group: Phaser.Physics.Arcade.Group;

  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.group = scene.physics.add.group();
  }

  /**
   * Call this from the HeapGenerator.onPlatformSpawned callback.
   * blockPlaced guards against spawning enemies on the player's own summit block.
   */
  onPlatformSpawned(x: number, platformTopY: number, blockPlaced: boolean): void {
    if (blockPlaced) return;
    for (const def of Object.values(ENEMY_DEFS)) {
      this.trySpawn(def, x, platformTopY, 0);
    }
  }

  /**
   * Call this when a band polygon is applied from the server path.
   * Iterates polygon edges to find spawnable surfaces.
   */
  onBandLoaded(bandTopY: number, vertices: Vertex[]): void {
    if (vertices.length < 2) return;
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      const angle = computeSurfaceAngle(v1, v2);
      const spawnX = (v1.x + v2.x) / 2;
      const spawnY = Math.min(v1.y, v2.y);
      for (const def of Object.values(ENEMY_DEFS)) {
        this.trySpawn(def, spawnX, spawnY, angle);
      }
    }
  }

  /** Call every frame with current camera bounds. */
  update(_camTop: number, camBottom: number): void {
    const children = this.group.getChildren();
    const cullY = camBottom + ENEMY_CULL_DISTANCE;
    for (let i = children.length - 1; i >= 0; i--) {
      const s = children[i] as Phaser.Physics.Arcade.Sprite;
      if (s.y > cullY) s.destroy();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private trySpawn(def: EnemyDef, x: number, y: number, surfaceAngle: number): void {
    const isSurface = surfaceAngle < SURFACE_ANGLE_THRESHOLD;
    const isWall    = surfaceAngle >= SURFACE_ANGLE_THRESHOLD;

    if (def.spawnOnHeapSurface && !isSurface) return;
    if (def.spawnOnHeapWall    && !isWall)    return;
    if (!def.spawnOnHeapSurface && !def.spawnOnHeapWall) return;

    const chance = spawnChance(def, y);
    if (chance === null) return;
    if (Math.random() >= chance) return;

    const spawnY = y - def.height / 2;
    new Enemy(this.scene, this.group, x, spawnY, def);
  }
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx vitest run src/systems/__tests__/EnemyManager.test.ts
```
Expected: all tests PASS.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```
Expected: errors only in `GameScene.ts` (it still passes a `HeapEntry` to `onPlatformSpawned` — fixed in Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/systems/EnemyManager.ts
git commit -m "feat: refactor EnemyManager to use ENEMY_DEFS, add onBandLoaded and unified trySpawn"
```

---

## Task 5: Add `onBandLoaded` callback to `HeapGenerator`

**Files:**
- Modify: `src/systems/HeapGenerator.ts`

- [ ] **Step 1: Add the callback property and call it from `applyBandPolygon`**

In `HeapGenerator.ts`, directly below the existing `onPlatformSpawned` line:

```ts
// After:
onPlatformSpawned?: (entry: HeapEntry, platformTopY: number) => void;

// Add:
onBandLoaded?: (bandTopY: number, vertices: Vertex[]) => void;
```

Then at the end of `applyBandPolygon`:

```ts
applyBandPolygon(bandTop: number, vertices: Vertex[]): void {
  this.edgeCollider?.buildFromVertices(bandTop, vertices, this.group);
  this.chunkRenderer?.renderFromPolygon(bandTop, vertices);
  this.onBandLoaded?.(bandTop, vertices);   // ← add this line
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```
Expected: same errors as before (GameScene not yet updated) — no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/systems/HeapGenerator.ts
git commit -m "feat: add onBandLoaded callback to HeapGenerator, fire from applyBandPolygon"
```

---

## Task 6: Wire everything in `GameScene` and generate fallback texture

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Add fallback texture generation in `preload`**

Find the `preload()` method in `GameScene.ts`. Add at the end of it:

```ts
// Generate a plain magenta rectangle as fallback for missing enemy textures
const g = this.make.graphics({ x: 0, y: 0, add: false });
g.fillStyle(0xff00ff);
g.fillRect(0, 0, 36, 36);
g.generateTexture('enemy-fallback', 36, 36);
g.destroy();
```

- [ ] **Step 2: Update `EnemyManager` construction**

The `EnemyManager` constructor no longer takes a `getEntries` callback. Find:

```ts
this.enemyManager = new EnemyManager(this, () => this.heapGenerator.entries);
```

Replace with:

```ts
this.enemyManager = new EnemyManager(this);
```

- [ ] **Step 3: Update `onPlatformSpawned` wiring**

Find:

```ts
this.heapGenerator.onPlatformSpawned = (entry, platformTopY) => {
  this.enemyManager.onPlatformSpawned(entry, platformTopY, this.blockPlaced);
};
```

Replace with:

```ts
this.heapGenerator.onPlatformSpawned = (entry, platformTopY) => {
  this.enemyManager.onPlatformSpawned(entry.x, platformTopY, this.blockPlaced);
};

this.heapGenerator.onBandLoaded = (bandTopY, vertices) => {
  this.enemyManager.onBandLoaded(bandTopY, vertices);
};
```

- [ ] **Step 4: Verify TypeScript compiles with zero errors**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Run all tests**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: wire EnemyManager.onBandLoaded in GameScene, generate enemy-fallback texture"
```

---

## Task 7: Remove dead constants from `src/constants.ts`

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Delete the 6 per-enemy constants**

Remove these lines from `src/constants.ts`:

```ts
export const ENEMY_PERCHER_WIDTH        = 24;
export const ENEMY_PERCHER_HEIGHT       = 24;
export const ENEMY_GHOST_SIZE           = 36;
export const ENEMY_GHOST_SPEED          = 240; // px/sec horizontal patrol speed
export const ENEMY_PERCHER_CLEARANCE    = 80;   // min vertical space above block for spawn
export const ENEMY_PERCHER_SPAWN_CHANCE = 0.25; // per-platform probability
export const ENEMY_GHOST_SPAWN_CHANCE   = 0.05;  // per-platform probability
```

Keep `ENEMY_CULL_DISTANCE` — it is a rendering concern and still read by `EnemyManager`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```
Expected: no errors. If any file still imports the removed constants, that's a bug — remove the import.

- [ ] **Step 3: Run all tests**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/constants.ts
git commit -m "chore: remove per-enemy flat constants, values now live in ENEMY_DEFS"
```

---

## Self-Review Notes

- **Spec coverage check:** `EnemyDef` interface ✓ | `ENEMY_DEFS` record ✓ | texture fallback ✓ | `spawnOnHeapSurface` / `spawnOnHeapWall` flags ✓ | `spawnStartY` / `spawnEndY` zone ✓ | linear ramp (`spawnChanceMin`, `spawnChanceMax`, `spawnRampEndY`) ✓ | `onBandLoaded` spawn fix ✓ | `findClearanceAbove` removed ✓ | constants cleanup ✓
- **Type consistency:** `EnemyDef` defined in Task 1, imported in Tasks 2, 3, 4. `computeSurfaceAngle` and `spawnChance` defined and exported in Task 4, imported in tests (Task 3). `onBandLoaded` signature `(bandTopY: number, vertices: Vertex[]) => void` consistent across Tasks 4 and 5.
- **`trySpawn` surface flag logic:** an enemy with `spawnOnHeapSurface: true` and `spawnOnHeapWall: false` spawns only on surfaces (`angle < 30`). An enemy with both `false` never spawns — treated as a config error (guarded by the `if (!def.spawnOnHeapSurface && !def.spawnOnHeapWall) return` check).
