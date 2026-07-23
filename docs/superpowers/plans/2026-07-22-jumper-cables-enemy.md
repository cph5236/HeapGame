# Jumper Cables Enemy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a wall-mounted "Jumper Cables" enemy that lunges its clamp on player proximity — touching the extended clamp stuns the player (knockback + procedural shock overlay), touching it while retracted defeats it for score.

**Architecture:** New `'jumper'` `EnemyKind` reusing the existing enemy pipeline (`EnemyDef` → `EnemyManager` → `Enemy` → scene overlaps). A three-state machine (`idle` → `attacking` → `cooldown`) drives animation, a per-frame `vulnerable` data flag, and per-state collision boxes. Wall spawning is enabled by a new perpendicular open-air probe (the existing interior test only works for surfaces). A new `Player.stun()` method + a procedural electrocution effect implement the stun. Jumper kills are threaded through the server-authoritative score pipeline.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vite 6, Vitest. Cloudflare Worker (Hono + D1) for score validation.

## Global Constraints

- Branch off `main`; PR before merge, never push direct to main. (Work happens on `feature/jumper-cables-enemy`, already created off `main`.)
- `npm run build` must pass before claiming done (catches TS errors tests miss).
- `npm test` must stay green.
- Per-player server calls key on `getEffectivePlayerId()` — not relevant to new code here, but do not regress it.
- No git worktrees — regular feature branch in the main working dir.
- Enemy display/body values are in **unscaled texture-frame pixels**; Phaser scales them to display space (`setDisplaySize`). Jumper frames are **256×256**, displayed at **72×72** (scale ≈ 0.28125).
- Tunable constants (set now, refine in smoke): `ATTACK_RANGE_PX = 140`, `ATTACK_ACTIVE_MS = 500`, `COOLDOWN_MS = 3000`, `IDLE_ALT_MS = 1000`, `STUN_MS = 500`, `scoreValue = 150`.

---

## File Structure

**New files:**
- `src/entities/effects/electrocution.ts` — procedural shock overlay helper (self-contained Graphics + timer).

**Modified files:**
- `shared/enemyDefs.ts` — add `'jumper'` to `EnemyKind`, its `EnemyDef`, and `DEFAULT_ENEMY_PARAMS.jumper`.
- `src/systems/EnemySpawnMath.ts` — add `computeWallFace()` + `jumperNextState()` pure helpers and their types.
- `src/entities/Enemy.ts` — add `mirrorBodyBox()` helper + a `jumper` branch in the ctor.
- `src/systems/EnemyManager.ts` — merge default params; jumper spawn path (wall-face placement, runtime, `vulnerable` flag); jumper state-machine branch in `update()`.
- `src/scenes/loadGameAssets.ts` — load `jumper` spritesheet + register the four jumper anims.
- `src/entities/Player.ts` — add `stun(durationMs, knockback)` method + `isStunned` guard.
- `src/scenes/GameScene.ts` — exclude jumpers from generic stomp/damage; add jumper defeat + stun overlaps; `handleJumperStun`.
- `src/scenes/InfiniteGameScene.ts` — same overlap wiring as GameScene.
- `shared/scoreTypes.ts` — add `jumper` to `SubmitScoreInputs.kills`.
- `shared/buildRunScore.ts` — add `'jumper'` to the scored `kinds`.
- `server/src/routes/scores.ts` — validate + score `jumper` kills.
- `src/scenes/ScoreScene.ts` — send `jumper` count in the submit payload.

---

## Task 1: Add the `jumper` enemy definition

**Files:**
- Modify: `shared/enemyDefs.ts`
- Test: `shared/__tests__/enemyDefs.test.ts` (create if absent)

**Interfaces:**
- Produces: `EnemyKind` now includes `'jumper'`; `ENEMY_DEFS.jumper: EnemyDef`; `DEFAULT_ENEMY_PARAMS.jumper: EnemySpawnParams`. Body boxes `bodyIdle` / `bodyAttack` on the jumper def (texture pixels, default rightward orientation).

- [ ] **Step 1: Write the failing test**

Create/append `shared/__tests__/enemyDefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ENEMY_DEFS, DEFAULT_ENEMY_PARAMS } from '../enemyDefs';

describe('jumper enemy def', () => {
  it('is a wall-only enemy with the expected texture + score', () => {
    const d = ENEMY_DEFS.jumper;
    expect(d.kind).toBe('jumper');
    expect(d.textureKey).toBe('jumper');
    expect(d.spawnOnHeapWall).toBe(true);
    expect(d.spawnOnHeapSurface).toBe(false);
    expect(d.scoreValue).toBe(150);
    expect(d.displayName).toBe('JUMPER CABLES');
    expect(d.bodyIdle).toBeDefined();
    expect(d.bodyAttack).toBeDefined();
  });

  it('has default spawn params', () => {
    expect(DEFAULT_ENEMY_PARAMS.jumper.spawnStartPxAboveFloor).toBe(3000);
    expect(DEFAULT_ENEMY_PARAMS.jumper.spawnChanceMax).toBe(0.30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/__tests__/enemyDefs.test.ts`
Expected: FAIL — `ENEMY_DEFS.jumper` is undefined / type error.

- [ ] **Step 3: Implement**

In `shared/enemyDefs.ts`:

1. Extend the union:
```ts
export type EnemyKind = 'percher' | 'ghost' | 'jumper';
```

2. Add a `bodyAttack` field to the `EnemyDef` interface (next to `bodyIdle`):
```ts
  /** Extended-clamp body box for the jumper attack state. */
  bodyAttack?:  BodyBox;
```

3. Add the jumper entry to `ENEMY_DEFS` (after `ghost`):
```ts
  jumper: {
    kind: 'jumper',
    textureKey: 'jumper',
    width: 72,
    height: 72,
    speed: 0, // stationary; state machine drives animation only
    // 256×256 source frame, displayed at 72×72. Boxes are in texture pixels,
    // authored for the default rightward orientation (clamp base on the left).
    // Retracted: mount + clamp hugging the wall side of the frame.
    bodyIdle:   { width: 150, height: 150, offsetX: 30, offsetY: 55 },
    // Extended: clamp reaches further into open air (wider box).
    bodyAttack: { width: 210, height: 150, offsetX: 30, offsetY: 55 },
    spawnOnHeapSurface: false,
    spawnOnHeapWall: true,
    displayName: 'JUMPER CABLES',
    scoreValue: 150,
  },
```

