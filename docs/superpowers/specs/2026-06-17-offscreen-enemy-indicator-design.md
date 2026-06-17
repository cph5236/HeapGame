# Off-Screen Enemy Indicator ("Threat Radar") — Design

**Date:** 2026-06-17
**Todo:** "Enemy off screen indicator — often when switching heap sides I run into an enemy"

## Problem

The main camera follows the player and is zoomed in (`zoom = getDprCap()`), so the
visible viewport is much narrower than the 960px-wide world. When the player crosses
to the other side of the heap — or **wraps** around the world edge — enemies on the
far side are off-screen until the player is right on top of them, causing unavoidable
hits.

## Goal

Render screen-edge arrows pointing toward nearby off-screen enemies, so the player
gets advance warning. Detection range is a purchasable upgrade.

## Decisions (from brainstorming)

- **Trigger scope:** nearby only — show arrows for off-screen enemies within a range
  threshold, not every active enemy.
- **Visual:** an arrow pinned to the screen edge closest to the enemy, positioned
  along that edge in the enemy's direction, rotated to point at it.
- **Type distinction:** none — one uniform arrow style for all enemy kinds.
- **Mode scope:** both `GameScene` and `InfiniteGameScene`.
- **Wrap-aware:** the world is a horizontal cylinder (with `SKY_INSET = 0`, the left
  pad edge `-wrapPadX` ≡ `x = worldWidth`). An enemy at the far edge must resolve to
  an arrow on the *near* edge — the direction the player travels to reach it via wrap.
- **Upgrade-gated range:** active at level 0 (base range for everyone); a 3-level
  "Threat Radar" upgrade adds +10% range per level.

## Architecture

Three pieces, mirroring existing project patterns (`hudLogic`/`HUD`,
`EnemySpawnMath`/`EnemyManager`):

### 1. `src/systems/enemyRadarMath.ts` — pure geometry (unit-tested)

No Phaser value import; operates on plain numbers/objects.

```ts
export interface RadarView { x: number; y: number; width: number; height: number; }
export interface RadarOpts { rangePx: number; marginPx: number; wrapPeriod: number; }
export interface Blip { x: number; y: number; angle: number; dist: number; }

/** Whichever of enemyX, enemyX±period is closest to playerX. The wrap trick:
 *  a far-edge enemy resolves to a ghost image just past the near edge. */
export function wrapNearestX(enemyX: number, playerX: number, period: number): number;

/** Returns a screen-space blip, or null if the enemy is on-screen OR beyond rangePx.
 *  Screen mapping: world→logical-screen is (wx - view.x, wy - view.y), because the
 *  main camera's zoom = DPRcap makes worldView dimensions equal the logical viewport.
 *  Position is clamped to a rect inset by marginPx; angle points from the clamped
 *  edge point toward the (wrapped) enemy position. */
export function computeBlip(
  enemyX: number, enemyY: number,
  playerX: number, playerY: number,
  view: RadarView, opts: RadarOpts,
): Blip | null;

/** Nearest `max` blips across all enemies (so a crowd never exceeds the arrow pool). */
export function selectBlips(
  enemies: Iterable<{ x: number; y: number }>,
  playerX: number, playerY: number,
  view: RadarView, opts: RadarOpts, max: number,
): Blip[];
```

**Key detail — wrap math:** `dx` for both the range check and the screen mapping uses
`wrapNearestX(...) - playerX`. `dy` is plain (no vertical wrap). On-screen test uses
the wrapped screen position against `[0, width] × [0, height]`. `dist = hypot(dx, dy)`.

### 2. `src/ui/EnemyRadar.ts` — HUD-style renderer

Same shape as `HUD`: constructed once, registered to the gameplay UI camera, refreshed
each frame.

- **Constructor `(scene, rangePx)`:** generates one small triangular arrow texture via
  `graphics.generateTexture(...)`, creates a fixed pool of `ENEMY_RADAR_MAX_ARROWS`
  arrow `Image`s — each `setScrollFactor(0)`, depth above world / with other HUD,
  initially hidden — and registers them via `addToGameplayUi(scene, parts)`. Stores
  `rangePx`.
- **`update(camera, enemyGroups, playerX, playerY, wrapPeriod)`:** gathers enemy
  positions from the passed `Phaser.Physics.Arcade.Group[]` (public groups only — no
  coupling to `EnemyManager` internals), builds a `RadarView` from
  `camera.worldView`, calls `selectBlips(...)`, then for each pool slot either
  positions+rotates+shows the matching blip or hides the slot. Reuses a scratch array
  to avoid per-frame allocation.

### 3. Upgrade integration

**`src/data/upgradeDefs.ts`** — append:

```ts
{
  id: 'enemy_radar',
  name: 'Threat Radar',
  description: (l) => `+${l * 10}% off-screen enemy detection range`,
  maxLevel: 3,
  cost: (l) => [300, 600, 1200][l - 1],   // designer-tunable
}
```

`UpgradeScene` auto-renders this (it maps over `UPGRADE_DEFS`); add an
`ACCENT_COLORS['enemy_radar']` entry in `UpgradeScene` so the row gets a themed color
instead of the gray fallback. Purchase + persistence flow through the existing
`purchaseUpgrade` / `getUpgradeLevel` with no changes.

### 4. Constants (`src/constants.ts`)

```ts
export const ENEMY_RADAR_BASE_RANGE_PX   = 600;   // detection radius at upgrade level 0
export const ENEMY_RADAR_RANGE_PER_LEVEL = 0.10;  // +10% per Threat Radar level
export const ENEMY_RADAR_MARGIN_PX       = 24;    // arrow inset from screen edge (logical px)
export const ENEMY_RADAR_MAX_ARROWS      = 8;     // arrow pool size
```

## Data flow / wiring

**GameScene** (`create()`):
```ts
const lvl   = getUpgradeLevel('enemy_radar');
const range = ENEMY_RADAR_BASE_RANGE_PX * (1 + ENEMY_RADAR_RANGE_PER_LEVEL * lvl);
this.enemyRadar = new EnemyRadar(this, range);
```
`update()`, next to `this.hud.update()`:
```ts
this.enemyRadar.update(
  this.cameras.main, [this.enemyManager.group],
  this.player.sprite.x, this.player.sprite.y,
  WORLD_WIDTH + this.player.wrapPadX,
);
```

**InfiniteGameScene:** identical, passing `this.enemyManagers.map(m => m.group)` and a
wrap period derived from its `INFINITE_*` bounds (`INFINITE_WORLD_WIDTH +
INFINITE_EDGE_PAD`).

## Testing

- **`enemyRadarMath` unit tests** (full coverage):
  - on-screen enemy → `null`
  - out-of-range enemy → `null`
  - each edge (left/right/top/bottom) → arrow clamped to that edge, correct angle
  - corner → clamped to corner
  - **wrap case:** enemy near `x = worldWidth`, player near `x = 0` → arrow on the
    LEFT edge (near side), within range, even though linear distance > range
  - `selectBlips` returns nearest N, capped at `max`
- **`EnemyRadar` / wiring:** `npm run build` (TS) + a `npm run scene-preview` screenshot
  with enemies positioned off-screen to confirm arrows render at the right edges.

## Out of scope (YAGNI)

- Per-type arrow styling / icons (decided uniform).
- Distance-based fade / pulsing (decided plain clamped arrow).
- Indicators for far (out-of-range) enemies.
