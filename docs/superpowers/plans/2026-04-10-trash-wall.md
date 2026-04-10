# TrashWall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-width, ever-rising TrashWall hazard that chases the player up the heap and kills them if it catches them.

**Architecture:** A standalone `TrashWallManager` class (Option B from spec) owns all runtime state — a `Graphics` rectangle body, a pool of undulating trash `Image` sprites, movement math, and kill detection. Pure movement functions are exported for unit testing. `GameScene` owns one instance and wires the kill callback to the existing enemy-death flow.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/data/trashWallDef.ts` | **Create** | `TrashWallDef` type + `TRASH_WALL_DEF` constant |
| `src/systems/TrashWallManager.ts` | **Create** | Pure math exports + full manager class |
| `src/systems/__tests__/TrashWallManager.test.ts` | **Create** | Unit tests for pure math functions |
| `src/entities/Player.ts` | **Modify** | Add `controlsEnabled` flag, `setControlsEnabled()`, `freeze()` |
| `src/scenes/GameScene.ts` | **Modify** | Instantiate manager, call `spawn()` and `update()`, wire kill callback |

---

## Task 1: Player — setControlsEnabled + freeze

**Files:**
- Modify: `src/entities/Player.ts`

- [ ] **Step 1: Add the `controlsEnabled` field**

In `src/entities/Player.ts`, after `private onLadder: boolean = false;` (line 51), add:

```ts
  private controlsEnabled = true;
```

- [ ] **Step 2: Add the early return to `update()`**

In `src/entities/Player.ts`, after the closing `}` of the ladder block (line 110) and before `const body = this.sprite.body;` (line 112), add:

```ts
    if (!this.controlsEnabled) return;
```

The updated region looks like:
```ts
      // ...ladder block contents...
      if (this.sprite.x < 0)           this.sprite.x = WORLD_WIDTH;
      else if (this.sprite.x > WORLD_WIDTH) this.sprite.x = 0;
      return; // skip all normal physics this frame
    }

    if (!this.controlsEnabled) return;

    const body     = this.sprite.body;
