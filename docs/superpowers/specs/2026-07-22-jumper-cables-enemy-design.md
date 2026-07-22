# Jumper Cables — Wall Enemy Design

**Date:** 2026-07-22
**Status:** Approved design, ready for implementation plan
**Branch:** feature/player-suggestions-batch (or a fresh feature branch off main)

## Summary

A new enemy type, **Jumper Cables**, that mounts on **heap wall surfaces** (the
steep faces the player climbs). It idles harmlessly, then **lunges its clamp
outward** when the player comes near. Touching the **extended** clamp **stuns**
the player (knockback + brief loss of controls). Touching it while **retracted**
destroys it for score. This introduces a new **stun** mechanic to the game;
today enemies only kill (`handleEnemyDamage`) or get stomped (`handleStomp`).

Source todo: *"Jumper cables — spawn on walls and extend in and out slightly, if
player touches them, player stunned loses controls."*

## Goals

- A wall-mounted enemy that creates a timing/dodging challenge on the climb.
- Reuse the existing enemy pipeline (`EnemyDef` → `EnemyManager` → `Enemy` →
  GameScene overlaps) rather than a parallel system.
- Appear in **Normal heaps and Infinite mode** (not the tutorial).

## Non-goals

- No tutorial teaching step (tutorial is hand-scripted; out of scope).
- No new server-side score/validation model — Jumper kills route through the
  existing stomp scoring path.
- No dedicated electrocution sprite asset — the shock overlay is **procedural**
  (consistent with Heap's other code-drawn effects: bow strings, success star,
  revive cue).

## Assets

- Spritesheet: `src/sprites/Enemies/JumperCables/Jumper_Cables.png`, a 4×4 grid
  of **256×256** frames (1024×1024 total).
- Displayed at ~**72×72** in-world (much smaller than the source frame; the
  clamp occupies part of the frame).
- Loaded in `src/scenes/loadGameAssets.ts` via `scene.load.spritesheet` with
  `frameWidth: 256, frameHeight: 256`, texture key `jumper`.
- Animations (created alongside the rat/vulture anims in the same file):
  | Key               | Row | Frames | Meaning                              |
  |-------------------|-----|--------|--------------------------------------|
  | `jumper-idle-1`   | 0   | 0–3    | Retracted idle A                     |
  | `jumper-idle-2`   | 1   | 4–7    | Retracted idle B (sparks)            |
  | `jumper-attack-1` | 2   | 8–11   | Clamp extending / extended + sparks  |
  | `jumper-attack-2` | 3   | 12–15  | Clamp extended, alternate attack     |
  - Idle anims loop; attack anims play once per lunge (manager alternates which
    attack anim is used for variety).

## Orientation (wall facing)

The heap is a central mass; wall faces point **outward** (left face → open air on
the left; right face → open air on the right). The clamp must extend **into open
air**, away from the wall.

- Source art has the clamp base on the **left**, extending **right** — i.e. it is
  drawn for a wall whose open air is on the **right** (heap to its left).
- On a **left-facing** wall (open air on the left), the sprite is flipped
  horizontally (`setFlipX(true)`), and its body-box offsets mirror.
- The wall's outward direction is derived from the spawn edge's outward normal
  (open-air side), computed at spawn time.

## Behavior — state machine

Implemented as a new `kind === 'jumper'` branch in `EnemyManager.update()`,
mirroring the existing rat state machine. Runtime state lives in the same
`EnemyRuntime` map (extended with jumper fields).

States:

1. **`idle`** (armed, retracted) — alternates `jumper-idle-1` / `jumper-idle-2`
   every ~1000 ms. **Vulnerable.** Continuously checks player distance.
2. **`attacking`** (extended, hazard) — entered when the player is within
   **ATTACK_RANGE_PX ≈ 140** of the clamp. Plays an attack anim (clamp extends,
   sparks). The clamp is a **hazard for ~500 ms** (`ATTACK_ACTIVE_MS`).
   **Not vulnerable** during this window.
3. **`cooldown`** (disarmed, retracted) — after the attack window, retracts and
   plays **only `jumper-idle-1`** (never idle-2) for **COOLDOWN_MS ≈ 3000 ms** as
   a visual tell that it will not attack. **Vulnerable.** Does not re-trigger
   during cooldown even if the player is in range. On expiry → back to `idle`.

Notes:
- The distinct single-anim cooldown look is the player's cue that it's safe to
  brush past.
- Jumpers are stationary (no patrol velocity); only their animation/state change.

## Contact outcomes

Two Arcade overlaps registered in GameScene (in addition to the existing
stomp/damage overlaps), each gated by the jumper's current state via a
process callback:

- **Retracted contact** (`idle` or `cooldown`): the jumper is **defeated** — any
  direction of contact destroys it. Routes through the existing kill/stomp flow:
  `enemy-kill` SFX, score credited (`scoreValue`), player receives the stomp
  bounce + air-jump refund, `+score` marker. Score value: **150** (between rat
  100 and vulture 200).
- **Extended contact** (`attacking`): the player is **stunned** (see below).
  Respects `invincible` and shield/revive the same way `isDamaging` does — a
  shielded player absorbs it instead of being stunned.

State is read from the `EnemyRuntime` map (exposed to GameScene via a small
`EnemyManager.getJumperState(sprite)` accessor, or by tagging the sprite with a
`setData('vulnerable', boolean)` flag the manager keeps current — implementation
plan picks one; the data-flag approach keeps GameScene decoupled from runtime
internals and is preferred).

## Stun mechanic (new)

New `Player.stun(durationMs, knockback: {x, y})`:
- Applies **knockback**: velocity set outward from the wall (away from the clamp)
  plus a small upward component, so the player is knocked off the climb.
