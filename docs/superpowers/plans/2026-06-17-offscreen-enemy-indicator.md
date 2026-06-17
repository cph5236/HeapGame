# Off-Screen Enemy Indicator ("Threat Radar") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render screen-edge arrows pointing toward nearby off-screen enemies (including ones reachable via world-wrap), gated by a purchasable "Threat Radar" range upgrade, in both GameScene and InfiniteGameScene.

**Architecture:** A pure geometry module (`enemyRadarMath`) computes which enemies are off-screen, in range, and where their edge-clamped arrow sits — fully unit-tested with no Phaser. A HUD-style renderer (`EnemyRadar`) owns a fixed pool of DPR-baked arrow Images on the gameplay UI camera and refreshes them each frame from the math output. A data-driven upgrade entry feeds the detection range.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vite 6, Vitest.

## Global Constraints

- **Branch off `main`** before any work; PR before merge, never push direct to main.
- **`npm run build` must pass** before claiming any task done — it catches TS errors tests miss.
- **Screen-space objects** use `setScrollFactor(0)`, are authored in logical px, and are registered via `addToGameplayUi(scene, parts)` so they render on the gameplay UI camera.
- **Generated textures are DPR-baked**: draw at `getDprCap()` scale, then `setDisplaySize(logicalW, logicalH)` (matches `src/ui/hudTheme.ts`).
- **Never read `camera.worldView` inside `update()`** — it is refreshed only in `preRender` and is stale during the update loop. Use `camera.scrollX/scrollY` + `camera.width/height / camera.zoom`.
- **Wrap period** for both scenes is `this.player.worldWidth + this.player.wrapPadX` (`worldWidth` defaults to `WORLD_WIDTH`/is set to `INFINITE_WORLD_WIDTH`; `wrapPadX` defaults to `SKY_PAD*WORLD_WIDTH`/is set to `INFINITE_EDGE_PAD`).
- **Spec:** `docs/superpowers/specs/2026-06-17-offscreen-enemy-indicator-design.md`.

## File Structure

- Create `src/systems/enemyRadarMath.ts` — pure geometry: wrap-nearest, blip computation, nearest-N selection.
- Create `src/systems/__tests__/enemyRadarMath.test.ts` — unit tests for the above.
- Create `src/ui/EnemyRadar.ts` — pooled arrow renderer on the gameplay UI camera.
- Modify `src/constants.ts` — radar tuning constants.
- Modify `src/data/upgradeDefs.ts` — `enemy_radar` upgrade def.
- Modify `src/scenes/UpgradeScene.ts:15-23` — accent color for the new row.
- Modify `src/scenes/GameScene.ts` — construct radar, per-frame update, `_devRadarFixture` dev hook.
- Modify `src/scenes/InfiniteGameScene.ts` — construct radar, per-frame update.

**Verification convention:** This repo has no unit tests for Phaser render code (HUD, etc.); UI is verified by `npm run build` (TS) + `npm run scene-preview` screenshots. Task 1 (pure logic) uses full TDD; Tasks 2–6 use build + preview, matching the established pattern.

---

### Task 1: Radar geometry module (`enemyRadarMath`)

**Files:**
- Create: `src/systems/enemyRadarMath.ts`
- Test: `src/systems/__tests__/enemyRadarMath.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface RadarView { x: number; y: number; width: number; height: number }`
  - `interface RadarOpts { rangePx: number; marginPx: number; wrapPeriod: number }`
  - `interface Blip { x: number; y: number; angle: number; dist: number }`
  - `wrapNearestX(enemyX: number, playerX: number, period: number): number`
  - `computeBlip(enemyX, enemyY, playerX, playerY, view: RadarView, opts: RadarOpts): Blip | null`
  - `selectBlips(enemies: Iterable<{x:number;y:number}>, playerX, playerY, view: RadarView, opts: RadarOpts, max: number): Blip[]`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/enemyRadarMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  wrapNearestX,
  computeBlip,
  selectBlips,
  type RadarView,
  type RadarOpts,
} from '../enemyRadarMath';

