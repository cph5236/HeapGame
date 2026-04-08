# Mountain Climber Upgrade — Design Spec

**Date:** 2026-04-08  
**Status:** Approved

---

## Overview

Add a multi-level "Mountain Climber" upgrade that increases the maximum walkable slope angle. The base threshold is 35° (`MAX_WALKABLE_SLOPE_DEG`). Each purchased level raises the threshold by a configurable increment (price and increment set by the designer).

The upgrade takes effect at the start of a new run — not mid-session — consistent with how all other upgrades work (shop is between runs only).

---

## Architecture

The slope threshold is read once per session at scene startup and stored on `HeapEdgeCollider`. All slab classification during that session uses the stored value, so no mid-run rebuild is needed.

---

## Changes

### 1. `src/data/upgradeDefs.ts`

Add a new entry to `UPGRADE_DEFS`:

```ts
{
  id: 'mountain_climber',
  name: 'Mountain Climber',
  description: (l) => `Walk slopes up to ${MAX_WALKABLE_SLOPE_DEG + l * MOUNTAIN_CLIMBER_INCREMENT}°`,
  maxLevel: /* designer sets */,
  cost: (l) => /* designer sets */,
}
```

- `MAX_WALKABLE_SLOPE_DEG` imported from `../constants` for the description baseline.
- `MOUNTAIN_CLIMBER_INCREMENT` imported from `../constants` (new constant, see below).
- `maxLevel` and `cost` are left as placeholders for the designer.

### 2. `src/constants.ts`

Add one new constant:

```ts
export const MOUNTAIN_CLIMBER_INCREMENT = 0; // degrees per upgrade level — set by designer
```

Placeholder value `0` will be replaced by the designer. Centralizing it here keeps the description in `upgradeDefs` and the computation in `SaveData` in sync.

### 3. `src/systems/SaveData.ts`

Add `maxWalkableSlopeDeg: number` to `PlayerConfig`:

```ts
export interface PlayerConfig {
  // ... existing fields ...
  maxWalkableSlopeDeg: number;
}
```

Compute it in `getPlayerConfig()`:

```ts
maxWalkableSlopeDeg: MAX_WALKABLE_SLOPE_DEG + getUpgradeLevel('mountain_climber') * MOUNTAIN_CLIMBER_INCREMENT,
```

Imports `MAX_WALKABLE_SLOPE_DEG` and `MOUNTAIN_CLIMBER_INCREMENT` from `../constants`.

### 4. `src/systems/HeapEdgeCollider.ts`

Add `walkableSlopeDeg` to the constructor. Default to `MAX_WALKABLE_SLOPE_DEG` so any test or call site that omits it stays valid:

```ts
private readonly walkableSlopeDeg: number;

constructor(_scene: Phaser.Scene, walkableSlopeDeg = MAX_WALKABLE_SLOPE_DEG) {
  this.walkableSlopeDeg = walkableSlopeDeg;
}
```

In `buildSlabs`, replace both references to `MAX_WALKABLE_SLOPE_DEG` (lines 103–104) with `this.walkableSlopeDeg`.

### 5. `src/scenes/GameScene.ts`

`HeapEdgeCollider` is currently constructed at line 86, before `playerConfig` is assigned at line 118. Move the `edgeCollider` construction to after line 118 (after `getPlayerConfig()` is called), then pass the value:

```ts
this.edgeCollider = new HeapEdgeCollider(this, this.playerConfig.maxWalkableSlopeDeg);
```

No other changes to `GameScene` are needed — existing band build/rebuild calls go through the collider instance which already holds the correct threshold.

---

## Data Flow

```
getPlayerConfig()
  └─ getUpgradeLevel('mountain_climber') * MOUNTAIN_CLIMBER_INCREMENT + MAX_WALKABLE_SLOPE_DEG
       └─ PlayerConfig.maxWalkableSlopeDeg
            └─ new HeapEdgeCollider(scene, maxWalkableSlopeDeg)
                 └─ this.walkableSlopeDeg used in buildSlabs() per-row classification
```

---

## Out of Scope

- No mid-run collider rebuild when the upgrade is purchased (shop is between runs).
- No UI changes — the upgrade shop display is handled by the existing upgrade UI reading `upgradeDefs`.
- Price and per-level increment values are designer decisions, not part of this spec.

---

## Testing

- Existing `HeapEdgeCollider` tests pass without change (constructor default keeps `MAX_WALKABLE_SLOPE_DEG`).
- Add unit test: construct `HeapEdgeCollider` with a custom `walkableSlopeDeg` and verify that a row at that angle is classified as walkable rather than wall.
- Add unit test: `getPlayerConfig()` with `mountain_climber` level > 0 returns correct `maxWalkableSlopeDeg`.