```

- [ ] **Step 3: Add `setControlsEnabled` and `freeze` methods**

After `exitLadder()` (ending around line 257), add these two methods:

```ts
  setControlsEnabled(enabled: boolean): void {
    this.controlsEnabled = enabled;
  }

  freeze(): void {
    if (this.onLadder) this.exitLadder(); // clears onLadder; briefly re-enables gravity
    this.setControlsEnabled(false);
    this.sprite.setVelocity(0, 0);
    this.sprite.body.setAllowGravity(false);
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Run existing tests to confirm nothing broke**

```bash
npm test -- --run
```

Expected: all tests pass (same count as before)

- [ ] **Step 6: Commit**

```bash
git add src/entities/Player.ts
git commit -m "feat: Player.setControlsEnabled + freeze for TrashWall kill"
```

---

## Task 2: TrashWallDef data file

**Files:**
- Create: `src/data/trashWallDef.ts`

- [ ] **Step 1: Create the file**

```ts
// src/data/trashWallDef.ts

export type TrashWallDef = {
  /** px below player Y at spawn */
  spawnBelowPlayerDistance: number;
  /** wall can never be more than this many px below player (slightly > ENEMY_CULL_DISTANCE) */
  maxLaggingDistance: number;
  /** px/s at world bottom (MOCK_HEAP_HEIGHT_PX) */
  speedMin: number;
  /** px/s at yForMaxSpeed */
  speedMax: number;
  /** world Y where speedMax is reached (high up the heap; smaller Y = higher) */
  yForMaxSpeed: number;
  /** px above wall top to set isWarning flag (future: play warningSound) */
  warningDistance: number;
  /** sound key — reserved for future audio pass */
  warningSound: string;
  /** px thickness of lethal band at wall's top edge */
  killZoneHeight: number;
  /** px trash sprites protrude above wall surface */
  undulateAmplitude: number;
  /** oscillation cycles per second */
  undulateSpeed: number;
  /** number of trash sprite images in the undulation pool */
  undulateCount: number;
};

export const TRASH_WALL_DEF: TrashWallDef = {
  spawnBelowPlayerDistance: 1200,
  maxLaggingDistance:       2200,  // slightly above ENEMY_CULL_DISTANCE (2000)
  speedMin:                   40,  // px/s near world floor
  speedMax:                  120,  // px/s at high altitude
  yForMaxSpeed:             5000,  // world Y (small = near heap summit)
  warningDistance:           600,
  warningSound:   'trashwall-warning', // placeholder — no audio hooked up yet
  killZoneHeight:             30,
  undulateAmplitude:          40,
  undulateSpeed:             0.6,
  undulateCount:              12,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/data/trashWallDef.ts
git commit -m "feat: TrashWallDef type and TRASH_WALL_DEF constant"
```

---

## Task 3: TrashWallManager — pure math functions (TDD)

**Files:**
- Create: `src/systems/TrashWallManager.ts` (pure exports only for now)
- Create: `src/systems/__tests__/TrashWallManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/TrashWallManager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeWallSpeed, clampWallY, isKillZoneReached } from '../TrashWallManager';

// World: Y=0 is summit, Y=50000 is floor (MOCK_HEAP_HEIGHT_PX = 50000)
const WORLD_H = 50_000;

describe('computeWallSpeed', () => {
  it('returns speedMin when wall is at world floor', () => {
    // wallY = WORLD_H, t = 1 → speed = speedMax - 1*(speedMax - speedMin) = speedMin
    expect(computeWallSpeed(50_000, 40, 120, 5_000, WORLD_H)).toBeCloseTo(40);
  });

  it('returns speedMax when wall is at yForMaxSpeed', () => {
    // wallY = yForMaxSpeed, t = 0 → speed = speedMax - 0 = speedMax
    expect(computeWallSpeed(5_000, 40, 120, 5_000, WORLD_H)).toBeCloseTo(120);
  });

  it('returns speedMax (clamped) when wall is above yForMaxSpeed', () => {
    // wallY < yForMaxSpeed → t clamped to 0 → speed = speedMax
    expect(computeWallSpeed(1_000, 40, 120, 5_000, WORLD_H)).toBeCloseTo(120);
  });

  it('returns interpolated speed at midpoint', () => {
    // wallY midpoint between yForMaxSpeed (5000) and floor (50000): 27500
    // t = (27500 - 5000) / (50000 - 5000) = 22500 / 45000 = 0.5
    // speed = 120 - 0.5 * (120 - 40) = 120 - 40 = 80
    expect(computeWallSpeed(27_500, 40, 120, 5_000, WORLD_H)).toBeCloseTo(80);
  });
});

describe('clampWallY', () => {
  it('returns wallY unchanged when wall is within maxLaggingDistance', () => {
    // wallY=2000, playerY=100, maxLag=2200 → playerY + maxLag = 2300 > wallY → no clamp
    expect(clampWallY(2000, 100, 2200)).toBe(2000);
  });

  it('clamps wallY to playerY + maxLaggingDistance when wall lags too far', () => {
    // wallY=3000, playerY=100, maxLag=2200 → playerY + maxLag = 2300 < wallY → clamp to 2300
    expect(clampWallY(3000, 100, 2200)).toBe(2300);
  });

  it('clamps exactly at the boundary', () => {
    expect(clampWallY(2300, 100, 2200)).toBe(2300);
  });
});

describe('isKillZoneReached', () => {
  it('returns false when player is above the kill zone', () => {
    // wallY=1000, killZoneHeight=30 → kill threshold = 1000 - 30 = 970
    // playerY=900 < 970 → not in kill zone
    expect(isKillZoneReached(900, 1000, 30)).toBe(false);
  });

  it('returns true when player Y equals kill threshold', () => {
    // playerY=970 >= 970 → kill zone reached
    expect(isKillZoneReached(970, 1000, 30)).toBe(true);
  });

  it('returns true when player is fully inside the wall', () => {
    expect(isKillZoneReached(1050, 1000, 30)).toBe(true);
  });
});
```

- [ ] **Step 2: Create `src/systems/TrashWallManager.ts` with pure exports only**

```ts
// src/systems/TrashWallManager.ts
import type { TrashWallDef } from '../data/trashWallDef';
import { OBJECT_DEF_LIST } from '../data/heapObjectDefs';
import { WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX } from '../constants';
import Phaser from 'phaser';

// ── Pure math — exported for unit testing ─────────────────────────────────────

/**
 * Interpolates wall speed between speedMin (at world floor) and speedMax (at yForMaxSpeed).
 * As wallY decreases (wall climbs higher), speed increases toward speedMax.
 */
export function computeWallSpeed(
  wallY: number,
  speedMin: number,
  speedMax: number,
  yForMaxSpeed: number,
  worldHeight: number,
): number {
  const t = Math.min(1, Math.max(0, (wallY - yForMaxSpeed) / (worldHeight - yForMaxSpeed)));
  return speedMax - t * (speedMax - speedMin);
}

/**
 * Clamps wallY so it can never lag more than maxLaggingDistance below playerY.
 * In Phaser coords Y increases downward, so "below" = larger Y.
 */
export function clampWallY(wallY: number, playerY: number, maxLaggingDistance: number): number {
  return Math.min(wallY, playerY + maxLaggingDistance);
}

/**
 * Returns true when the player has entered the lethal band at the wall's top edge.
 */
export function isKillZoneReached(playerY: number, wallY: number, killZoneHeight: number): boolean {
  return playerY >= wallY - killZoneHeight;
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test -- --run src/systems/__tests__/TrashWallManager.test.ts
```

Expected: tests **fail** because the functions are not exported yet (they exist but this confirms the test file loads correctly and the import resolves)

Actually: the functions ARE defined in Step 2 already. Run tests to verify they **pass**:

```bash
npm test -- --run src/systems/__tests__/TrashWallManager.test.ts
```

Expected: all 9 tests PASS

- [ ] **Step 4: Run full test suite to confirm no regressions**

```bash
npm test -- --run
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/systems/TrashWallManager.ts src/systems/__tests__/TrashWallManager.test.ts
git commit -m "feat: TrashWallManager pure math — computeWallSpeed, clampWallY, isKillZoneReached"
```

---

## Task 4: TrashWallManager — full class

**Files:**
- Modify: `src/systems/TrashWallManager.ts` (add class below existing exports)

- [ ] **Step 1: Add the full class to `src/systems/TrashWallManager.ts`**

Append below the existing pure-function exports:

```ts
// ── Runtime types ─────────────────────────────────────────────────────────────

/** Phaser Image with undulation state attached. */
interface UndulateImage extends Phaser.GameObjects.Image {
  _phase:  number; // random phase offset (radians)
  _scalar: number; // random amplitude multiplier [0.5, 1.0]
}

const SPRITE_KEYS = OBJECT_DEF_LIST.map(d => d.textureKey);

// ── TrashWallManager ──────────────────────────────────────────────────────────

export class TrashWallManager {
  /** True when wall is within def.warningDistance of the player. Read by GameScene (future audio). */
  isWarning = false;

  private wallY    = 0;
  private spawned  = false;
  private killed   = false;

  private readonly body:        Phaser.GameObjects.Graphics;
  private readonly trashSprites: UndulateImage[] = [];

  constructor(
    private readonly scene:   Phaser.Scene,
    private readonly def:     TrashWallDef,
    private readonly onKill:  () => void,
  ) {
    this.body = scene.add.graphics();
    this.body.setDepth(5);
  }

  /**
   * Call once from GameScene.create(), after the player's final position is resolved
   * (including checkpoint repositioning). Spawns wall below the player and builds the sprite pool.
   */
  spawn(playerY: number): void {
    this.wallY  = playerY + this.def.spawnBelowPlayerDistance;
    this.spawned = true;
    this._buildSpritePool();
    this._redraw(0);
  }

  /**
   * Call every frame from GameScene.update() with the player's current world Y and the frame delta (ms).
   * Moves the wall upward, enforces the max-lag clamp, checks kill zone, redraws.
   */
  update(playerY: number, delta: number): void {
    if (!this.spawned || this.killed) return;

    const speed = computeWallSpeed(
      this.wallY, this.def.speedMin, this.def.speedMax,
      this.def.yForMaxSpeed, MOCK_HEAP_HEIGHT_PX,
    );
    this.wallY -= speed * (delta / 1000); // move up (Y decreases)
    this.wallY  = clampWallY(this.wallY, playerY, this.def.maxLaggingDistance);

    this.isWarning = playerY > this.wallY - this.def.warningDistance;

    if (isKillZoneReached(playerY, this.wallY, this.def.killZoneHeight)) {
      this.killed = true;
      this.onKill();
      return; // skip redraw after kill
    }

    const time = this.scene.time.now / 1000; // seconds
    this._redraw(time);
  }

  destroy(): void {
    this.body.destroy();
    this.trashSprites.forEach(s => s.destroy());
    this.trashSprites.length = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Creates a fixed pool of Image objects spread evenly along the wall's top edge. */
  private _buildSpritePool(): void {
    const count = this.def.undulateCount;
    const slotW = WORLD_WIDTH / count;
    for (let i = 0; i < count; i++) {
      const key = SPRITE_KEYS[i % SPRITE_KEYS.length];
      const img  = this.scene.add.image(
        slotW * i + slotW / 2,
        this.wallY,
        key,
      ) as UndulateImage;
      img.setDepth(6);
      img.setDisplaySize(52, 52);
      img._phase  = Math.random() * Math.PI * 2;
      img._scalar = 0.5 + Math.random() * 0.5;
      this.trashSprites.push(img);
    }
  }

  /**
   * Redraws the solid wall body and repositions undulating trash sprites.
   * @param time - scene time in seconds (used for sine oscillation)
   */
  private _redraw(time: number): void {
    // Body: dark brown rectangle from wallY downward, spanning full world width
    this.body.clear();
    this.body.fillStyle(0x3B1F0A, 1);
    this.body.fillRect(0, this.wallY, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);

    // Trash sprites undulate above the wall surface
    for (const img of this.trashSprites) {
      img.y = this.wallY
        - this.def.undulateAmplitude
        * img._scalar
        * Math.sin(time * this.def.undulateSpeed * Math.PI * 2 + img._phase);
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Run full test suite**

```bash
npm test -- --run
```

Expected: all tests pass (the new class has no unit tests — it's Phaser-coupled and verified via smoke test)

- [ ] **Step 4: Commit**

```bash
git add src/systems/TrashWallManager.ts
git commit -m "feat: TrashWallManager class — wall body, sprite pool, undulation, kill detection"
```

---

## Task 5: GameScene integration

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Add import at top of GameScene**

In `src/scenes/GameScene.ts`, after the existing imports (around line 31), add:

```ts
import { TrashWallManager } from '../systems/TrashWallManager';
import { TRASH_WALL_DEF } from '../data/trashWallDef';
```

- [ ] **Step 2: Add the field declaration**

In `src/scenes/GameScene.ts`, after `private placeableManager!: PlaceableManager;` in the class fields block, add:

```ts
  private trashWallManager!: TrashWallManager;
```

- [ ] **Step 3: Instantiate in `create()` and call spawn**

In `src/scenes/GameScene.ts`, find the end of the checkpoint reposition block (the closing `}` after `this.invincible = ...`). After the block's closing `}` and before the comment `// Stream an initial chunk...`, add:

```ts
    this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
      this.player.freeze();
      this.player.sprite.setDepth(4); // visually swallowed — below wall body (depth 5)
      this.time.delayedCall(800, () => {
        const checkpointAvailable = getPlaced().some(
          p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
        );
        const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
        this.scene.launch('ScoreScene', { score, isPeak: false, checkpointAvailable, isFailure: true });
        this.scene.pause();
      });
    });
    this.trashWallManager.spawn(this.player.sprite.y);
```

The surrounding context should look like:

```ts
    // If restarted via checkpoint respawn, reposition player and consume one spawn
    if (this.checkpointRespawn) {
      const placed = getPlaced();
      const cpIdx  = placed.findIndex(p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0);
      if (cpIdx !== -1) {
        const cp = placed[cpIdx];
        this.player.sprite.setPosition(cp.x, cp.y - 50);
        const newSpawns = (cp.meta?.spawnsLeft ?? 0) - 1;
        updatePlacedMeta(cpIdx, { spawnsLeft: newSpawns });
        if (newSpawns <= 0) removeExpiredPlaced();
        this.invincible = true;
        this.time.delayedCall(PLAYER_INVINCIBLE_MS * 5, () => { this.invincible = false; });
      }
    }

    this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
      this.player.freeze();
      this.player.sprite.setDepth(4);
      this.time.delayedCall(800, () => {
        const checkpointAvailable = getPlaced().some(
          p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
        );
        const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
        this.scene.launch('ScoreScene', { score, isPeak: false, checkpointAvailable, isFailure: true });
        this.scene.pause();
      });
    });
    this.trashWallManager.spawn(this.player.sprite.y);

    // Stream an initial chunk synchronously so collision is ready before the first frame
    this.highestGeneratedY = this.spawnY;
```