const VIEW: RadarView = { x: 0, y: 0, width: 480, height: 900 };
const OPTS: RadarOpts = { rangePx: 600, marginPx: 24, wrapPeriod: 1200 };
const PX = 240, PY = 450; // player at view centre

describe('wrapNearestX', () => {
  it('returns the raw x when no wrapped image is closer', () => {
    expect(wrapNearestX(540, 240, 1200)).toBe(540);
  });
  it('picks the left wrapped image for a far-right enemy', () => {
    // 950 vs player 30: raw dist 920, but (950-1200)=-250 is dist 280 → closer
    expect(wrapNearestX(950, 30, 1200)).toBe(-250);
  });
  it('picks the right wrapped image for a far-left enemy', () => {
    // -250 vs player 930: raw dist 1180, but (-250+1200)=950 is dist 20 → closer
    expect(wrapNearestX(-250, 930, 1200)).toBe(950);
  });
});

describe('computeBlip', () => {
  it('returns null for an on-screen enemy', () => {
    expect(computeBlip(240, 450, PX, PY, VIEW, OPTS)).toBeNull();
  });
  it('returns null for an enemy beyond range', () => {
    // 700px straight up — off-screen but out of the 600px range
    expect(computeBlip(240, -250, PX, PY, VIEW, OPTS)).toBeNull();
  });
  it('clamps to the right edge with angle ~0', () => {
    const b = computeBlip(540, 450, PX, PY, VIEW, OPTS)!;
    expect(b).not.toBeNull();
    expect(b.x).toBe(456); // width - margin
    expect(b.y).toBe(450);
    expect(b.angle).toBeCloseTo(0, 5);
  });
  it('clamps to the left edge with angle ~pi', () => {
    const b = computeBlip(-60, 450, PX, PY, VIEW, OPTS)!;
    expect(b.x).toBe(24); // margin
    expect(Math.abs(b.angle)).toBeCloseTo(Math.PI, 5);
  });
  it('clamps to the top edge with angle ~-pi/2', () => {
    const b = computeBlip(240, -50, PX, PY, VIEW, OPTS)!;
    expect(b.y).toBe(24);
    expect(b.angle).toBeCloseTo(-Math.PI / 2, 5);
  });
  it('clamps to the bottom edge with angle ~pi/2', () => {
    const b = computeBlip(240, 950, PX, PY, VIEW, OPTS)!;
    expect(b.y).toBe(876); // height - margin
    expect(b.angle).toBeCloseTo(Math.PI / 2, 5);
  });
  it('clamps to a corner for an off-bottom-right enemy', () => {
    const b = computeBlip(540, 950, PX, PY, VIEW, OPTS)!;
    expect(b.x).toBe(456);
    expect(b.y).toBe(876);
  });
  it('puts the arrow on the NEAR edge for a wrap-side enemy', () => {
    // Player near the left edge; camera view starts at -210. Enemy at the far
    // RIGHT world edge (950) is 920px away linearly (out of range) but only 280px
    // via wrap, so it should yield a LEFT-edge arrow.
    const view: RadarView = { x: -210, y: 0, width: 480, height: 900 };
    const b = computeBlip(950, 450, 30, 450, view, OPTS)!;
    expect(b).not.toBeNull();
    expect(b.x).toBe(24); // left edge (margin)
    expect(Math.abs(b.angle)).toBeCloseTo(Math.PI, 5);
    expect(b.dist).toBeCloseTo(280, 5);
  });
});