4. Add the default params entry to `DEFAULT_ENEMY_PARAMS` (after `ghost`):
```ts
  jumper: {
    spawnStartPxAboveFloor: 3000,
    spawnEndPxAboveFloor: -1,
    spawnRampPxAboveFloor: 18000,
    spawnChanceMin: 0.10,
    spawnChanceMax: 0.30,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/__tests__/enemyDefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/enemyDefs.ts shared/__tests__/enemyDefs.test.ts
git commit -m "feat(enemy): add jumper EnemyKind def + default spawn params"
```

---

## Task 2: Wall-face + state-machine pure helpers

**Files:**
- Modify: `src/systems/EnemySpawnMath.ts`
- Test: `src/systems/__tests__/EnemySpawnMath.test.ts`

**Interfaces:**
- Consumes: `isPointInsidePolygon`, `Vertex`.
- Produces:
  - `type JumperState = 'idle' | 'attacking' | 'cooldown'`
  - `interface WallFace { outwardX: number; nx: number; ny: number }`
  - `computeWallFace(v1: Vertex, v2: Vertex, polygon: Vertex[], probe?: number): WallFace | null` — returns the outward (open-air) unit normal for a wall edge, or `null` if the edge is interior/degenerate (both sides inside or both outside the polygon).
  - `jumperNextState(state: JumperState, msInState: number, distToPlayer: number, cfg: { attackRangePx: number; attackActiveMs: number; cooldownMs: number }): JumperState`

- [ ] **Step 1: Write the failing tests**

Append to `src/systems/__tests__/EnemySpawnMath.test.ts`:

```ts
import { computeWallFace, jumperNextState } from '../EnemySpawnMath';

describe('computeWallFace', () => {
  // A square heap block from (0,0) to (100,100). Its right edge x=100 is a
  // wall whose open air is to the +x side.
  const square = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];

  it('returns +x outward for the right wall', () => {
    const face = computeWallFace({ x: 100, y: 0 }, { x: 100, y: 100 }, square, 6);
    expect(face).not.toBeNull();
    expect(face!.outwardX).toBe(1);
  });

  it('returns -x outward for the left wall', () => {
    const face = computeWallFace({ x: 0, y: 100 }, { x: 0, y: 0 }, square, 6);
    expect(face).not.toBeNull();
    expect(face!.outwardX).toBe(-1);
  });

  it('returns null for an edge with heap on both sides (interior)', () => {
    // A thin polygon where a probe of 6 from the edge midpoint lands inside on
    // both perpendicular sides: use a wide box and probe a vertical seam.
    const seam = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 },
    ];
    // The vertical segment x=100 from y=40..160 is fully interior — both
    // perpendicular probes (+x and -x) stay inside the box.
    const face = computeWallFace({ x: 100, y: 40 }, { x: 100, y: 160 }, seam, 6);
    expect(face).toBeNull();
  });
});

describe('jumperNextState', () => {
  const cfg = { attackRangePx: 140, attackActiveMs: 500, cooldownMs: 3000 };

  it('idle → attacking when player in range', () => {
    expect(jumperNextState('idle', 0, 100, cfg)).toBe('attacking');
  });
  it('idle stays idle when player out of range', () => {
    expect(jumperNextState('idle', 0, 200, cfg)).toBe('idle');
  });
  it('attacking → cooldown after active window', () => {
    expect(jumperNextState('attacking', 500, 50, cfg)).toBe('cooldown');
    expect(jumperNextState('attacking', 300, 50, cfg)).toBe('attacking');
  });
  it('cooldown → idle after cooldown, ignores proximity meanwhile', () => {
    expect(jumperNextState('cooldown', 100, 10, cfg)).toBe('cooldown');
    expect(jumperNextState('cooldown', 3000, 10, cfg)).toBe('idle');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/EnemySpawnMath.test.ts`
Expected: FAIL — `computeWallFace` / `jumperNextState` not exported.

- [ ] **Step 3: Implement**

Append to `src/systems/EnemySpawnMath.ts`:

```ts
export type JumperState = 'idle' | 'attacking' | 'cooldown';

export interface WallFace {
  /** Horizontal sign of the outward (open-air) direction: -1 or +1. */
  outwardX: number;
  /** Outward unit normal x component. */
  nx: number;
  /** Outward unit normal y component. */
  ny: number;
}

/**
 * For a wall edge v1→v2, find the open-air side by probing both perpendicular
 * normals against the polygon. Returns the outward face if exactly one side is
 * open air (a valid exterior wall); returns null when both probes land inside
 * (interior edge) or both outside (degenerate spur) — caller rejects the spawn.
 */
export function computeWallFace(
  v1: Vertex,
  v2: Vertex,
  polygon: Vertex[],
  probe = 6,
): WallFace | null {
  const midX = (v1.x + v2.x) / 2;
  const midY = (v1.y + v2.y) / 2;
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // one unit normal
  const ny = dx / len;
  const insideA = isPointInsidePolygon(midX + nx * probe, midY + ny * probe, polygon);
  const insideB = isPointInsidePolygon(midX - nx * probe, midY - ny * probe, polygon);
  if (insideA === insideB) return null; // both in or both out → not a clean wall
  const s = insideA ? -1 : 1; // outward = the side that is NOT inside
  const ox = nx * s;
  const oy = ny * s;
  return { outwardX: Math.sign(ox) || 1, nx: ox, ny: oy };
}

/**
 * Pure state transition for a Jumper Cable. `msInState` is time elapsed since
 * the current state was entered. Cooldown ignores proximity (the disarmed tell).
 */
export function jumperNextState(
  state: JumperState,
  msInState: number,
  distToPlayer: number,
  cfg: { attackRangePx: number; attackActiveMs: number; cooldownMs: number },
): JumperState {
  switch (state) {
    case 'idle':
      return distToPlayer <= cfg.attackRangePx ? 'attacking' : 'idle';
    case 'attacking':
      return msInState >= cfg.attackActiveMs ? 'cooldown' : 'attacking';
    case 'cooldown':
      return msInState >= cfg.cooldownMs ? 'idle' : 'cooldown';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/EnemySpawnMath.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/EnemySpawnMath.ts src/systems/__tests__/EnemySpawnMath.test.ts
git commit -m "feat(enemy): add computeWallFace + jumperNextState helpers"
```

---

## Task 3: `mirrorBodyBox` helper for flipped orientation

**Files:**
- Modify: `src/entities/Enemy.ts`
- Test: `src/entities/__tests__/Enemy.test.ts` (create if absent)

**Interfaces:**
- Consumes: `BodyBox` from `../data/enemyDefs`.
- Produces: `mirrorBodyBox(box: BodyBox, frameWidth: number): BodyBox` — mirrors a body box horizontally within a frame (for `setFlipX(true)` sprites). `offsetX' = frameWidth - offsetX - width`; other fields unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/entities/__tests__/Enemy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mirrorBodyBox } from '../Enemy';