- [ ] **Step 4: Call `update()` in the `update()` method**

In `src/scenes/GameScene.ts`, in the `update()` method, before `this.enemyManager.update(camTop, camBottom);` (line ~248), add:

```ts
    this.trashWallManager.update(this.player.sprite.y, delta);
```

The surrounding context:

```ts
    this.enemyManager.update(camTop, camBottom);
    this.chunkRenderer.cullChunks(camBottom);
    this.edgeCollider.cullBands(camBottom, 2000);
```

becomes:

```ts
    this.trashWallManager.update(this.player.sprite.y, delta);
    this.enemyManager.update(camTop, camBottom);
    this.chunkRenderer.cullChunks(camBottom);
    this.edgeCollider.cullBands(camBottom, 2000);
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Run full test suite**

```bash
npm test -- --run
```

Expected: all tests pass

- [ ] **Step 7: Smoke test in browser**

```bash
npm run dev
```

Open http://localhost:3000. Verify:
- Dark brown wall is visible below the player shortly after game starts
- Wall rises upward over time
- Wall rises faster as player climbs higher
- When wall catches the player: player freezes in place, wall overlaps them, score screen appears after ~800ms
- Checkpoint respawn: wall spawns below the checkpoint Y, not the world floor spawn Y

- [ ] **Step 8: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: wire TrashWallManager into GameScene — spawn, update, kill callback"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Implemented in |
|---|---|
| Spawns below player at game start | Task 5, Step 3 — `spawn(playerY)` called after checkpoint reposition |
| Checkpoint spawn: wall below checkpoint Y | Task 5, Step 3 — `spawn()` uses `player.sprite.y` after reposition |
| Base speed + altitude acceleration | Task 3 — `computeWallSpeed` interpolates speedMin→speedMax |
| Max-lag clamp (never > maxLaggingDistance behind) | Task 3 — `clampWallY` |
| Kill on contact → player freezes | Task 1 — `freeze()`, Task 5 — kill callback |
| Controls disabled on kill | Task 1 — `setControlsEnabled(false)` called by `freeze()` |
| Wall visually swallows player (depth swap) | Task 5, Step 3 — `sprite.setDepth(4)` |
| Score screen launches after 800ms | Task 5, Step 3 — `time.delayedCall(800, ...)` |
| Dark brown wall body full width | Task 4 — `fillStyle(0x3B1F0A)` + `fillRect(0, wallY, WORLD_WIDTH, ...)` |
| Trash sprites undulate from wall top | Task 4 — `_buildSpritePool` + `_redraw` sine oscillation |
| Sprites from heap sprite set | Task 4 — `SPRITE_KEYS = OBJECT_DEF_LIST.map(d => d.textureKey)` |
| `warningDistance` / `isWarning` flag | Task 4 — `this.isWarning = playerY > this.wallY - def.warningDistance` |
| `TrashWallDef` with all specified fields | Task 2 — all 11 fields present |
| No changes to EnemyManager/Enemy | All tasks — confirmed untouched |
| `setControlsEnabled` as standalone method | Task 1 — separate from `freeze()` |

All spec requirements covered.