describe('selectBlips', () => {
  it('returns the nearest N off-screen enemies, capped at max', () => {
    const enemies = [
      { x: 240, y: 450 },  // on-screen → filtered
      { x: 540, y: 450 },  // 300px off right
      { x: 240, y: 950 },  // 500px off bottom
    ];
    const blips = selectBlips(enemies, PX, PY, VIEW, OPTS, 1);
    expect(blips).toHaveLength(1);
    expect(blips[0].dist).toBeCloseTo(300, 5); // the nearer one
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- enemyRadarMath`
Expected: FAIL — `Cannot find module '../enemyRadarMath'`.

- [ ] **Step 3: Write the implementation**

Create `src/systems/enemyRadarMath.ts`:

```ts
// src/systems/enemyRadarMath.ts
// Pure geometry for the off-screen enemy indicator (Threat Radar). No Phaser
// value import, so it unit-tests cleanly in the Vitest `node` environment.

export interface RadarView {
  /** Logical world coord of the viewport's top-left (camera scrollX/scrollY). */
  x: number;
  y: number;
  /** Logical viewport size (camera width/height ÷ zoom). */
  width: number;
  height: number;
}

export interface RadarOpts {
  /** Detection radius in world px; enemies farther than this are ignored. */
  rangePx: number;
  /** Arrow inset from the viewport edge, in logical px. */
  marginPx: number;
  /** Horizontal wrap period (worldWidth + wrapPad); the world is a cylinder. */
  wrapPeriod: number;
}

export interface Blip {
  /** Logical screen position of the arrow (clamped to the margin rect). */
  x: number;
  y: number;
  /** Arrow rotation in radians, pointing toward the enemy. */
  angle: number;
  /** Player→enemy distance in world px (for nearest-N selection). */
  dist: number;
}

/**
 * Whichever of enemyX, enemyX - period, enemyX + period is closest to playerX.
 * The wrap trick: an enemy at the far world edge resolves to a "ghost image"
 * just past the near edge, so its arrow appears on the side the player would
 * travel to reach it via wrap.
 */
export function wrapNearestX(enemyX: number, playerX: number, period: number): number {
  let best = enemyX;
  let bestDist = Math.abs(enemyX - playerX);
  for (const cand of [enemyX - period, enemyX + period]) {
    const d = Math.abs(cand - playerX);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

/**
 * Screen-space blip for one enemy, or null if it is on-screen OR beyond rangePx.
 *
 * World→logical-screen is (wx - view.x, wy - view.y); `view` is built from camera
 * scroll + size/zoom (NOT cam.worldView, which is stale during update()). The arrow
 * is clamped to a rect inset by marginPx; its angle points from the clamped edge
 * point toward the (wrap-resolved) enemy.
 */
export function computeBlip(
  enemyX: number, enemyY: number,
  playerX: number, playerY: number,
  view: RadarView, opts: RadarOpts,
): Blip | null {
  const wx = wrapNearestX(enemyX, playerX, opts.wrapPeriod);
  const dx = wx - playerX;
  const dy = enemyY - playerY;
  const dist = Math.hypot(dx, dy);
  if (dist > opts.rangePx) return null;

  const sx = wx - view.x;
  const sy = enemyY - view.y;
  const onScreen = sx >= 0 && sx <= view.width && sy >= 0 && sy <= view.height;
  if (onScreen) return null;

  const minX = opts.marginPx;
  const maxX = view.width - opts.marginPx;
  const minY = opts.marginPx;
  const maxY = view.height - opts.marginPx;
  const cx = Math.min(Math.max(sx, minX), maxX);
  const cy = Math.min(Math.max(sy, minY), maxY);
  const angle = Math.atan2(sy - cy, sx - cx);
  return { x: cx, y: cy, angle, dist };
}

/**
 * Nearest `max` blips across all enemies, so a crowd never exceeds the arrow pool.
 */
export function selectBlips(
  enemies: Iterable<{ x: number; y: number }>,
  playerX: number, playerY: number,
  view: RadarView, opts: RadarOpts, max: number,
): Blip[] {
  const blips: Blip[] = [];
  for (const e of enemies) {
    const b = computeBlip(e.x, e.y, playerX, playerY, view, opts);
    if (b) blips.push(b);
  }
  blips.sort((a, b) => a.dist - b.dist);
  return blips.length > max ? blips.slice(0, max) : blips;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- enemyRadarMath`
Expected: PASS — all cases in the three `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/systems/enemyRadarMath.ts src/systems/__tests__/enemyRadarMath.test.ts
git commit -m "feat(radar): add wrap-aware off-screen enemy geometry"
```

---

### Task 2: Radar constants + renderer (`EnemyRadar`)

**Files:**
- Modify: `src/constants.ts` (append a new section)
- Create: `src/ui/EnemyRadar.ts`

**Interfaces:**
- Consumes: `selectBlips`, `RadarView`, `Blip` from Task 1; `getDprCap`, `logicalWidth`, `logicalHeight` from `src/systems/displayMetrics`; `addToGameplayUi` from `src/systems/GameplayUiCamera`.
- Produces:
  - Constants `ENEMY_RADAR_BASE_RANGE_PX`, `ENEMY_RADAR_RANGE_PER_LEVEL`, `ENEMY_RADAR_MARGIN_PX`, `ENEMY_RADAR_MAX_ARROWS`.
  - `class EnemyRadar` with `constructor(scene: Phaser.Scene, rangePx: number)` and `update(camera: Phaser.Cameras.Scene2D.Camera, enemyGroups: Phaser.Physics.Arcade.Group[], playerX: number, playerY: number, wrapPeriod: number): void`.

- [ ] **Step 1: Add the constants**

Append to the end of `src/constants.ts`:

```ts
// ── Off-screen enemy indicator (Threat Radar) ───────────────────────────────
/** Detection radius (world px) at upgrade level 0 — the base everyone gets. */
export const ENEMY_RADAR_BASE_RANGE_PX   = 600;
/** Added detection range per Threat Radar level (+10% of base per level). */
export const ENEMY_RADAR_RANGE_PER_LEVEL = 0.10;
/** Arrow inset from the screen edge, in logical px. */
export const ENEMY_RADAR_MARGIN_PX       = 24;
/** Max simultaneous arrows (pool size). */
export const ENEMY_RADAR_MAX_ARROWS      = 8;
```

- [ ] **Step 2: Write the renderer**

Create `src/ui/EnemyRadar.ts`:

```ts
// src/ui/EnemyRadar.ts
import Phaser from 'phaser';
import { getDprCap } from '../systems/displayMetrics';
import { addToGameplayUi } from '../systems/GameplayUiCamera';
import { selectBlips, type Blip, type RadarView } from '../systems/enemyRadarMath';
import { ENEMY_RADAR_MARGIN_PX, ENEMY_RADAR_MAX_ARROWS } from '../constants';

const ARROW_KEY   = 'enemy-radar-arrow';
const ARROW_BOX   = 18; // logical px (square texture display size)
const ARROW_DEPTH = 18; // above world, below the score/pause chips (depth 19/20)

/**
 * Screen-edge arrows pointing toward nearby off-screen enemies. Lives on the
 * gameplay UI camera like the HUD. Construct once in create(); call update()
 * each frame. Decoupled from EnemyManager — reads only public Arcade groups.
 */
export class EnemyRadar {
  private readonly rangePx: number;
  private readonly arrows: Phaser.GameObjects.Image[] = [];
  // Reused across frames so gathering enemy refs allocates nothing.
  private readonly scratch: { x: number; y: number }[] = [];

  constructor(scene: Phaser.Scene, rangePx: number) {
    this.rangePx = rangePx;
    EnemyRadar.ensureTexture(scene);

    const parts: Phaser.GameObjects.GameObject[] = [];
    for (let i = 0; i < ENEMY_RADAR_MAX_ARROWS; i++) {
      const img = scene.add.image(0, 0, ARROW_KEY)
        .setScrollFactor(0)
        .setDisplaySize(ARROW_BOX, ARROW_BOX)
        .setDepth(ARROW_DEPTH)
        .setVisible(false);
      this.arrows.push(img);
      parts.push(img);
    }
    addToGameplayUi(scene, parts);
  }

  /** Bake the triangular arrow texture once, DPR-scaled (matches hudTheme). */
  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(ARROW_KEY)) return;
    const dpr = getDprCap();
    const s = (n: number): number => n * dpr;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    // Arrow pointing +X (rotation 0), drawn in an 18×18 logical box × dpr.
    g.fillStyle(0xff3b30, 1);          // alert red
    g.lineStyle(s(2), 0x000000, 0.9);  // dark outline for contrast over bright sky
    g.beginPath();
    g.moveTo(s(17), s(9));  // tip (right)
    g.lineTo(s(3),  s(2));  // top-left
    g.lineTo(s(7),  s(9));  // inner notch
    g.lineTo(s(3),  s(16)); // bottom-left
    g.closePath();
    g.fillPath();
    g.strokePath();
    g.generateTexture(ARROW_KEY, Math.ceil(s(ARROW_BOX)), Math.ceil(s(ARROW_BOX)));
    g.destroy();
  }

  /**
   * @param camera      the main (following) gameplay camera
   * @param enemyGroups public Arcade groups holding live enemy sprites
   * @param playerX     player world X
   * @param playerY     player world Y
   * @param wrapPeriod  horizontal wrap period (worldWidth + wrapPad)
   */
  update(
    camera: Phaser.Cameras.Scene2D.Camera,
    enemyGroups: Phaser.Physics.Arcade.Group[],
    playerX: number,
    playerY: number,
    wrapPeriod: number,
  ): void {
    // Logical visible rect from scroll + size/zoom — NOT camera.worldView, which
    // is refreshed only in preRender and is stale during update().
    const view: RadarView = {
      x: camera.scrollX,
      y: camera.scrollY,
      width: camera.width / camera.zoom,
      height: camera.height / camera.zoom,
    };

    // Gather active enemy sprite refs (sprites satisfy {x,y}; no new objects).
    this.scratch.length = 0;
    for (const group of enemyGroups) {
      const children = group.getChildren() as Phaser.GameObjects.Sprite[];
      for (const c of children) {
        if (c.active) this.scratch.push(c);
      }
    }

    const blips = selectBlips(
      this.scratch, playerX, playerY, view,
      { rangePx: this.rangePx, marginPx: ENEMY_RADAR_MARGIN_PX, wrapPeriod },
      this.arrows.length,
    );

    for (let i = 0; i < this.arrows.length; i++) {
      const arrow = this.arrows[i];
      const blip = blips[i] as Blip | undefined;
      if (blip) {
        arrow.setPosition(blip.x, blip.y).setRotation(blip.angle).setVisible(true);
      } else {
        arrow.setVisible(false);
      }
    }
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: PASS — no TS errors. (No runtime wiring yet; that lands in Tasks 4–5.)

- [ ] **Step 4: Commit**

```bash
git add src/constants.ts src/ui/EnemyRadar.ts
git commit -m "feat(radar): add EnemyRadar renderer + tuning constants"
```

---

### Task 3: Threat Radar upgrade entry

**Files:**
- Modify: `src/data/upgradeDefs.ts` (append to `UPGRADE_DEFS`)
- Modify: `src/scenes/UpgradeScene.ts:15-23` (add accent color)

**Interfaces:**
- Consumes: nothing new.
- Produces: an `UPGRADE_DEFS` entry with `id: 'enemy_radar'`, `maxLevel: 3`, read at runtime via the existing `getUpgradeLevel('enemy_radar')`.

- [ ] **Step 1: Add the upgrade def**

In `src/data/upgradeDefs.ts`, add this object as the last entry of the `UPGRADE_DEFS` array (after `mountain_climber`):

```ts
  {
    id: 'enemy_radar',
    name: 'Threat Radar',
    description: (l) => `+${l * 10}% off-screen enemy detection range`,
    maxLevel: 3,
    cost: (l) => [300, 600, 1200][l - 1], // designer-tunable
  },
```

- [ ] **Step 2: Add the accent color**

In `src/scenes/UpgradeScene.ts`, add a line to the `ACCENT_COLORS` object (after `peak_hunter`):

```ts
  peak_hunter: 0xcc44ff,
  enemy_radar: 0xff3b30,
```

- [ ] **Step 3: Verify build + store render**

Run: `npm run build`
Expected: PASS.

Run: `npm run scene-preview -- UpgradeScene '{}' pixel7`
Expected: a screenshot is written; the upgrade list now includes a "Threat Radar" row with a red accent and the "+0% off-screen enemy detection range" description at level 0.

- [ ] **Step 4: Commit**

```bash
git add src/data/upgradeDefs.ts src/scenes/UpgradeScene.ts
git commit -m "feat(radar): add Threat Radar range upgrade"
```

---

### Task 4: Wire radar into GameScene + dev fixture

**Files:**
- Modify: `src/scenes/GameScene.ts`

**Interfaces:**
- Consumes: `EnemyRadar` (Task 2), `ENEMY_RADAR_BASE_RANGE_PX`/`ENEMY_RADAR_RANGE_PER_LEVEL` (Task 2), `getUpgradeLevel` (SaveData), `ENEMY_DEFS` (already imported), `Enemy` entity.
- Produces: a live radar in the standard climb + a `_devRadarFixture` preview hook.

- [ ] **Step 1: Add imports**

In `src/scenes/GameScene.ts`, add the `EnemyRadar` import near the other `ui` imports (after the `HUD` import on line 16):

```ts
import { EnemyRadar } from '../ui/EnemyRadar';
```

Add `Enemy` to the existing type-only enemy import on line 60. Change:

```ts
import type { EnemyKind } from '../entities/Enemy';
```
to:
```ts
import { Enemy, type EnemyKind } from '../entities/Enemy';
```

Add the radar constants and `getUpgradeLevel` to the existing imports. Change the constants import group to include them (add the four names to the `from '../constants'` block opened at line 24), and change the SaveData import on line 15 to add `getUpgradeLevel`:

```ts
import { getPlayerConfig, PlayerConfig, getPlaced, updatePlacedMeta, removeExpiredPlaced, getUpgrades, getEffectiveControlMode, getJoystickSide, getUpgradeLevel } from '../systems/SaveData';
```

For the constants, add to the `from '../constants'` import block (the one starting at line 24):

```ts
  ENEMY_RADAR_BASE_RANGE_PX,
  ENEMY_RADAR_RANGE_PER_LEVEL,
```

- [ ] **Step 2: Add the field**

Next to `private hud!: HUD;` (line 70) add:

```ts
  private enemyRadar!: EnemyRadar;
```

- [ ] **Step 3: Construct the radar in create()**

Immediately after the HUD is constructed (the `this.hud = new HUD(...)` block ending around line 367+), add:

```ts
    const radarLevel = getUpgradeLevel('enemy_radar');
    const radarRange = ENEMY_RADAR_BASE_RANGE_PX * (1 + ENEMY_RADAR_RANGE_PER_LEVEL * radarLevel);
    this.enemyRadar = new EnemyRadar(this, radarRange);
```

- [ ] **Step 4: Call update() each frame**

In `update()`, immediately after the existing enemy-manager update block (lines 479–481):

```ts
    if (!this._playerDead) {
      this.enemyManager.update(camTop, camBottom, this.player.sprite.x, this.player.sprite.y);
    }
```

add:

```ts
    this.enemyRadar.update(
      cam,
      [this.enemyManager.group],
      this.player.sprite.x,
      this.player.sprite.y,
      this.player.worldWidth + this.player.wrapPadX,
    );
```

(`cam` is already declared above as `const cam = this.cameras.main;`.)

- [ ] **Step 5: Add the `_devRadarFixture` preview hook**

In the dev-preview block, extend the `initData` type (lines 392–394) to include the new flag:

```ts
    const initData = this.scene.settings.data as
      { _devOutro?: 'death' | 'success'; _devPickup?: string; _devRarity?: Rarity;
        _devDx?: number; _devDy?: number; _devHotbar?: 'few' | 'scroll' | 'empty';
        _devRadarFixture?: boolean } | undefined;
```

Then, after the `_devPickup` block (after line 408, before the `_devOutro` block), add a fixture that spawns deterministic off-screen enemies so the radar can be screenshotted:

```ts
    if (initData?._devRadarFixture) {
      const px = this.player.sprite.x;
      const py = this.player.sprite.y;
      // Fixed off-screen positions: above, below, far right, and the OPPOSITE
      // world edge (exercises the wrap arrow). new Enemy adds itself to the group.
      const spots = [
        { x: px,             y: py - 400 },              // above
        { x: px,             y: py + 400 },              // below
        { x: px + 450,       y: py },                    // far right (off-screen)
        { x: WORLD_WIDTH - 20, y: py },                  // opposite edge → wrap arrow
      ];
      for (const s of spots) {
        new Enemy(this, this.enemyManager.group, s.x, s.y, ENEMY_DEFS.percher);
      }
    }
```

- [ ] **Step 6: Verify build + deterministic screenshot**

Run: `npm run build`
Expected: PASS.

Run: `npm run scene-preview -- GameScene '{"_devRadarFixture":true}' pixel7`
Expected: a screenshot showing red arrows clamped to the screen edges — at minimum a top arrow, a bottom arrow, a right arrow, and a LEFT-edge arrow (the wrap indicator for the opposite-edge enemy). No arrow appears for any enemy currently on-screen.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(radar): wire Threat Radar into GameScene + dev fixture"
```

---

### Task 5: Wire radar into InfiniteGameScene

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts`

**Interfaces:**
- Consumes: `EnemyRadar`, radar constants, `getUpgradeLevel`.
- Produces: a live radar across all infinite-mode enemy columns.

- [ ] **Step 1: Add imports**

In `src/scenes/InfiniteGameScene.ts`, add the renderer import after the `HUD` import (line 20):

```ts
import { EnemyRadar } from '../ui/EnemyRadar';
```

Change the SaveData import (line 25) to add `getUpgradeLevel`:

```ts
import { getPlayerConfig, addBalance, getUpgrades, getEffectiveControlMode, getUpgradeLevel } from '../systems/SaveData';
```

Add the two radar constants to the `from '../constants'` import block (closing at line 52):

```ts
  ENEMY_RADAR_BASE_RANGE_PX,
  ENEMY_RADAR_RANGE_PER_LEVEL,
```

- [ ] **Step 2: Add the field**

Next to `private enemyManagers: EnemyManager[] = [];` (line 81) add:

```ts
  private enemyRadar!: EnemyRadar;
```

- [ ] **Step 3: Construct the radar in create()**

Immediately after the HUD is constructed (`this.hud = new HUD(...)` block starting at line 295), add:

```ts
    const radarLevel = getUpgradeLevel('enemy_radar');
    const radarRange = ENEMY_RADAR_BASE_RANGE_PX * (1 + ENEMY_RADAR_RANGE_PER_LEVEL * radarLevel);
    this.enemyRadar = new EnemyRadar(this, radarRange);
```

- [ ] **Step 4: Call update() each frame**

In `update()`, immediately after the enemy-manager loop (lines 402–407), add:

```ts
    this.enemyRadar.update(
      cam,
      this.enemyManagers.map(em => em.group),
      this.player.sprite.x,
      this.player.sprite.y,
      this.player.worldWidth + this.player.wrapPadX,
    );
```

(`cam` is already declared above as `const cam = this.cameras.main;` on line 380.)

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS.

Run: `npm test`
Expected: PASS — full suite green (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat(radar): wire Threat Radar into InfiniteGameScene"
```

---

## Self-Review

**Spec coverage:**
- Proximity-only trigger → `computeBlip` range filter (Task 1). ✓
- Edge arrow at clamped position → `computeBlip` clamp + angle, rendered in `EnemyRadar` (Tasks 1–2). ✓
- Uniform arrow (no per-type styling) → single `ARROW_KEY` texture (Task 2). ✓
- Both modes → GameScene (Task 4) + InfiniteGameScene (Task 5). ✓
- Wrap-aware → `wrapNearestX` + wrap test + opposite-edge fixture (Tasks 1, 4). ✓
- Upgrade-gated range, active at level 0, +10%/level, 3 levels → `enemy_radar` def + range computation (Tasks 3–5). ✓
- `worldView` staleness avoided → view built from scroll + size/zoom (Task 2, global constraint). ✓
- DPR-baked arrow → `ensureTexture` draws at `getDprCap()` (Task 2). ✓
- Deterministic preview → `_devRadarFixture` hook (Task 4). ✓

**Type consistency:** `RadarView`/`RadarOpts`/`Blip` and `selectBlips`/`computeBlip`/`wrapNearestX` signatures match between Task 1 (definition), the tests, and Task 2 (consumer). `EnemyRadar` constructor `(scene, rangePx)` and `update(camera, enemyGroups, playerX, playerY, wrapPeriod)` match the call sites in Tasks 4–5. `getUpgradeLevel('enemy_radar')` matches the `id` in Task 3.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code.