- Disables controls (`setControlsEnabled(false)`) for `durationMs` = **500 ms**.
  Gravity stays **on** (unlike `freeze()`), so the player falls/tumbles during
  the stun.
- Re-enables controls on a `scene.time.delayedCall` after `durationMs`. Guarded
  so overlapping stuns/death don't double-restore or restore a dead player.
- Sets a transient invincibility window (reuse `PLAYER_INVINCIBLE_MS`) so the
  same clamp can't immediately re-stun on the same extension.

GameScene `handleJumperStun` callback:
- Computes knockback direction from player-vs-clamp X.
- Calls `player.stun(...)`.
- Triggers the **procedural electrocution overlay** and a brief camera shake
  (`this.cameras.main.shake(...)`, small magnitude/short duration).

### Procedural electrocution overlay

- A short-lived effect drawn over the player sprite for the stun duration:
  jagged **yellow zap arcs** radiating around the player (a few randomized
  polylines redrawn a few times over the 500 ms) plus a **tint flicker**
  (player alternates white/yellow tint) — echoing the yellow spark motif in the
  Jumper sheet.
- Implemented as a self-contained helper (e.g. `playElectrocutionEffect(scene,
  sprite, durationMs)`) that owns its own `Graphics` + tween/timer and cleans
  itself up on completion. Depth above the player, below HUD.
- No asset dependency; matches existing procedural-effect conventions.

## Wall-spawn support

The spawn infrastructure already distinguishes surfaces vs walls
(`SURFACE_ANGLE_THRESHOLD`, `def.spawnOnHeapWall`), but two things need
wall-specific handling in `EnemyManager.trySpawn` / `onBandLoaded`:

1. **Interior rejection.** The current test `isPointInsidePolygon(x, y - 1)`
   checks the point *above* the spawn — correct for a surface (open air is up),
   **wrong for a wall** (open air is horizontal). For a wall edge, test a point
   offset **perpendicular to the wall face toward the outward normal**; reject
   only if that open-air point is inside the polygon.
2. **Spawn placement.** Seat the sprite slightly **off the wall face** in open
   air (offset along the outward normal by ~half the display width) and store
   the outward direction in runtime for knockback + flip.

Rat patrol-bounds logic is skipped for jumpers (stationary). Existing
`MIN_ENEMY_SPACING_PX` spacing still applies along the edge walk.

## EnemyDef / params

Add to `shared/enemyDefs.ts`:

```ts
export type EnemyKind = 'percher' | 'ghost' | 'jumper';

jumper: {
  kind: 'jumper',
  textureKey: 'jumper',
  width: 72,
  height: 72,
  speed: 0,                    // stationary
  bodyIdle:   { /* tight box around retracted clamp near the wall */ },
  bodyAttack: { /* wider box covering the extended clamp reach */ },
  spawnOnHeapSurface: false,
  spawnOnHeapWall: true,
  displayName: 'JUMPER CABLES',
  scoreValue: 150,
},
```

(Body box field naming: reuse `bodyIdle`; add a `bodyAttack` box, applied when
entering `attacking` and reverted on retract — same swap pattern as the rat's
walking/idle boxes.)

`DEFAULT_ENEMY_PARAMS.jumper` (offline/infinite fallback, mirrors the sentinel
`heap_parameters` row): begin a few thousand px above the floor with a moderate
chance, e.g.:

```ts
jumper: {
  spawnStartPxAboveFloor: 3000,
  spawnEndPxAboveFloor:  -1,
  spawnRampPxAboveFloor: 18000,
  spawnChanceMin: 0.10,
  spawnChanceMax: 0.30,
},
```

Per-heap tuning flows through the existing `HeapEnemyParams` mechanism; the
server-side default params row / admin UI gains a `jumper` entry (schema:
`HeapEnemyParams` is an open record keyed by `EnemyKind`, so this may need a
migration/seed update — the implementation plan checks whether a D1 migration is
required for the new key, following the `adding-d1-migrations` skill).

## Modes / integration points

- **GameScene** (normal heaps): register the two jumper overlaps; wire
  `handleJumperStun`.
- **InfiniteGameScene**: the per-column `EnemyManager`s already run the same
  update + overlap wiring; add the jumper overlaps there too.
- **TutorialScene**: unchanged (jumpers excluded).

## Testing

- **EnemySpawnMath / EnemyManager unit tests**: wall-edge classification, the new
  perpendicular interior-rejection for walls, jumper state transitions
  (idle→attacking on proximity, attacking→cooldown after active window,
  cooldown→idle after cooldown, no re-trigger during cooldown), vulnerability
  flag per state.
- **Stun logic**: `Player.stun` disables controls for the duration, keeps gravity
  on, restores controls after, respects death/overlap guards.
- **Contact routing**: retracted contact → defeat/score; extended contact →
  stun; shield absorbs extended contact.
- Pure helpers (state transition given time + distance) extracted so they're
  testable without a live Phaser scene, following the existing
  `EnemySpawnMath`/`enemyRadarMath` split.
- `npm run build` + `npm test` green; live smoke test via `smoke-testing-heap`
  (spawn on a wall, verify lunge, stun+knockback+shock overlay, cooldown tell,
  and retracted-defeat).

## Open tuning values (set during implementation/smoke)

- `ATTACK_RANGE_PX` (~140), `ATTACK_ACTIVE_MS` (~500), `COOLDOWN_MS` (~1200),
  idle alternation period (~2000 ms), display size (~72), body boxes, knockback
  magnitude, spawn chances, `scoreValue` (150).