describe('mirrorBodyBox', () => {
  it('mirrors offsetX within the frame, keeps other dims', () => {
    const m = mirrorBodyBox({ width: 210, height: 150, offsetX: 30, offsetY: 55 }, 256);
    expect(m).toEqual({ width: 210, height: 150, offsetX: 256 - 30 - 210, offsetY: 55 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/entities/__tests__/Enemy.test.ts`
Expected: FAIL — `mirrorBodyBox` not exported.

- [ ] **Step 3: Implement**

In `src/entities/Enemy.ts`, after `applyBodyBox`:

```ts
/** Mirror a body box horizontally within a frame, for setFlipX(true) sprites. */
export function mirrorBodyBox(box: BodyBox, frameWidth: number): BodyBox {
  return {
    width:   box.width,
    height:  box.height,
    offsetX: frameWidth - box.offsetX - box.width,
    offsetY: box.offsetY,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/entities/__tests__/Enemy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/Enemy.ts src/entities/__tests__/Enemy.test.ts
git commit -m "feat(enemy): add mirrorBodyBox helper for flipped body boxes"
```

---

## Task 4: Enemy constructor `jumper` branch

**Files:**
- Modify: `src/entities/Enemy.ts:42-54` (the `if (def.kind === 'percher') … else …` block)

**Interfaces:**
- Consumes: `ENEMY_DEFS.jumper` (Task 1), `applyBodyBox`.
- Produces: constructing an `Enemy` with a `jumper` def yields a stationary, gravity-free sprite playing `jumper-idle-1` with `bodyIdle` applied. Orientation/state overrides happen later in `EnemyManager.trySpawn` (Task 5).

- [ ] **Step 1: Change the ctor branch**

Replace the `if (def.kind === 'percher') { … } else { … }` block in the constructor with an explicit three-way branch:

```ts
    if (def.kind === 'percher') {
      // Rat starts walking-right (see velocity below) — apply that body box.
      if (def.bodyWalking) applyBodyBox(this.sprite.body, def.bodyWalking);
      this.sprite.setImmovable(true);
      this.sprite.setData('speed', def.speed);
      this.sprite.setVelocityX(def.speed); // start walking right; state machine takes over
      this.sprite.play('rat-walk-right');
    } else if (def.kind === 'jumper') {
      // Wall-mounted, stationary. EnemyManager.trySpawn sets flip + state.
      if (def.bodyIdle) applyBodyBox(this.sprite.body, def.bodyIdle);
      this.sprite.setImmovable(true);
      this.sprite.setData('speed', 0);
      this.sprite.setData('vulnerable', true); // retracted = defeatable
      this.sprite.play('jumper-idle-1');
    } else {
      // Ghost (vulture): patrol left→right — direction flipped in EnemyManager.update()
      this.sprite.setVelocityX(-def.speed); // start moving left
      this.sprite.setData('speed', def.speed);
      this.sprite.play('vulture-fly-left');
    }
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: PASS (no TS errors). Playing an animation that isn't registered yet is a runtime no-op in tests, not a compile error; the anim is registered in Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/entities/Enemy.ts
git commit -m "feat(enemy): jumper branch in Enemy constructor (stationary, idle-1)"
```

---

## Task 5: Jumper spawn path in EnemyManager

**Files:**
- Modify: `src/systems/EnemyManager.ts`

**Interfaces:**
- Consumes: `computeWallFace`, `jumperNextState`, `WallFace`, `JumperState` (Task 2); `mirrorBodyBox` (Task 3); `ENEMY_DEFS.jumper`, `DEFAULT_ENEMY_PARAMS` (Task 1).
- Produces:
  - `setEnemyParams` merges over `DEFAULT_ENEMY_PARAMS` so every kind (incl. jumper) has a fallback.
  - `EnemyRuntime` gains jumper fields: `jumperState?`, `stateSince?`, `outwardX?`, `idleAltAt?`, `idleShowing2?`, `attackToggle?`.
  - `trySpawn` accepts an optional `wallFace?: WallFace` param; when spawning a wall enemy it uses the face for interior rejection, off-wall placement, flip, and mirrored body box.
  - `onBandLoaded` computes `computeWallFace` for wall edges and passes it to `trySpawn`.

> **No unit test for this task.** `EnemyManager.test.ts` deliberately tests only the pure math via the barrel re-export — it never constructs a live `EnemyManager` (that needs a real Phaser scene). The logic here is composed entirely of helpers already unit-tested in Task 2 (`computeWallFace`, `jumperNextState`) and Task 3 (`mirrorBodyBox`); the param merge is a trivial object spread. This task is verified by `npm run build` plus the live smoke test in Task 13. Do **not** add a scene-mocked manager test — it would diverge from the file's established pure-math convention.

- [ ] **Step 1: Implement the param merge**

In `EnemyManager.ts`, import the default and update `setEnemyParams`:

```ts
import { ENEMY_DEFS, EnemyDef, DEFAULT_ENEMY_PARAMS } from '../data/enemyDefs';
```

```ts
  setEnemyParams(params: HeapEnemyParams): void {
    // Merge over defaults so newly-added kinds (e.g. jumper) spawn on heaps
    // whose stored enemy_params predate them. Per-heap keys still override.
    this._enemyParams = { ...DEFAULT_ENEMY_PARAMS, ...params };
  }
```

Add the re-export for the new helpers (extend the existing re-export line at the top of the file):

```ts
import {
  isPointInsidePolygon,
  computeSurfaceAngle,
  spawnChance,
  scaleSpawnChance,
  computeGhostFlip,
  insetPatrolBounds,
  shouldPatrol,
  computeWallFace,
  jumperNextState,
  type WallFace,
  type JumperState,
} from './EnemySpawnMath';

export { isPointInsidePolygon, computeSurfaceAngle, spawnChance, scaleSpawnChance, computeGhostFlip, insetPatrolBounds, shouldPatrol, computeWallFace, jumperNextState };
```

- [ ] **Step 2: Extend `EnemyRuntime` and jumper constants**

Add constants near the other module constants (after `MIN_ENEMY_SPACING_PX`):

```ts
const JUMPER_ATTACK_RANGE_PX = 140;
const JUMPER_ATTACK_ACTIVE_MS = 500;
const JUMPER_COOLDOWN_MS = 3000;
const JUMPER_IDLE_ALT_MS = 1000;
const JUMPER_FRAME_W = 256; // texture-frame width, for body-box mirroring
const JUMPER_WALL_GAP_PX = 6; // extra px off the wall face, texture-space independent (world px)
```

Extend `EnemyKind` usages and the `EnemyRuntime` interface:

```ts
interface EnemyRuntime {
  kind: 'percher' | 'ghost' | 'jumper';
  speed: number;
  // Percher (rat) only:
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  ratState?: RatStateName;
  idleUntil?: number;
  // Jumper only:
  jumperState?: JumperState;
  stateSince?: number;   // scene.time.now when the current jumperState was entered
  outwardX?: number;     // -1 or +1: open-air direction (flip + knockback)
  idleAltAt?: number;    // next time to toggle idle-1/idle-2 while idle
  idleShowing2?: boolean;
  attackToggle?: boolean; // alternate attack-1/attack-2 for variety
}
```

- [ ] **Step 3: Compute wall face in `onBandLoaded`**

Inside the edge loop in `onBandLoaded`, after `const angle = computeSurfaceAngle(v1, v2);` compute the wall face when the edge is a wall, and pass it through. Change the `trySpawn` call to include it:

```ts
      const isWallEdge = angle >= SURFACE_ANGLE_THRESHOLD;
      const wallFace = isWallEdge
        ? computeWallFace(v1, v2, this.heapPolygon.length > 0 ? this.heapPolygon : vertices)
        : undefined;
      for (const def of Object.values(ENEMY_DEFS)) {
        if (spawned >= maxEnemies) break;
        if (this.trySpawn(def, spawnX, spawnY, angle, minX, maxX, minY, maxY, wallFace)) {
          spawned++;
          lastSpawnX = spawnX;
        }
      }
```

(`onPlatformSpawned` spawns on flat platform tops only — jumpers are wall-only, so it passes no `wallFace`; jumpers will be rejected there by the surface/wall check. No change needed there beyond the new optional arg defaulting to `undefined`.)

- [ ] **Step 4: Extend `trySpawn` for the wall path**

Change the signature and the interior-rejection + spawn logic:

```ts
  private trySpawn(
    def: EnemyDef,
    x: number,
    y: number,
    surfaceAngle: number,
    minX?: number,
    maxX?: number,
    minY?: number,
    maxY?: number,
    wallFace?: WallFace,
  ): boolean {
    const isSurface = surfaceAngle < SURFACE_ANGLE_THRESHOLD;
    const isWall    = surfaceAngle >= SURFACE_ANGLE_THRESHOLD;

    if (def.spawnOnHeapSurface && !isSurface) return false;
    if (def.spawnOnHeapWall    && !isWall)    return false;
    if (!def.spawnOnHeapSurface && !def.spawnOnHeapWall) return false;

    if (isWall) {
      // Wall enemies need a resolved open-air face; the surface "point above"
      // interior test does not apply (open air is horizontal, not up).
      if (!wallFace) return false;
    } else {
      // Surface: reject interior edges (heap continues above the surface).
      if (this.heapPolygon.length > 0 && isPointInsidePolygon(x, y - 1, this.heapPolygon)) return false;
    }

    const spawnParams = this._enemyParams[def.kind];
    if (!spawnParams) return false;
    const pxAboveFloor = this._worldHeight - y;
    const rawChance = spawnChance(spawnParams, pxAboveFloor);
    if (rawChance === null) return false;
    const chance = scaleSpawnChance(rawChance, this._spawnRateMult);
    if (Math.random() >= chance) return false;

    // Placement: surface enemies sit centered above the edge; wall enemies sit
    // just off the wall face in open air, at the edge midpoint height.
    let spawnX = x;
    let spawnY = y - def.height / 2;
    if (isWall && wallFace) {
      const offset = def.width / 2 + JUMPER_WALL_GAP_PX;
      spawnX = x + wallFace.nx * offset;
      spawnY = y + wallFace.ny * offset; // y here is the edge midpoint top; nudge along normal
    }

    const enemy = new Enemy(this.scene, this.group, spawnX, spawnY, def);

    const rt: EnemyRuntime = {
      kind: def.kind as 'percher' | 'ghost' | 'jumper',
      speed: def.speed,
    };

    if (def.kind === 'percher' && minX !== undefined && maxX !== undefined) {
      // (unchanged rat block — keep exactly as it is today)
      const halfH = def.height / 2;
      rt.minX = minX;
      rt.maxX = maxX;
      rt.minY = (minY ?? spawnY + halfH) - halfH;
      rt.maxY = (maxY ?? spawnY + halfH) - halfH;
      if (shouldPatrol(minX, maxX, RAT_MIN_PATROL_PX)) {
        rt.ratState = 'walk-right';
        rt.idleUntil = 0;
      } else {
        rt.ratState = 'stationary';
        const body = enemy.sprite.body as Phaser.Physics.Arcade.Body;
        body.setVelocityX(0);
        enemy.sprite.play('rat-idle');
        const idleBox = ENEMY_DEFS.percher.bodyIdle;
        if (idleBox) applyBodyBox(body, idleBox);
      }
    } else if (def.kind === 'jumper' && wallFace) {
      rt.jumperState = 'idle';
      rt.stateSince = this.scene.time.now;
      rt.outwardX = wallFace.outwardX;
      rt.idleAltAt = this.scene.time.now + JUMPER_IDLE_ALT_MS;
      rt.idleShowing2 = false;
      rt.attackToggle = false;
      // Flip to face open air; mirror the idle body box when flipped.
      if (wallFace.outwardX < 0) {
        enemy.sprite.setFlipX(true);
        const body = enemy.sprite.body as Phaser.Physics.Arcade.Body;
        if (def.bodyIdle) applyBodyBox(body, mirrorBodyBox(def.bodyIdle, JUMPER_FRAME_W));
      }
    }

    this.runtime.set(enemy.sprite, rt);
    enemy.sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.runtime.delete(enemy.sprite);
    });
    return true;
  }
```

Add the `mirrorBodyBox` import:

```ts
import { Enemy, applyBodyBox, mirrorBodyBox } from '../entities/Enemy';
```

- [ ] **Step 5: Run the helper tests (regression)**

Run: `npx vitest run src/systems/__tests__/EnemySpawnMath.test.ts src/systems/__tests__/EnemyManager.test.ts`
Expected: PASS (the pure helpers this task composes are covered; the manager file re-runs them via the barrel export).

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/systems/EnemyManager.ts
git commit -m "feat(enemy): jumper wall-spawn path + default-params merge"
```

---

## Task 6: Load jumper spritesheet + register animations

**Files:**
- Modify: `src/scenes/loadGameAssets.ts`

**Interfaces:**
- Produces: texture key `jumper` (256×256 frames) and anims `jumper-idle-1`, `jumper-idle-2`, `jumper-attack-1`, `jumper-attack-2`.

- [ ] **Step 1: Add the import**

Near the other enemy sprite imports (`ratUrl`, `vultureFly*Url`):

```ts
import jumperUrl from '../sprites/Enemies/JumperCables/Jumper_Cables.png?url';
```

- [ ] **Step 2: Load the spritesheet**

In the "Enemy spritesheets" block, after the `rat` load:

```ts
  scene.load.spritesheet('jumper', jumperUrl, { frameWidth: 256, frameHeight: 256 });
```

- [ ] **Step 3: Register the anims**

In the `Phaser.Loader.Events.COMPLETE` handler, after the vulture anims:

```ts
    scene.anims.create({ key: 'jumper-idle-1',   frames: scene.anims.generateFrameNumbers('jumper', { start: 0,  end: 3  }), frameRate: 6,  repeat: -1 });
    scene.anims.create({ key: 'jumper-idle-2',   frames: scene.anims.generateFrameNumbers('jumper', { start: 4,  end: 7  }), frameRate: 6,  repeat: -1 });
    scene.anims.create({ key: 'jumper-attack-1', frames: scene.anims.generateFrameNumbers('jumper', { start: 8,  end: 11 }), frameRate: 12, repeat: 0  });
    scene.anims.create({ key: 'jumper-attack-2', frames: scene.anims.generateFrameNumbers('jumper', { start: 12, end: 15 }), frameRate: 12, repeat: 0  });
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/loadGameAssets.ts
git commit -m "feat(enemy): load jumper spritesheet + register idle/attack anims"
```

---

## Task 7: Jumper state machine in EnemyManager.update

**Files:**
- Modify: `src/systems/EnemyManager.ts` (the `update()` per-child loop, after the `else if (rt.kind === 'ghost')` branch)

**Interfaces:**
- Consumes: `jumperNextState`, jumper constants, `mirrorBodyBox`, `ENEMY_DEFS.jumper` body boxes; `playerX`, `playerY` (already parameters of `update`).
- Produces: each jumper sprite's animation, `setData('vulnerable', …)`, and body box track its state every frame. Vulnerable ⇔ state ≠ `'attacking'`.

- [ ] **Step 1: Add the jumper branch**

In `update()`, extend the per-child conditional (add after the ghost branch, before the loop's closing brace):

```ts
      } else if (rt.kind === 'jumper') {
        const body = s.body as Phaser.Physics.Arcade.Body;
        const dx = s.x - playerX;
        const dy = s.y - playerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const prev = rt.jumperState ?? 'idle';
        const msInState = now - (rt.stateSince ?? now);
        const next = jumperNextState(prev, msInState, dist, {
          attackRangePx: JUMPER_ATTACK_RANGE_PX,
          attackActiveMs: JUMPER_ATTACK_ACTIVE_MS,
          cooldownMs: JUMPER_COOLDOWN_MS,
        });

        const flipped = rt.outwardX !== undefined && rt.outwardX < 0;
        const idleBox   = ENEMY_DEFS.jumper.bodyIdle!;
        const attackBox = ENEMY_DEFS.jumper.bodyAttack!;
        const boxFor = (b: typeof idleBox) => (flipped ? mirrorBodyBox(b, JUMPER_FRAME_W) : b);

        if (next !== prev) {
          rt.jumperState = next;
          rt.stateSince = now;
          if (next === 'attacking') {
            const key = rt.attackToggle ? 'jumper-attack-2' : 'jumper-attack-1';
            rt.attackToggle = !rt.attackToggle;
            s.play(key);
            applyBodyBox(body, boxFor(attackBox));
            s.setData('vulnerable', false);
          } else if (next === 'cooldown') {
            // Disarmed tell: idle-1 only.
            s.play('jumper-idle-1');
            rt.idleShowing2 = false;
            applyBodyBox(body, boxFor(idleBox));
            s.setData('vulnerable', true);
          } else {
            // back to idle (armed)
            s.play('jumper-idle-1');
            rt.idleShowing2 = false;
            rt.idleAltAt = now + JUMPER_IDLE_ALT_MS;
            applyBodyBox(body, boxFor(idleBox));
            s.setData('vulnerable', true);
          }
        } else if (next === 'idle' && now >= (rt.idleAltAt ?? 0)) {
          // Alternate idle-1/idle-2 while armed.
          rt.idleShowing2 = !rt.idleShowing2;
          s.play(rt.idleShowing2 ? 'jumper-idle-2' : 'jumper-idle-1');
          rt.idleAltAt = now + JUMPER_IDLE_ALT_MS;
        }
      }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Run the enemy tests (regression)**

Run: `npx vitest run src/systems/__tests__/EnemyManager.test.ts src/systems/__tests__/EnemySpawnMath.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/systems/EnemyManager.ts
git commit -m "feat(enemy): jumper state machine (idle/attack/cooldown) in update"
```

---

## Task 8: `Player.stun()` method

**Files:**
- Modify: `src/entities/Player.ts`
- Test: `src/entities/__tests__/Player.test.ts` (append; create if absent, using the existing Player test harness/mocks in that dir if present)

**Interfaces:**
- Produces: `stun(durationMs: number, knockback: { x: number; y: number }): void` and `get isStunned(): boolean`. During a stun, controls are disabled but gravity stays ON (unlike `freeze()`), so the player falls. Controls auto-restore after `durationMs` unless the player was frozen/killed in the meantime.

- [ ] **Step 1: Write the failing test**

The existing `src/entities/__tests__/Player.test.ts` already has an async `makePlayer()` helper returning `{ player, sprite, spy }`, where `sprite.scene` is the mock scene (see `makeScene`) and `sprite.setVelocity`/`body.setAllowGravity` are spies. `Player.stun` will schedule its restore via `this.sprite.scene.time.delayedCall`, but the mock scene has no `time` — inject a capturing one in the test. Append:

```ts
it('stun disables controls, keeps gravity on, applies knockback, restores after duration', async () => {
  const { player, sprite, spy } = await makePlayer({ onGround: true });
  const timers: Array<{ ms: number; cb: () => void }> = [];
  sprite.scene.time = { delayedCall: (ms: number, cb: () => void) => { timers.push({ ms, cb }); return {}; } };

  player.stun(500, { x: 280, y: -180 });

  expect(player.isStunned).toBe(true);
  // gravity stays ON during a stun (unlike freeze) — setAllowGravity(true) called
  expect(sprite.body.setAllowGravity).toHaveBeenLastCalledWith(true);
  // knockback applied via setVelocity(x, y)
  expect(spy.setVelocityX[spy.setVelocityX.length - 1]).toBe(280);
  expect(spy.setVelocityY[spy.setVelocityY.length - 1]).toBe(-180);

  // fire the captured restore timer
  expect(timers).toHaveLength(1);
  timers[0].cb();
  expect(player.isStunned).toBe(false);
});
```

> `spy.setVelocityX`/`setVelocityY` are the same arrays `setVelocity(x, y)` pushes to (see `makeSprite`). `sprite.body.setAllowGravity` is a `vi.fn()` in the mock. If TypeScript complains about assigning `sprite.scene.time`, cast: `(sprite.scene as any).time = …`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/entities/__tests__/Player.test.ts`
Expected: FAIL — `stun` / `isStunned` not defined.

- [ ] **Step 3: Implement**

Add a field near the other private flags (`_frozen` area, ~line 136):

```ts
  private _stunned = false;
```

Add near the HUD accessors:

```ts
  get isStunned(): boolean { return this._stunned; }
```

Update the controls gate in `update()` (line 205) so a stun also blocks input (it already does via `setControlsEnabled(false)`, but keep gravity flowing — no change needed there because `freeze()` is what disables gravity, not the controls gate). Then add the method near `freeze()`:

```ts
  /**
   * Temporarily disable controls with an outward knockback, keeping gravity on
   * so the player is knocked off the climb and falls. Distinct from freeze(),
   * which halts physics entirely. No-op if already frozen/dead.
   */
  stun(durationMs: number, knockback: { x: number; y: number }): void {
    if (this._frozen) return;
    this._stunned = true;
    this.setControlsEnabled(false);
    this.sprite.body.setAllowGravity(true);
    this.sprite.setVelocity(knockback.x, knockback.y);
    // Player stores no `scene` field; the sprite carries a `.scene` back-ref.
    this.sprite.scene.time.delayedCall(durationMs, () => {
      // Don't re-enable if a freeze/death took over during the stun.
      if (this._frozen) { this._stunned = false; return; }
      this._stunned = false;
      this.setControlsEnabled(true);
    });
  }
```

> `Player` does not keep a `this.scene` field (the constructor uses `scene` for setup only). Phaser sets `.scene` on every GameObject, so `this.sprite.scene` is the correct handle for scheduling — matching what the mock injects in the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/entities/__tests__/Player.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/entities/Player.ts src/entities/__tests__/Player.test.ts
git commit -m "feat(player): add stun() — knockback + timed control loss, gravity on"
```

---

## Task 9: Procedural electrocution effect

**Files:**
- Create: `src/entities/effects/electrocution.ts`

**Interfaces:**
- Produces: `playElectrocutionEffect(scene: Phaser.Scene, target: Phaser.GameObjects.Sprite, durationMs: number): void` — draws jagged yellow zap arcs around the target and flickers its tint for `durationMs`, then cleans up all objects/timers and clears the tint.

- [ ] **Step 1: Implement the helper**

```ts
// src/entities/effects/electrocution.ts
import Phaser from 'phaser';

const ARC_COLOR = 0xffe23a;
const REDRAW_MS = 60; // how often to re-randomize the arcs

/**
 * Procedural electrocution overlay: a few randomized zap polylines around the
 * target plus a white/yellow tint flicker, for durationMs. Self-cleaning.
 */
export function playElectrocutionEffect(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Sprite,
  durationMs: number,
): void {
  const g = scene.add.graphics().setDepth((target.depth ?? 0) + 1);

  const draw = (): void => {
    g.clear();
    const cx = target.x;
    const cy = target.y;
    const r = Math.max(target.displayWidth, target.displayHeight) * 0.6;
    g.lineStyle(2, ARC_COLOR, 0.9);
    for (let a = 0; a < 4; a++) {
      const baseAngle = (a / 4) * Math.PI * 2 + Math.random() * 0.6;
      g.beginPath();
      let px = cx;
      let py = cy;
      g.moveTo(px, py);
      const segs = 4;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const jitter = (Math.random() - 0.5) * r * 0.5;
        px = cx + Math.cos(baseAngle) * r * t + Math.cos(baseAngle + Math.PI / 2) * jitter;
        py = cy + Math.sin(baseAngle) * r * t + Math.sin(baseAngle + Math.PI / 2) * jitter;
        g.lineTo(px, py);
      }
      g.strokePath();
    }
  };

  draw();
  let flip = false;
  const redraw = scene.time.addEvent({
    delay: REDRAW_MS,
    loop: true,
    callback: () => {
      draw();
      flip = !flip;
      if (flip) target.setTint(0xffffff);
      else target.setTint(ARC_COLOR);
    },
  });

  scene.time.delayedCall(durationMs, () => {
    redraw.remove();
    g.destroy();
    target.clearTint();
  });
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/entities/effects/electrocution.ts
git commit -m "feat(fx): procedural electrocution overlay helper"
```

---

## Task 10: Wire jumper contact into GameScene

**Files:**
- Modify: `src/scenes/GameScene.ts` (overlap registration ~310-321; `isStomping`/`isDamaging` ~750-764; add handlers)

**Interfaces:**
- Consumes: `playElectrocutionEffect` (Task 9); `Player.stun` (Task 8); sprite `getData('kind')` / `getData('vulnerable')`.
- Produces: jumpers route through defeat (reuses `handleStomp`) when vulnerable and through a new `handleJumperStun` when extended; generic stomp/damage skip jumpers.

- [ ] **Step 1: Add jumper helpers + guards**

Add an import:

```ts
import { playElectrocutionEffect } from '../entities/effects/electrocution';
```

Add small predicates near `isStomping` (a jumper sprite is identified by `getData('kind') === 'jumper'`; `getData('vulnerable')` is kept current by the manager):

```ts
  private readonly isJumper = (e: Phaser.GameObjects.GameObject): boolean =>
    (e as Phaser.GameObjects.Sprite).getData('kind') === 'jumper';

  private readonly isJumperVulnerable = (e: Phaser.GameObjects.GameObject): boolean =>
    (e as Phaser.GameObjects.Sprite).getData('vulnerable') === true;
```

- [ ] **Step 2: Exclude jumpers from generic stomp/damage**

Update `isStomping` and `isDamaging` so jumpers never route through the generic paths:

```ts
  private readonly isStomping = (
    player: Phaser.GameObjects.GameObject,
    enemy: Phaser.GameObjects.GameObject,
  ): boolean => {
    if (this.isJumper(enemy)) return false;
    const p = player as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    const e = enemy as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    return p.body.velocity.y > 0 && p.body.center.y < e.body.center.y;
  };

  private readonly isDamaging = (
    player: Phaser.GameObjects.GameObject,
    enemy: Phaser.GameObjects.GameObject,
  ): boolean => {
    if (this.isJumper(enemy)) return false;
    return !this.invincible && !this.isStomping(player, enemy);
  };
```

- [ ] **Step 3: Register two jumper overlaps**

After the existing two enemy overlaps (~321), add:

```ts
    // Jumper Cables: retracted contact defeats it (reuse the stomp flow);
    // extended contact stuns the player.
    this.physics.add.overlap(
      this.player.sprite, this.enemyManager.group,
      this.handleStomp as unknown as ArcadeCB,
      ((_p: Phaser.GameObjects.GameObject, e: Phaser.GameObjects.GameObject) =>
        this.isJumper(e) && this.isJumperVulnerable(e)) as unknown as ArcadeCB,
      this,
    );
    this.physics.add.overlap(
      this.player.sprite, this.enemyManager.group,
      this.handleJumperStun as unknown as ArcadeCB,
      ((_p: Phaser.GameObjects.GameObject, e: Phaser.GameObjects.GameObject) =>
        this.isJumper(e) && !this.isJumperVulnerable(e) && !this.invincible) as unknown as ArcadeCB,
      this,
    );
```

- [ ] **Step 4: Add `handleJumperStun`**

Add near `handleEnemyDamage`:

```ts
  private readonly handleJumperStun = (
    _player: Phaser.GameObjects.GameObject,
    enemy: Phaser.GameObjects.GameObject,
  ): void => {
    // Shield absorbs the shock like any hit.
    if (this.player.hasActiveShield) {
      this.player.absorbHit();
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }
    if (this._playerDead || this.blockPlaced || this.invincible) return;

    const e = enemy as Phaser.Physics.Arcade.Sprite;
    const dir = Math.sign(this.player.sprite.x - e.x) || 1; // knock away from clamp
    AudioManager.play('enemy-kill'); // reuse existing zap-ish cue; swap later if a dedicated SFX is added
    this.player.stun(500, { x: dir * 280, y: -180 });
    playElectrocutionEffect(this, this.player.sprite, 500);
    this.cameras.main.shake(180, 0.008);

    this.invincible = true;
    this.time.delayedCall(PLAYER_INVINCIBLE_MS, () => { this.invincible = false; });
  };
```

> `AudioManager.play('enemy-kill')` is a placeholder cue so the stun is audible; a dedicated shock SFX is out of scope (no asset). Leave a `// TODO` only if the team wants one — do not invent a missing sound key.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(enemy): wire jumper defeat + stun contact in GameScene"
```

---

## Task 11: Wire jumper contact into InfiniteGameScene

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts` (overlap loop ~316-329; `isStomping`/`isDamaging` ~669-681; add handlers)

**Interfaces:**
- Same as Task 10, adapted to the per-`EnemyManager` overlap loop and `this.debugNoclip` guard used in this scene.

- [ ] **Step 1: Add import + predicates**

```ts
import { playElectrocutionEffect } from '../entities/effects/electrocution';
```

```ts
  private readonly isJumper = (e: Phaser.GameObjects.GameObject): boolean =>
    (e as Phaser.GameObjects.Sprite).getData('kind') === 'jumper';

  private readonly isJumperVulnerable = (e: Phaser.GameObjects.GameObject): boolean =>
    (e as Phaser.GameObjects.Sprite).getData('vulnerable') === true;
```

- [ ] **Step 2: Exclude jumpers from generic stomp/damage**

```ts
  private readonly isStomping = (
    player: Phaser.GameObjects.GameObject,
    enemy:  Phaser.GameObjects.GameObject,
  ): boolean => {
    if (this.isJumper(enemy)) return false;
    const p = player as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    const e = enemy  as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    return p.body.velocity.y > 0 && p.body.center.y < e.body.center.y;
  };

  private readonly isDamaging = (
    player: Phaser.GameObjects.GameObject,
    enemy:  Phaser.GameObjects.GameObject,
  ): boolean =>
    !this.isJumper(enemy) && !this.invincible && !this.debugNoclip && !this.isStomping(player, enemy);
```

- [ ] **Step 3: Add jumper overlaps inside the manager loop**

In the `for (const em of this.enemyManagers)` overlap loop (~316), after the two existing overlaps:

```ts
      this.physics.add.overlap(
        this.player.sprite, em.group,
        this.handleStomp as unknown as AP,
        ((_p: Phaser.GameObjects.GameObject, e: Phaser.GameObjects.GameObject) =>
          this.isJumper(e) && this.isJumperVulnerable(e)) as unknown as AP,
        this,
      );
      this.physics.add.overlap(
        this.player.sprite, em.group,
        this.handleJumperStun as unknown as AP,
        ((_p: Phaser.GameObjects.GameObject, e: Phaser.GameObjects.GameObject) =>
          this.isJumper(e) && !this.isJumperVulnerable(e) && !this.invincible && !this.debugNoclip) as unknown as AP,
        this,
      );
```

- [ ] **Step 4: Add `handleJumperStun`**

Add near `handleEnemyDamage`:

```ts
  private readonly handleJumperStun = (
    _player: Phaser.GameObjects.GameObject,
    enemy:   Phaser.GameObjects.GameObject,
  ): void => {
    if (this.player.hasActiveShield) {
      this.player.absorbHit();
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }
    if (this._playerDead || this.invincible || this.debugNoclip) return;

    const e = enemy as Phaser.Physics.Arcade.Sprite;
    const dir = Math.sign(this.player.sprite.x - e.x) || 1;
    AudioManager.play('enemy-kill');
    this.player.stun(500, { x: dir * 280, y: -180 });
    playElectrocutionEffect(this, this.player.sprite, 500);
    this.cameras.main.shake(180, 0.008);

    this.invincible = true;
    this.time.delayedCall(PLAYER_INVINCIBLE_MS, () => { this.invincible = false; });
  };
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat(enemy): wire jumper defeat + stun contact in InfiniteGameScene"
```

---

## Task 12: Thread jumper kills through the score pipeline

**Files:**
- Modify: `shared/scoreTypes.ts` (kills type ~22)
- Modify: `shared/buildRunScore.ts` (kinds array ~42)
- Modify: `server/src/routes/scores.ts` (validation ~169-224, buildRunScore call ~260)
- Modify: `src/scenes/ScoreScene.ts` (submit payload ~1012-1015)
- Test: `src/systems/__tests__/buildRunScore.test.ts`; `server/tests/` (append to the scores route test if present)

**Interfaces:**
- Consumes: `ENEMY_DEFS.jumper.scoreValue = 150` (Task 1).
- Produces: `SubmitScoreInputs.kills` includes `jumper: number`; `buildRunScore` credits jumper kills; server accepts + validates jumper; client sends jumper count.

- [ ] **Step 1: Write the failing test (buildRunScore)**

Append to `src/systems/__tests__/buildRunScore.test.ts`:

```ts
it('credits jumper kills at 150 each', () => {
  const { finalScore, rows } = buildRunScore(
    { baseHeightPx: 0, kills: { jumper: 2 }, elapsedMs: 0 },
    ENEMY_DEFS,
    true, // isFailure → no pace bonus, isolate the kill credit
  );
  expect(finalScore).toBe(300);
  expect(rows.some(r => r.type === 'kill' && r.label.includes('JUMPER CABLES'))).toBe(true);
});
```

(Ensure `ENEMY_DEFS` is imported in this test file — match its existing imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/buildRunScore.test.ts`
Expected: FAIL — jumper not in the scored `kinds`, finalScore 0.

- [ ] **Step 3: Implement shared changes**

In `shared/buildRunScore.ts`, extend the kinds array:

```ts
  const kinds: EnemyKind[] = ['percher', 'ghost', 'jumper'];
```

In `shared/scoreTypes.ts`, extend the kills type with an **optional** jumper so
existing fixtures and pre-jumper clients keep compiling/submitting:

```ts
  kills:        { percher: number; ghost: number; jumper?: number };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/systems/__tests__/buildRunScore.test.ts`
Expected: PASS.

- [ ] **Step 5: Server validation for jumper**

In `server/src/routes/scores.ts`:

- After the `ghost` read/validation block, add a `jumper` read + validation. **Default a missing `jumper` to 0** (backward-compatible with pre-jumper clients — unlike `percher`/`ghost`, which are required), but still reject a present-but-invalid value:

```ts
    const jumper = kills.jumper ?? 0;
    if (!Number.isInteger(jumper) || jumper < 0) {
      console.warn(`[scores] reject: bad jumper (${jumper})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad jumper', value: jumper });
      }
      return c.json({ error: 'bad jumper' }, 400);
    }
```

(Match the exact rejection/response shape used by the surrounding `percher`/`ghost` blocks — copy their structure verbatim, substituting `jumper`. The only intentional difference is the `?? 0` default so omitting `jumper` is not rejected.)

- Include jumper in the kill-rate check:

```ts
    if ((percher + ghost + jumper) * 1000 > MAX_KILLS_PER_S * elapsedMs) {
      console.warn(`[scores] reject: kill rate ${((percher + ghost + jumper) * 1000) / elapsedMs} /s exceeds ${MAX_KILLS_PER_S} (heapId=${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'kill rate too high', heapId, killRatePerS: ((percher + ghost + jumper) * 1000) / elapsedMs });
      }
      return c.json({ error: 'kill rate too high' }, 400);
    }
```

- Pass jumper into the recompute:

```ts
    const { finalScore } = buildRunScore(
      { baseHeightPx, kills: { percher, ghost, jumper }, elapsedMs, salvageBonus },
      ENEMY_DEFS,
      isFailure,
      heap.score_mult,
    );
```

- [ ] **Step 6: Client submit payload**

In `src/scenes/ScoreScene.ts` (~1012), add jumper to the submitted kills:

```ts
            kills: {
              percher: this._kills.percher ?? 0,
              ghost:   this._kills.ghost   ?? 0,
              jumper:  this._kills.jumper  ?? 0,
            },
```

- [ ] **Step 7: Add a server test for jumper crediting (optional but recommended)**

Append to `server/tests/scores.test.ts` a case that submits `kills: { percher: 0, ghost: 0, jumper: 2 }` and asserts the stored/recomputed score includes 2×150. Mirror an existing successful-submit test's setup in that file (mock DB + auth headers). This confirms the server accepts + credits jumper end-to-end.

- [ ] **Step 8: Build + full test run**

Run: `npm run build && npm test`
Expected: PASS. Because `jumper` is optional in the type and defaults to 0 on the server, existing fixtures that omit it (e.g. `server/tests/scores.test.ts`, `ScoreClient.test.ts`) still compile and still submit successfully — no fixture edits required.

- [ ] **Step 9: Commit**

```bash
git add shared/scoreTypes.ts shared/buildRunScore.ts server/src/routes/scores.ts src/scenes/ScoreScene.ts src/systems/__tests__/buildRunScore.test.ts server/tests/scores.test.ts
git commit -m "feat(score): count jumper kills in client submit + server recompute"
```

---

## Task 13: Full verification + smoke test

**Files:** none (verification only).

- [ ] **Step 1: Full build + test**

Run: `npm run build && npm test`
Expected: build clean, all tests green. Fix any regression before proceeding.

- [ ] **Step 2: Live smoke test**

Invoke the `smoke-testing-heap` skill and verify in a browser (use the user's dev server on :3000 if running; do not kill it):
- Jumper Cables appear on **wall** faces of the heap (not flat tops), seated just off the wall in open air, facing outward (flipped correctly on both left and right walls).
- Idle alternates between two idle anims; approaching within ~140px triggers the extend/attack anim.
- Touching the **extended** clamp: player is knocked away from the wall, loses control ~0.5s, an electrocution overlay + screen shake play, then control returns.
- Touching a **retracted/cooldown** jumper: it's destroyed with the kill SFX + bounce + `+score` marker; the run's kill count increases.
- After an attack, the jumper shows **idle-1 only** for ~3s (disarmed) and does not re-attack during that window.
- Repeat the wall spawn + stun + defeat checks in **Infinite mode**.

- [ ] **Step 3: Tuning pass**

Adjust in `EnemyManager.ts` / `enemyDefs.ts` if smoke reveals issues: body boxes (`bodyIdle`/`bodyAttack`), `JUMPER_ATTACK_RANGE_PX`, display size, knockback magnitude, spawn chances. Commit any tuning as a follow-up `tune(enemy): jumper …` commit.

- [ ] **Step 4: Finish the branch**

Invoke `superpowers:finishing-a-development-branch` to open the PR (target `main`). Do not push mid-implementation; push once the smoke test passes and the user confirms.

---

## Design Decisions (rationale for reviewers)

- **No D1 migration.** Rather than add `jumper` to the sentinel `heap_parameters.enemy_params` JSON (a prod data change), `EnemyManager.setEnemyParams` merges incoming params over `DEFAULT_ENEMY_PARAMS`. Jumpers spawn on every heap immediately; a heap can still override jumper params via its own `enemy_params` key. This also future-proofs adding further enemy kinds.
- **Reuse `handleStomp` for jumper defeat.** Retracted contact routes to the existing stomp handler (kill + bounce + coins + `_runKills[kind]++` + marker), avoiding a duplicate defeat path. Score credit flows because `_runKills.jumper` feeds `buildRunScore`.
- **Vulnerability via a `setData('vulnerable')` flag** kept current by the manager each frame, read by the scene's overlap process callbacks — GameScene stays decoupled from `EnemyManager` runtime internals.
- **Procedural shock effect + reused SFX.** No electrocution sprite or dedicated sound exists; the overlay is code-drawn and the audible cue reuses `enemy-kill`. A dedicated SFX/sprite is a later art task, out of scope.
