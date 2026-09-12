# Stamina Movement System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HeapGame's air-jump counter with a shared stamina pool, make dash/wall-jump/dive default-unlocked, and refund players the Scrap they spent on those now-removed upgrades.

**Architecture:** Stamina is a float accumulator living on `Player`, computed by a new pure module `src/systems/stamina.ts`. Each ability keeps its existing limiter (per-airtime cap, cooldown) and gains a flat 1-stamina cost. The refund runs as a post-merge reconciliation step — never inside `migrateGame` — because migration precedes the cloud merge and would be double-credited by the `Math.max` balance rule.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vitest, Vite 6.

**Spec:** `docs/superpowers/specs/2026-09-11-stamina-movement-design.md` — read it before Task 1. The plan argues from the spec; both travel together.

## Global Constraints

- **Branch:** `feature/stamina-movement`, already created off `main`. Never push to `main`.
- **Prerequisite (external):** `feature/scrap-currency-rename` (`e7955db`) must be merged to `main` and this branch rebased on it before Task 4. It touches `upgradeDefs.ts`, `UpgradeScene.ts` and `MenuScene.ts`. If it is not yet merged, stop and tell the user.
- **Currency is called "Scrap"** in all player-facing copy. Never "coins" or "gold".
- **`BASE_STAMINA = 3`**, `MAX_STAMINA_CAP = 8`, `STAMINA_REGEN_GROUND_MS = 200`, `STAMINA_REGEN_AIR_MS = 3000`. Exact values.
- **Wall-jump base cooldown becomes 3000ms** (from 2000), upgradeable to 1500ms over 10 levels.
- **Refund prices are hardcoded historical constants:** `wall_jump: 450`, `dash: 600`, `dive: 500`. Total 1,550. Never read them from `UPGRADE_DEFS` — those defs are deleted in Task 4 and would silently yield 0.
- **Import save accessors from the `SaveData` barrel** (`src/systems/SaveData.ts`), never from `save/core` or `save/game` directly.
- **New save fields go in `save/game.ts`**, never `save/core.ts`, and must be handled in all three hooks (`fresh`/`migrate`/`merge`).
- **Do not reorder the spreads** in `migrate()` or `mergeCloudSave()` — game contribution first, core last. That ordering is what makes the `playerSecret` invariant structural.
- **Run `npm run build` before claiming any task done.** It catches TS errors the tests miss.
- Test command: `npx vitest run <path>`. Full suite: `npm test`.

---

### Task 1: Fix the schema-branch landmine (prerequisite, independent of stamina)

`migrateGame` branches on `version === CURRENT_SCHEMA`, `=== 1`, `=== 4`, and lets everything else fall through to a v2→v3 remap that wipes cosmetics, beaten heaps and hat adjustments and offsets every placed item by +4,950,000px. The moment `CURRENT_SCHEMA` becomes 6 (Task 9), every live v5 save lands there. The code already warns about this at `game.ts:425`.

This task ships on its own and is worth landing even if the rest of the feature is abandoned.

**Files:**
- Modify: `src/systems/save/game.ts:354-441`
- Test: `src/systems/__tests__/SaveData.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `migrateGame` tolerates any `version >= 5` without data loss. Task 9 relies on this when bumping `CURRENT_SCHEMA` to 6.

- [ ] **Step 1: Write the failing test**

Add to `src/systems/__tests__/SaveData.test.ts`:

```ts
it('preserves a v5 save intact when CURRENT_SCHEMA moves past 5', () => {
  // Simulates the next schema bump: a v5 blob must not fall into the
  // v2->v3 remap branch, which wipes cosmetics and offsets placed items.
  const v5 = {
    schemaVersion: 5,
    balance: 4200,
    upgrades: { air_jump: 2, dash: 1 },
    inventory: { medkit: 3 },
    placed: { heapA: [{ id: 'i1', x: 10, y: 40_000 }] },
    selectedHeapId: 'heapA',
    highScores: { heapA: 900 },
    beatenHeapIds: ['heapA'],
    cosmeticsOwned: ['hat_cone'],
    cosmeticsEquipped: { hat: 'hat_cone' },
    hatAdjustments: { hat_cone: { dAngle: 5, dScale: 1.1 } },
    menuTutorialSeen: true,
    tutorialDone: true,
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(v5));

  const loaded = load();

  expect(loaded.cosmeticsOwned).toEqual(['hat_cone']);
  expect(loaded.cosmeticsEquipped).toEqual({ hat: 'hat_cone' });
  expect(loaded.beatenHeapIds).toEqual(['heapA']);
  expect(loaded.hatAdjustments).toEqual({ hat_cone: { dAngle: 5, dScale: 1.1 } });
  expect(loaded.menuTutorialSeen).toBe(true);
  // The remap branch would push this to 4_990_000.
  expect(loaded.placed.heapA[0].y).toBe(40_000);
});
```

- [ ] **Step 2: Run it and confirm it PASSES today**

Run: `npx vitest run src/systems/__tests__/SaveData.test.ts -t 'preserves a v5 save intact'`
Expected: **PASS** — because `CURRENT_SCHEMA` is still 5, so v5 hits the first branch. This test is a *tripwire* for Task 9, not a red test. Confirming it passes now proves the fixture is well-formed.

- [ ] **Step 3: Prove the landmine is real**

Temporarily change `CURRENT_SCHEMA` in `src/systems/save/core.ts:5` from `5` to `6`, then re-run the same test.
Expected: **FAIL** — cosmetics empty, `placed.heapA[0].y` is `4_990_000`.

**Revert `CURRENT_SCHEMA` back to `5` before continuing.** Task 9 owns the real bump.

- [ ] **Step 4: Fix the branch structure**

In `src/systems/save/game.ts`, change the first branch at line 355 from:

```ts
  if (version === CURRENT_SCHEMA) {
```

to:

```ts
  // v5 and anything newer share this layout. Written as >= so the next
  // CURRENT_SCHEMA bump doesn't drop every live save into the v2->v3
  // remap fall-through below (which wipes cosmetics and offsets placed Y).
  if (version >= 5) {
```

Then narrow the fall-through. Replace the comment block at lines 418-426 and the bare `const placed = ...` that follows with:

```ts
  // v2 -> v3 raised the world height, so placed items need their Y remapped.
  // Narrowly scoped on purpose: anything that is not 1, 2, 4 or >=5 is an
  // unknown or rolled-back-client version, and must pass through WITHOUT the
  // remap rather than being offset by +4 950 000.
  if (version === 2) {
    const placed: Record<string, PlacedItemSave[]> = parsed.placed ?? {};
    return {
      balance:        parsed.balance        ?? 0,
      upgrades:       parsed.upgrades       ?? {},
      inventory:      parsed.inventory      ?? {},
      placed:         remapPlacedY(placed, WORLD_HEIGHT_V2, WORLD_HEIGHT_V3),
      selectedHeapId: parsed.selectedHeapId ?? '',
      highScores:     parsed.highScores     ?? {},
      beatenHeapIds:  [],
      cosmeticsOwned: [],
      cosmeticsEquipped: {},
      tutorialDone:   parsed.tutorialDone   ?? true,
    };
  }

  // Unknown / newer / v3: pass through with no remap and no field loss.
  return {
    balance:        parsed.balance        ?? 0,
    upgrades:       parsed.upgrades       ?? {},
    inventory:      parsed.inventory      ?? {},
    placed:         parsed.placed         ?? {},
    selectedHeapId: parsed.selectedHeapId ?? '',
    highScores:     parsed.highScores     ?? {},
    beatenHeapIds:  parsed.beatenHeapIds  ?? [],
    cosmeticsOwned: parsed.cosmeticsOwned ?? [],
    cosmeticsEquipped: parsed.cosmeticsEquipped ?? {},
    loadoutSyncPending: parsed.loadoutSyncPending,
    hatAdjustments: parsed.hatAdjustments,
    tutorialDone:   parsed.tutorialDone   ?? true,
    menuTutorialSeen: parsed.menuTutorialSeen,
    _legacyPlaced:  parsed._legacyPlaced,
    adRunsSinceLast: parsed.adRunsSinceLast,
    adRunTarget:     parsed.adRunTarget,
  };
```

Keep the `version === 1` and `version === 4` branches exactly as they are.

- [ ] **Step 5: Re-run the tripwire with CURRENT_SCHEMA temporarily at 6**

Set `CURRENT_SCHEMA = 6` again, run:
`npx vitest run src/systems/__tests__/SaveData.test.ts`
Expected: PASS, including the new test.

**Revert `CURRENT_SCHEMA` to `5`.**

- [ ] **Step 6: Full suite + build**

Run: `npm test && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/systems/save/game.ts src/systems/__tests__/SaveData.test.ts
git commit -m "Fix migrateGame fall-through wiping v5 saves on the next schema bump

migrateGame matched only CURRENT_SCHEMA, 1 and 4, so bumping the schema
would drop every live v5 save into the v2->v3 remap branch: cosmetics,
beaten heaps and hat adjustments cleared, every placed item offset by
+4 950 000px. The code warned about this at game.ts:425.

First branch is now version >= 5, the remap is narrowed to version === 2,
and unknown/newer versions pass through with no remap and no field loss."
```

---

### Task 2: Harden `mergeGame` against dropping unknown fields

`mergeGame` returns a hand-built literal enumerating only fields its build knows about, and `mergeCloudSave` spreads `...local` first — which preserves fields the *local* save has, not fields present only in the *cloud*. So an old client merging a newer cloud save silently drops any field it doesn't know. This is why the refund flag alone is not a sufficient defence (spec, *Why a persisted flag is not sufficient on its own*), and it must be fixed before Task 9 adds new fields.

**Files:**
- Modify: `src/systems/save/game.ts:449-517`
- Test: `src/systems/__tests__/SaveData.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mergeGame(local, cloud)` preserves game fields it does not explicitly merge. Task 9's `movementRefundApplied` / `seenAnnouncements` rely on this.

- [ ] **Step 1: Write the failing test**

```ts
it('mergeGame preserves game fields it does not explicitly merge', () => {
  // A field written by a NEWER client exists only in the cloud save. The
  // running build knows nothing about it and must not silently drop it.
  const local = { ...baseRawSave(), balance: 100 };
  const cloud = { ...baseRawSave(), balance: 50, someFutureField: 'keep-me' } as any;

  const merged = mergeCloudSave(local, cloud) as any;

  expect(merged.someFutureField).toBe('keep-me');
  expect(merged.balance).toBe(100); // explicit merge rules still win
});
```

Use whatever the file's existing `base()` / fixture helper is named for `baseRawSave()`; match the surrounding tests.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/systems/__tests__/SaveData.test.ts -t 'preserves game fields it does not explicitly merge'`
Expected: FAIL — `merged.someFutureField` is `undefined`.

- [ ] **Step 3: Add the passthrough spread**

In `mergeGame`, change the `return {` at line 499 to spread both saves before the explicit literal:

```ts
  return {
    // Spread both inputs first so any game field this build does not know
    // about survives the merge. Without this, a field written only by a NEWER
    // client is dropped by the hand-built literal below — the same way the
    // schema stamp is — and one-time flags like movementRefundApplied become
    // as fragile as the version they replaced. Explicit rules below still win.
    ...(secondary as object),
    ...(primary as object),
```

…leaving every existing explicit key in place after it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/systems/__tests__/SaveData.test.ts`
Expected: PASS, and no existing merge test regresses (the explicit keys still override).

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/systems/save/game.ts src/systems/__tests__/SaveData.test.ts
git commit -m "Preserve unknown game fields through mergeGame

mergeGame returned a hand-built literal enumerating only the fields its
build knows, so a field present only in a newer client's cloud save was
silently dropped. Spread both saves before the explicit literal so
future fields survive; explicit merge rules still win."
```

---

### Task 3: The pure stamina module

**Files:**
- Create: `src/systems/stamina.ts`
- Create: `src/systems/__tests__/stamina.test.ts`
- Modify: `src/constants.ts` (append to the Player section, near `MAX_AIR_JUMPS` at line 92)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `regenStamina(current: number, max: number, deltaMs: number, grounded: boolean, airRegenMs: number): number`
  - `canSpend(current: number, cost: number): boolean`
  - `spend(current: number, cost: number): number`
  - Constants `BASE_STAMINA`, `MAX_STAMINA_CAP`, `STAMINA_REGEN_GROUND_MS`, `STAMINA_REGEN_AIR_MS` from `constants.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/stamina.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { regenStamina, canSpend, spend } from '../stamina';
import { STAMINA_REGEN_GROUND_MS, STAMINA_REGEN_AIR_MS } from '../../constants';

describe('regenStamina', () => {
  it('regenerates one bar per STAMINA_REGEN_GROUND_MS while grounded', () => {
    expect(regenStamina(0, 3, STAMINA_REGEN_GROUND_MS, true, STAMINA_REGEN_AIR_MS)).toBeCloseTo(1);
  });

  it('regenerates one bar per airRegenMs while airborne', () => {
    expect(regenStamina(0, 3, STAMINA_REGEN_AIR_MS, false, STAMINA_REGEN_AIR_MS)).toBeCloseTo(1);
  });

  it('accumulates partial progress across frames rather than losing it', () => {
    // Three 16ms grounded frames = 48/200 of a bar. A per-bar timer that reset
    // each frame would return 0 here; the float accumulator must not.
    let s = 0;
    for (let i = 0; i < 3; i++) s = regenStamina(s, 3, 16, true, STAMINA_REGEN_AIR_MS);
    expect(s).toBeCloseTo(48 / STAMINA_REGEN_GROUND_MS);
  });

  it('clamps at max', () => {
    expect(regenStamina(2.9, 3, 10_000, true, STAMINA_REGEN_AIR_MS)).toBe(3);
  });

  it('honours a faster airborne regen rate from upgrades', () => {
    expect(regenStamina(0, 3, 1800, false, 1800)).toBeCloseTo(1);
  });

  it('never returns below zero', () => {
    expect(regenStamina(-5, 3, 0, false, STAMINA_REGEN_AIR_MS)).toBe(0);
  });
});

describe('canSpend / spend', () => {
  it('allows a spend the player can exactly afford', () => {
    expect(canSpend(1, 1)).toBe(true);
  });

  it('rejects a spend on a partial bar', () => {
    // 0.9 of a bar cannot buy a 1-cost action. This is the rule that makes
    // grounded regen a duration rather than a toggle.
    expect(canSpend(0.9, 1)).toBe(false);
  });

  it('subtracts the cost and floors at zero', () => {
    expect(spend(2.5, 1)).toBeCloseTo(1.5);
    expect(spend(0.4, 1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/systems/__tests__/stamina.test.ts`
Expected: FAIL — cannot resolve `../stamina`.

- [ ] **Step 3: Add the constants**

In `src/constants.ts`, replace the `MAX_AIR_JUMPS` line at 92 with:

```ts
// ── Stamina ────────────────────────────────────────────────────────────────────
// One shared pool funds air jump, dash and wall jump (1 each). Jump, dive and
// wall slide are free. Each ability keeps its own limiter on top of the cost —
// see Player.ts and docs/superpowers/specs/2026-09-11-stamina-movement-design.md
export const MAX_AIR_JUMPS   = 1;   // base per-airtime AIR JUMP CAP — not a stamina value
export const BASE_STAMINA    = 3;   // base pool; upgrades and pickups add to it
export const MAX_STAMINA_CAP = 8;   // hard ceiling; the HUD builds this many segments
// Grounded regen is fast but NOT instant: a 2-frame bunny-hop banks ~0.15 bars
// while a half-second pause on a ledge tops the pool up. That gradient is the
// point — an instant refill would make stamina a rename of the old counter.
export const STAMINA_REGEN_GROUND_MS = 200;
export const STAMINA_REGEN_AIR_MS    = 3000; // tune in playtest; upgrade lowers it
```

- [ ] **Step 4: Write the module**

Create `src/systems/stamina.ts`:

```ts
/**
 * Pure stamina arithmetic. No Phaser, no globals — everything the player's
 * pool does is a function of its previous value and this frame's delta, so it
 * can be tested without a scene. Follows wallSlide.ts / buffMath.ts.
 *
 * Stamina is a FLOAT, not a set of per-bar timers. Partial progress carries
 * across frames, which is what lets the HUD show an honest partial fill and
 * what makes grounded contact a duration rather than a toggle.
 */

/** Advance the pool by one frame. Returns the new value, clamped to [0, max]. */
export function regenStamina(
  current: number, max: number, deltaMs: number,
  grounded: boolean, airRegenMs: number,
): number {
  const perBarMs = grounded ? GROUND_MS : airRegenMs;
  const gained   = perBarMs > 0 ? deltaMs / perBarMs : 0;
  return Math.max(0, Math.min(max, current + gained));
}

/** Whole bars only: 0.9 of a bar cannot buy a 1-cost action. */
export function canSpend(current: number, cost: number): boolean {
  return current >= cost;
}

/** Deduct a cost, floored at zero. */
export function spend(current: number, cost: number): number {
  return Math.max(0, current - cost);
}
```

Add the import at the top:

```ts
import { STAMINA_REGEN_GROUND_MS as GROUND_MS } from '../constants';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/stamina.test.ts`
Expected: PASS (all 9).

- [ ] **Step 6: Build + commit**

```bash
npm run build
git add src/systems/stamina.ts src/systems/__tests__/stamina.test.ts src/constants.ts
git commit -m "Add pure stamina module and constants

Float accumulator so partial regen progress survives across frames.
Grounded 200ms/bar, airborne 3000ms/bar (upgrade-lowered), cap 8."
```

---

### Task 4: Restructure `upgradeDefs` and `PlayerConfig`

**Prerequisite:** `feature/scrap-currency-rename` merged and this branch rebased. Stop and tell the user if not.

**Files:**
- Modify: `src/data/upgradeDefs.ts`
- Modify: `src/systems/save/game.ts:190-215` (`PlayerConfig`, `getPlayerConfig`)
- Modify: `src/scenes/UpgradeScene.ts:16-25` (`ACCENT_COLORS`)
- Modify: `src/constants.ts` (`WALL_JUMP_COOLDOWN_MS` 2000 → 3000, add tuning constants)
- Test: `src/entities/__tests__/Player.test.ts` (config literals — see Step 5)

**Interfaces:**
- Consumes: `BASE_STAMINA` (Task 3).
- Produces: `PlayerConfig` gains `baseStamina: number`, `staminaRegenAirMs: number`, `wallJumpCooldownMs: number`, `dashPower: number`, and loses `wallJump`, `dash`, `dive`. `maxAirJumps` is unchanged. Task 6 consumes all of these.

- [ ] **Step 1: Write the failing test**

Add to `src/systems/__tests__/SaveData.test.ts`:

```ts
it('getPlayerConfig derives stamina fields from upgrades', () => {
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    schemaVersion: 5, balance: 0,
    upgrades: { air_jump: 1, max_stamina: 2, stamina_regen: 0, wall_jump_cd: 4 },
    inventory: {}, placed: {}, highScores: {}, beatenHeapIds: [],
    cosmeticsOwned: [], cosmeticsEquipped: {},
  }));

  const cfg = getPlayerConfig();

  expect(cfg.maxAirJumps).toBe(2);            // 1 + air_jump level
  expect(cfg.baseStamina).toBe(5);            // BASE_STAMINA 3 + max_stamina 2
  expect(cfg.staminaRegenAirMs).toBe(3000);   // level 0 = base rate
  expect(cfg.wallJumpCooldownMs).toBe(2400);  // 3000 - 4 * 150
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/systems/__tests__/SaveData.test.ts -t 'getPlayerConfig derives stamina'`
Expected: FAIL — `baseStamina` is `undefined`.

- [ ] **Step 3: Add the tuning constants**

In `src/constants.ts`, change line 90 and add below it:

```ts
export const WALL_JUMP_COOLDOWN_MS = 3000; // ms same-wall cooldown (was 2000; wall jump now also costs stamina)
// wall_jump_cd upgrade: 10 levels x 150ms takes 3000 -> 1500.
export const WALL_JUMP_CD_PER_LEVEL   = 150;
export const WALL_JUMP_CD_MIN_MS      = 1500;
// stamina_regen upgrade: 4 levels x 300ms takes airborne 3000 -> 1800.
export const STAMINA_REGEN_PER_LEVEL  = 300;
// dash_power upgrade: each level adds this to PLAYER_DASH_VELOCITY.
export const DASH_POWER_PER_LEVEL     = 60;
```

- [ ] **Step 4: Rewrite the upgrade defs**

In `src/data/upgradeDefs.ts`: **delete** the `wall_jump`, `dash` and `dive` entries entirely. Keep `air_jump` exactly as it is (same id, same costs — it still sells air jumps, so it is never refunded). Add the four new entries:

```ts
  {
    id: 'max_stamina',
    name: 'Stamina Tank',
    description: (l) => `${BASE_STAMINA + l} max stamina`,
    maxLevel: 3,                                  // designer: 3 takes base 3 -> 6
    cost: (l) => [400, 900, 1800][l - 1],         // designer: replace with actual costs
  },
  {
    id: 'stamina_regen',
    name: 'Second Wind',
    description: (l) => `Recover air stamina ${((STAMINA_REGEN_PER_LEVEL * l) / STAMINA_REGEN_AIR_MS * 100).toFixed(0)}% faster`,
    maxLevel: 4,                                  // designer: 4 takes 3000ms -> 1800ms
    cost: (l) => [350, 700, 1400, 2800][l - 1],   // designer: replace with actual costs
  },
  {
    id: 'dash_power',
    name: 'Dash Power',
    description: (l) => `+${DASH_POWER_PER_LEVEL * l} dash speed`,
    maxLevel: 4,
    cost: (l) => [300, 600, 1200, 2400][l - 1],   // designer: replace with actual costs
  },
  {
    id: 'wall_jump_cd',
    name: 'Wall Grip',
    description: (l) => `${((WALL_JUMP_COOLDOWN_MS - WALL_JUMP_CD_PER_LEVEL * l) / 1000).toFixed(2)}s same-wall cooldown`,
    maxLevel: 10,
    cost: (l) => 200 + l * 150,                   // designer: replace with actual costs
  },
```

Extend the import at line 1 to bring in `BASE_STAMINA`, `STAMINA_REGEN_AIR_MS`, `STAMINA_REGEN_PER_LEVEL`, `DASH_POWER_PER_LEVEL`, `WALL_JUMP_COOLDOWN_MS`, `WALL_JUMP_CD_PER_LEVEL`.

- [ ] **Step 5: Update `PlayerConfig` and `getPlayerConfig`**

In `src/systems/save/game.ts`, replace the interface at 190-200 and the three removed booleans in `getPlayerConfig`:

```ts
export interface PlayerConfig {
  maxAirJumps:         number;  // per-airtime AIR JUMP CAP, not a stamina budget
  baseStamina:         number;
  staminaRegenAirMs:   number;
  wallJumpCooldownMs:  number;
  dashPower:           number;  // added to PLAYER_DASH_VELOCITY
  moneyMultiplier:     number;
  jumpBoost:           number;
  stompBonus:          number;
  peakMultiplier:      number;
  maxWalkableSlopeDeg: number;
}
```

In `getPlayerConfig()`, delete the `wallJump`, `dash` and `dive` lines and add:

```ts
    baseStamina:        BASE_STAMINA + getUpgradeLevel('max_stamina'),
    staminaRegenAirMs:  Math.max(
      STAMINA_REGEN_AIR_MS - getUpgradeLevel('stamina_regen') * STAMINA_REGEN_PER_LEVEL,
      STAMINA_REGEN_PER_LEVEL,
    ),
    wallJumpCooldownMs: Math.max(
      WALL_JUMP_COOLDOWN_MS - getUpgradeLevel('wall_jump_cd') * WALL_JUMP_CD_PER_LEVEL,
      WALL_JUMP_CD_MIN_MS,
    ),
    dashPower:          getUpgradeLevel('dash_power') * DASH_POWER_PER_LEVEL,
```

Import the new constants from `../../constants`.

- [ ] **Step 6: Update `ACCENT_COLORS`**

In `src/scenes/UpgradeScene.ts:16-25`, remove the `wall_jump`, `dash` and `dive` keys and add:

```ts
  max_stamina:   0x44ddaa,
  stamina_regen: 0x66ffcc,
  dash_power:    0xff8844,
  wall_jump_cd:  0xaa88ff,
```

- [ ] **Step 7: Migrate the existing Player test config literals**

`src/entities/__tests__/Player.test.ts` has ~100 `config: { maxAirJumps, wallJump, dash, dive, jumpBoost }` literals that no longer typecheck. Add a helper near the top of the file and replace every literal with it:

```ts
import { BASE_STAMINA, STAMINA_REGEN_AIR_MS, WALL_JUMP_COOLDOWN_MS } from '../../constants';

/** Default PlayerConfig for tests; override only what a case cares about. */
function cfg(over: Partial<PlayerConfig> = {}): PlayerConfig {
  return {
    maxAirJumps: 1, baseStamina: BASE_STAMINA,
    staminaRegenAirMs: STAMINA_REGEN_AIR_MS,
    wallJumpCooldownMs: WALL_JUMP_COOLDOWN_MS, dashPower: 0,
    moneyMultiplier: 1, jumpBoost: 0, stompBonus: 0,
    peakMultiplier: 1, maxWalkableSlopeDeg: 45,
    ...over,
  };
}
```

Cases that previously set `wallJump: false` or `dash: false` to *disable* an ability can no longer do so — those abilities are always available now. Delete those assertions rather than trying to preserve them; the behaviour they guarded no longer exists.

- [ ] **Step 8: Run tests + build**

Run: `npm test && npm run build`
Expected: all green. Expect to fix a handful of call sites the compiler flags — that is the point of running the build.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Restructure upgrade tree for stamina

Remove wall_jump/dash/dive (now default-unlocked; refunded in a later
task). Add max_stamina, stamina_regen, dash_power and wall_jump_cd.
PlayerConfig gains the four stamina fields and loses the three ability
booleans. Wall-jump base cooldown 2000 -> 3000ms."
```

---

### Task 5: Rename the modifier lever `extraAirJumps` → `extraStamina`

**Files:**
- Modify: `src/data/pickupDefs.ts` (lines 20, 64-70, 101, 125, 132, 150-151, and every `effect:` literal)
- Modify: `src/systems/buffMath.ts:4-33`
- Modify: `src/systems/BuffManager.ts`
- Test: `src/data/__tests__/pickupDefs.test.ts:39-42`, `src/systems/__tests__/buffMath.test.ts:7`

**Interfaces:**
- Consumes: nothing.
- Produces: `PickupEffect.extraStamina`, `CarryModifiers.extraStamina`, `BuffAggregate.extraStamina`. Task 6 consumes these.

- [ ] **Step 1: Update the tests first**

In `src/data/__tests__/pickupDefs.test.ts`, rename the field in every literal and update the discrete-capability test:

```ts
it('never scales extraStamina (discrete capability)', () => {
  const balloon: PickupEffect = { speedMult: 1, jumpBonus: 0, extraStamina: 1 };
  expect(applyRarity(balloon, 'mythic').extraStamina).toBe(1);
  expect(applyRarity(balloon, 'common').extraStamina).toBe(1);
});
```

Do the same rename in `src/systems/__tests__/buffMath.test.ts`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/data/__tests__/pickupDefs.test.ts src/systems/__tests__/buffMath.test.ts`
Expected: FAIL — TS errors on the unknown property.

- [ ] **Step 3: Rename across the source**

```bash
sed -i 's/extraAirJumps/extraStamina/g' src/data/pickupDefs.ts src/systems/buffMath.ts src/systems/BuffManager.ts
```

Then fix the two prose comments by hand:
- `pickupDefs.ts:64` — "`extraStamina` is discrete and never scaled." (the rule still holds)
- `pickupDefs.ts:150-151` — the description builder; change the player-facing wording from air jumps to stamina, e.g. `+${n} max stamina`.

The Balloon entry at line 186 keeps `extraStamina: 1` — its meaning becomes "+1 max stamina".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/__tests__/pickupDefs.test.ts src/systems/__tests__/buffMath.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add -A
git commit -m "Rename the extraAirJumps modifier lever to extraStamina

Balloon's +1 air jump becomes +1 max stamina. Still discrete and never
rarity-scaled — it is a capability, not a stat."
```

---

### Task 6: Wire stamina into `Player`

The largest task. `airJumpsRemaining` already *is* the per-airtime cap — it resets on ground (`Player.ts:427`), ladder (`339`) and stomp (`767`) — so it stays; each ability simply gains a stamina check beside its existing limiter.

**Files:**
- Modify: `src/entities/Player.ts`
- Test: `src/entities/__tests__/Player.test.ts`

**Interfaces:**
- Consumes: `regenStamina`/`canSpend`/`spend` (Task 3), `PlayerConfig` stamina fields (Task 4), `extraStamina` (Task 5).
- Produces: `player.staminaCurrent: number`, `player.staminaMax: number`, `player.refundStamina(bars: number): void`. Tasks 7 and 8 consume these.

- [ ] **Step 1: Write the failing tests**

Add to `src/entities/__tests__/Player.test.ts`:

```ts
describe('stamina', () => {
  it('spends a bar on an air jump', () => {
    const p = makePlayer({ config: cfg({ maxAirJumps: 1 }) });
    (p as any).stamina = 3;
    (p as any).airJumpsRemaining = 1;
    airJump(p);
    expect(p.staminaCurrent).toBeCloseTo(2);
  });

  it('blocks the air jump at zero stamina even with the cap unspent', () => {
    const p = makePlayer({ config: cfg({ maxAirJumps: 1 }) });
    (p as any).stamina = 0;
    (p as any).airJumpsRemaining = 1;
    const before = p.sprite.body.velocity.y;
    airJump(p);
    expect(p.sprite.body.velocity.y).toBe(before);
  });

  it('blocks the air jump at a spent cap even with a full bar', () => {
    // The design's UX trap: full bar, dead button. The HUD must show both
    // gates, and the mechanic must genuinely refuse.
    const p = makePlayer({ config: cfg({ maxAirJumps: 1 }) });
    (p as any).stamina = 3;
    (p as any).airJumpsRemaining = 0;
    const before = p.sprite.body.velocity.y;
    airJump(p);
    expect(p.sprite.body.velocity.y).toBe(before);
  });

  it('clamps current stamina down when carried modifiers reduce the max', () => {
    // Salvage is dropped/delivered mid-run; without the clamp the player holds
    // bars above their cap and the HUD renders more segments than exist.
    const p = makePlayer({ config: cfg() });
    p.setCarryModifiers({ speedMult: 1, jumpBonus: 0, extraStamina: 2 });
    (p as any).stamina = 5;
    p.setCarryModifiers({ speedMult: 1, jumpBonus: 0, extraStamina: 0 });
    expect(p.staminaCurrent).toBeLessThanOrEqual(p.staminaMax);
    expect(p.staminaMax).toBe(3);
  });

  it('grants one bar (not a full refill) when max stamina rises', () => {
    const p = makePlayer({ config: cfg() });
    (p as any).stamina = 0;
    p.setCarryModifiers({ speedMult: 1, jumpBonus: 0, extraStamina: 1 });
    expect(p.staminaCurrent).toBeCloseTo(1);
  });

  it('refundStamina restores bars up to the max', () => {
    const p = makePlayer({ config: cfg() });
    (p as any).stamina = 1;
    p.refundStamina(1);
    expect(p.staminaCurrent).toBeCloseTo(2);
    p.refundStamina(99);
    expect(p.staminaCurrent).toBe(p.staminaMax);
  });
});
```

Write `makePlayer` / `airJump` helpers to match whatever the file already uses to construct a player and drive an update frame; reuse the existing harness rather than inventing one.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/entities/__tests__/Player.test.ts -t stamina`
Expected: FAIL — `staminaCurrent` undefined.

- [ ] **Step 3: Add the field, getters and config wiring**

In `src/entities/Player.ts`:

```ts
  private stamina: number = 0;
  private readonly baseStamina:        number;
  private readonly staminaRegenAirMs:  number;
  private readonly wallJumpCooldownMs: number;
  private readonly dashPower:          number;
```

Add to the HUD accessors block near line 166:

```ts
  get staminaCurrent(): number { return this.stamina; }
  get staminaMax():     number { return this.effectiveMaxStamina; }
```

Add beside `effectiveMaxAirJumps` at line 200:

```ts
  /** Max stamina including carried salvage and consumable buffs, hard-capped. */
  private get effectiveMaxStamina(): number {
    return Math.min(
      MAX_STAMINA_CAP,
      this.baseStamina + this.carryExtraStamina + this.buffExtraStamina,
    );
  }
```

In the constructor, replace the removed `wallJumpEnabled`/`dashEnabled`/`diveEnabled` assignments with:

```ts
    this.baseStamina       = config.baseStamina;
    this.staminaRegenAirMs = config.staminaRegenAirMs;
    this.wallJumpCooldownMs = config.wallJumpCooldownMs;
    this.dashPower         = config.dashPower;
    this.stamina           = this.effectiveMaxStamina;
```

Rename the existing `carryExtraAirJumps` / `buffExtraAirJumps` fields to `carryExtraStamina` / `buffExtraStamina`, and delete `wallJumpEnabled` / `dashEnabled` / `diveEnabled` along with the `hasWallJump` / `hasDash` getters' backing — but **keep `hasDash` and `hasWallJump` as getters returning `true`** for now; Task 8 removes their call sites.

- [ ] **Step 4: Add the regen step**

Add the helper and call it from `runUpdate` immediately after `this.handleLandingResets(ctx, delta);`:

```ts
  /** Advance the pool. Called after handleLandingResets so `grounded` is fresh
   *  and a bar completing this frame is spendable by the jump paths below. */
  private updateStamina(ctx: FrameCtx, delta: number): void {
    this.stamina = regenStamina(
      this.stamina, this.effectiveMaxStamina, delta,
      ctx.onGround, this.staminaRegenAirMs,
    );
  }
```

- [ ] **Step 5: Regen on ladders, inline**

`handleLadder()` returns `true` and `runUpdate` early-returns at line 257, *before* `updateStamina` ever runs — so a player parked on a ladder would regenerate nothing. Add to `handleLadder()`, beside the existing resets at lines 339-341:

```ts
    // Ladder counts as grounded for stamina too. Applied here rather than in
    // updateStamina because this method early-returns out of runUpdate.
    this.stamina = regenStamina(
      this.stamina, this.effectiveMaxStamina, delta, true, this.staminaRegenAirMs,
    );
```

`handleLadder()` currently takes no `delta`; thread it through from `runUpdate`.

- [ ] **Step 6: Gate the three abilities**

In `tryGroundOrAirJump`, change the air-jump branch condition at line 561 from `if (this.airJumpsRemaining > 0) {` to:

```ts
    if (this.airJumpsRemaining > 0 && canSpend(this.stamina, 1)) {
```

and add `this.stamina = spend(this.stamina, 1);` beside the existing `this.airJumpsRemaining--;`.

In `tryWallJump`, add after the `canFireOnThisWall` check at line 587:

```ts
    if (!canSpend(this.stamina, 1)) return false;
```

and `this.stamina = spend(this.stamina, 1);` where the cooldown is set.

In `updateDash`, change the fire condition at line 526 to include `&& canSpend(this.stamina, 1)` and add the spend beside `this.dashCooldown = ...`. Also add the placement gate — `tryWallJump` and `tryGroundOrAirJump` both check `!this.placementMode` but `updateDash` does not, so dashing while positioning an item would drain the pool:

```ts
    if (this.placementMode) return;
```

near the top of `updateDash`, after the dash-active bookkeeping.

Use `this.dashPower` in the dash velocity: `dir * (PLAYER_DASH_VELOCITY + this.dashPower)`.

Use `this.wallJumpCooldownMs` in place of the `WALL_JUMP_COOLDOWN_MS` constant at line 590.

- [ ] **Step 7: Clear the jump buffer on a stamina-blocked press**

Both jump paths returning false leaves `jumpBufferTimer` decaying, which can fire a stale jump on a later landing. In `runUpdate`, after the two `try*` calls:

```ts
    // A press that failed only for want of stamina is consumed, not left in the
    // buffer to fire later on landing. Emits a distinct cue: running dry is the
    // riskiest feel change in this design and it must be legible.
    if (!jumpFired && !wallJumpFired && this.jumpBufferTimer > 0
        && !ctx.onGround && !canSpend(this.stamina, 1)) {
      this.jumpBufferTimer = 0;
      this.sprite.scene.events.emit('player-action', 'stamina-empty');
      AudioManager.play('ui-denied');
    }
```

Use whatever existing denied/error sound key the project has; if none exists, omit the `AudioManager.play` line and leave the event emit for Task 8's HUD flash.

- [ ] **Step 8: Clamp on modifier change; grant one bar on a rise**

In `setCarryModifiers` and `setBuffModifiers` (lines 783, 797), replace the `gainedAirJump` full-refill logic with:

```ts
    const gained = mods.extraStamina > this.carryExtraStamina; // buff variant: buffExtraStamina
    this.carryExtraStamina = mods.extraStamina;
    // Grant ONE bar on a rise, not a full refill — note the air-jump code this
    // replaced did a full reset, which as a stamina rule would be a free escape
    // mid-chimney. And clamp DOWN when salvage is dropped, or the player holds
    // bars above their cap and the HUD renders segments that do not exist.
    if (gained) this.stamina += 1;
    this.stamina = Math.min(this.stamina, this.effectiveMaxStamina);
```

- [ ] **Step 9: Add `refundStamina` and fix the false comment**

```ts
  /** Restore bars, capped. Used by stomp (see the four refundAirJump sites). */
  refundStamina(bars: number): void {
    this.stamina = Math.min(this.effectiveMaxStamina, this.stamina + bars);
  }
```

Rewrite the comment at `Player.ts:268-270`. It currently reads *"Wall jump is tried first so it takes priority when it can actually fire (it costs no air jump)"* — that justification is now false. Replace with:

```ts
    // Wall jump is tried first so it takes priority when it can actually fire.
    // Both paths now cost the same single bar, but a wall jump adds horizontal
    // push and spares the per-airtime air-jump cap, so it is strictly the better
    // spend when available. When it can't fire — same-wall cooldown, or no
    // stamina — we fall through instead of swallowing the press.
```

- [ ] **Step 10: Run tests + build**

Run: `npx vitest run src/entities/__tests__/Player.test.ts && npm run build`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Wire stamina into Player

Air jump, dash and wall jump each cost one bar on top of their existing
limiter. Ladder regen applied inline (handleLadder early-returns out of
runUpdate). Dash now gated by placement mode. A stamina-blocked press
clears the jump buffer instead of firing stale on a later landing.
Modifier changes grant one bar on a rise and clamp down on a fall."
```

---

### Task 7: Stomp refunds both a bar and the air-jump cap

There are **four** `refundAirJump()` call sites, not one. `InfiniteGameScene.ts:599` is debug noclip, which calls it every frame to fake infinite flight and will stop working without a stamina refill.

**Files:**
- Modify: `src/entities/Player.ts` (`refundAirJump` at 767)
- Verify: `src/scenes/GameScene.ts:848`, `src/scenes/TutorialScene.ts:362`, `src/scenes/InfiniteGameScene.ts:599`, `src/scenes/InfiniteGameScene.ts:731`
- Test: `src/entities/__tests__/Player.test.ts`

**Interfaces:**
- Consumes: `refundStamina` (Task 6).
- Produces: `refundAirJump()` restores both resources. No signature change, so the four call sites need no edit.

- [ ] **Step 1: Write the failing test**

```ts
it('stomp refunds both a stamina bar and the air-jump cap', () => {
  const p = makePlayer({ config: cfg({ maxAirJumps: 1 }) });
  (p as any).stamina = 0;
  (p as any).airJumpsRemaining = 0;
  p.refundAirJump();
  expect(p.staminaCurrent).toBeCloseTo(1);
  expect(p.airJumpsLeft).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/entities/__tests__/Player.test.ts -t 'stomp refunds both'`
Expected: FAIL — stamina stays 0.

- [ ] **Step 3: Extend `refundAirJump`**

```ts
  /** Stomp reward: restores BOTH the air-jump cap and one stamina bar.
   *  Refunding only the bar would leave the cap spent and silently break
   *  stomp-chaining — the most expressive movement in the game. Called from
   *  GameScene, InfiniteGameScene (stomp + debug noclip) and TutorialScene. */
  refundAirJump(): void {
    this.airJumpsRemaining = Math.min(this.effectiveMaxAirJumps, this.airJumpsRemaining + 1);
    this.refundStamina(1);
  }
```

- [ ] **Step 4: Verify the four call sites need no change**

```bash
grep -rn "refundAirJump" src/ | grep -v __tests__
```

Expected: exactly the four sites plus the definition. Confirm noclip at `InfiniteGameScene.ts:599` now also refills stamina — it calls this every frame, so it will.

- [ ] **Step 5: Run tests + build + commit**

```bash
npx vitest run src/entities/__tests__/Player.test.ts && npm run build
git add -A
git commit -m "Stomp refunds a stamina bar as well as the air-jump cap

Refunding only the bar would leave the cap spent and break stomp-chaining.
Covers all four refundAirJump sites including InfiniteGameScene noclip."
```

---

### Task 8: HUD — stamina bar, ability glyphs, mobile dash affordance

**Files:**
- Modify: `src/ui/hudLogic.ts:12-16` (replace `airJumpPipStates`)
- Modify: `src/ui/AbilityTray.ts` (full restructure)
- Modify: `src/systems/mountJoystick.ts:58,61,62,65,83`
- Test: `src/ui/__tests__/hudLogic.test.ts:3,17-25`

**Interfaces:**
- Consumes: `player.staminaCurrent`, `player.staminaMax`, `player.airJumpsLeft`, `player.canWallJump`, `player.dashCooldownFraction` (Task 6).
- Produces: `staminaSegments(current: number, max: number): number[]`.

- [ ] **Step 1: Write the failing tests**

Replace the `airJumpPipStates` block in `src/ui/__tests__/hudLogic.test.ts`:

```ts
import { staminaSegments } from '../hudLogic';

describe('staminaSegments', () => {
  it('returns one entry per max bar, full when topped up', () => {
    expect(staminaSegments(3, 3)).toEqual([1, 1, 1]);
  });

  it('partially fills only the regenerating segment', () => {
    expect(staminaSegments(2.4, 3)).toEqual([1, 1, 0.4]);
  });

  it('is all-empty at zero', () => {
    expect(staminaSegments(0, 3)).toEqual([0, 0, 0]);
  });

  it('clamps current above max', () => {
    expect(staminaSegments(9, 3)).toEqual([1, 1, 1]);
  });

  it('never returns negative fills', () => {
    expect(staminaSegments(-2, 2)).toEqual([0, 0]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/__tests__/hudLogic.test.ts`
Expected: FAIL — `staminaSegments` not exported.

- [ ] **Step 3: Implement it**

Replace `airJumpPipStates` in `src/ui/hudLogic.ts` (delete it — Task 8's AbilityTray is its only caller):

```ts
/** Per-segment fill (0..1) for the stamina bar. Only the bar currently
 *  regenerating is partial; everything below it is full and above it empty. */
export function staminaSegments(current: number, max: number): number[] {
  const c = clamp(current, 0, max);
  return Array.from({ length: max }, (_, i) => clamp(c - i, 0, 1));
}
```

- [ ] **Step 4: Restructure `AbilityTray`**

Rewrite `src/ui/AbilityTray.ts` as two rows. Build **all `MAX_STAMINA_CAP` segments up front and hide the surplus** — today's pip row sizes from `player.maxAirJumpsCount`, which is the *base*, so a Balloon's extra charge already has no pip. Building at the cap fixes that class of bug and survives mid-run max changes.

```ts
constructor(scene: Phaser.Scene, player: Player) {
  this.player = player;
  const left = HUD_INSET, top = HUD_INSET;
  const colW = 108, rowH = 30;
  const panelH = HUD_TRAY_PAD * 2 + rowH * 2;
  const cx = left + colW / 2;

  this.objects.push(makePanel(scene, cx, top + panelH / 2, colW, panelH, 14).setDepth(19));

  // Row 1 — stamina. Segments are built at the cap and hidden above the
  // player's current max, so a mid-run max change needs no rebuild.
  const segW = 10, segGap = 2, segH = 12;
  const totalW = MAX_STAMINA_CAP * segW + (MAX_STAMINA_CAP - 1) * segGap;
  const segLeft = cx - totalW / 2;
  const rowY = top + HUD_TRAY_PAD + rowH / 2;
  for (let i = 0; i < MAX_STAMINA_CAP; i++) {
    const back = scene.add.rectangle(segLeft + i * (segW + segGap), rowY, segW, segH, 0x000000, 0.45)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(20)
      .setStrokeStyle(1, HUD_THEME.border, HUD_THEME.borderAlpha);
    const fill = scene.add.rectangle(segLeft + i * (segW + segGap), rowY, segW, segH, HUD_THEME.cloud, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(21);
    this.segBacks.push(back); this.segFills.push(fill);
    this.objects.push(back, fill);
  }

  // Row 2 — the three ability glyphs, side by side.
  const glyphY = rowY + rowH;
  this.cloudIcon = makeCloudIcon(scene, cx - 30, glyphY).setDepth(20);
  this.wallIcon  = makeWallJumpIcon(scene, cx, glyphY).setDepth(20);
  this.dashIcon  = makeDashChevrons(scene, cx + 22, glyphY).setDepth(20);
  this.objects.push(this.cloudIcon, this.wallIcon, this.dashIcon);
}

update(): void {
  const fills = staminaSegments(this.player.staminaCurrent, this.player.staminaMax);
  for (let i = 0; i < this.segFills.length; i++) {
    const visible = i < this.player.staminaMax;
    this.segBacks[i].setVisible(visible);
    this.segFills[i].setVisible(visible);
    if (visible) this.segFills[i].scaleX = fills[i];
  }
  // Two independent gates: the bar answers "can I afford anything", the cloud
  // answers "is an air jump still available this airtime". Without the second,
  // a full bar plus a dead jump button reads as a bug.
  this.cloudIcon.setAlpha(this.player.airJumpsLeft > 0 ? 1 : 0.25);
  this.wallIcon.setAlpha(this.player.canWallJump ? 1 : 0.25);
  // Dash keeps a CONTINUOUS fill, not a binary toggle — "how long until dash?"
  // is a timing decision players make constantly.
  this.dashIcon.setAlpha(0.25 + 0.75 * dashBarFillFraction(this.player.dashCooldownFraction));
}
```

Drop the `showDashIndicator` constructor parameter and update both call sites (`GameScene`, `InfiniteGameScene`) — dash is always unlocked now, so the tray always shows all three glyphs.

- [ ] **Step 5: Give the mobile dash button a stamina affordance**

`mountJoystick.ts` is the primary dash UI on mobile and reads `player.hasDash` in five places: the `.setVisible(player.hasDash)` on `dashBtn` (58), `dashLabel` (61) and `dashRing` (62); the `if (player.hasDash) {` interactivity block (65); and the early return inside `drawRing()` (83).

Delete all five gates — dash is always available now, so the button is always built, always interactive, and always drawn. Then dim it when the pool is empty, so it does not look live while doing nothing. Add to the top of `drawRing()`, which already runs per-frame:

```ts
  const affordable = player.staminaCurrent >= 1;
  const a = affordable ? 1 : 0.35;
  dashBtn.setAlpha(a); dashLabel.setAlpha(a); dashRing.setAlpha(a);
```

Finally, `hasDash` and `hasWallJump` on `Player` now have no callers — Task 6 kept them returning `true` as a temporary shim. Delete both getters and confirm with `grep -rn "hasDash\|hasWallJump" src/`.

- [ ] **Step 6: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS. Fix any `airJumpPipStates` import the compiler still flags.

- [ ] **Step 7: Visual check**

Run: `npm run scene-preview -- GameScene '{}' iphone-se`
Confirm the tray is two rows and does not collide with the joystick. See the `heap-scene-preview` skill for the device table.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "HUD: segmented stamina bar plus three ability glyphs

Two rows instead of four. Segments are built at MAX_STAMINA_CAP and
hidden above the current max, which also fixes the old pip row sizing
from the BASE air-jump count and ignoring pickups. Cloud glyph now shows
the per-airtime cap so a full bar plus a dead button is legible. Mobile
dash button dims at zero stamina."
```

---

### Task 9: Save fields and the post-merge refund

**Files:**
- Modify: `src/systems/save/core.ts:5` (`CURRENT_SCHEMA` 5 → 6)
- Modify: `src/systems/save/game.ts` (`GameSave`, `freshGame`, `migrateGame`, `mergeGame`, new `reconcileMovementRefund`)
- Modify: `src/systems/SaveData.ts` (export the new function)
- Modify: `src/systems/bootSequence.ts:86` (call after `applyMergedSave`)
- Test: `src/systems/__tests__/SaveData.test.ts`

**Interfaces:**
- Consumes: Task 1's branch fix, Task 2's passthrough.
- Produces: `reconcileMovementRefund(): void`, `getMovementRefundAmount(): number`, `hasSeenAnnouncement(id: string): boolean`, `markAnnouncementSeen(id: string): void`. Task 10 consumes all four.

- [ ] **Step 1: Write the failing tests**

```ts
const LEGACY = { wall_jump: 1, dash: 1, dive: 1 };

it('refunds 1550 for all three removed upgrades and deletes the keys', () => {
  seedSave({ balance: 100, upgrades: { ...LEGACY, air_jump: 2 } });
  reconcileMovementRefund();
  expect(getBalance()).toBe(1650);
  expect(getUpgrades()).toEqual({ air_jump: 2 });
  expect(getMovementRefundAmount()).toBe(1550);
});

it('refunds only what the player actually owned', () => {
  seedSave({ balance: 0, upgrades: { dash: 1 } });
  reconcileMovementRefund();
  expect(getBalance()).toBe(600);
});

it('is idempotent across repeated launches', () => {
  seedSave({ balance: 0, upgrades: { ...LEGACY } });
  reconcileMovementRefund();
  reconcileMovementRefund();
  reconcileMovementRefund();
  expect(getBalance()).toBe(1550);
});

it('pays a returning player whose cloud save restores the old upgrades', () => {
  // The Android reinstall path: fresh local save, then a pre-update cloud save
  // merges in. freshGame() must NOT pre-set the flag or this player is robbed.
  seedFreshSave();
  const cloud = { ...baseRawSave(), balance: 900, upgrades: { ...LEGACY } };
  applyMergedSave(mergeCloudSave(getRawSaveForCloudSync(), cloud as any));
  reconcileMovementRefund();
  expect(getBalance()).toBe(900 + 1550);
});

it('pays a genuinely new player nothing', () => {
  seedFreshSave();
  reconcileMovementRefund();
  expect(getBalance()).toBe(0);
  expect(getMovementRefundAmount()).toBe(0);
});

it('persists the refund on the launch it fires', () => {
  seedSave({ balance: 0, upgrades: { ...LEGACY } });
  reconcileMovementRefund();
  const stored = JSON.parse(localStorage.getItem(SAVE_KEY)!);
  expect(stored.balance).toBe(1550);
  expect(stored.movementRefundApplied).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/systems/__tests__/SaveData.test.ts -t refund`
Expected: FAIL — `reconcileMovementRefund` not exported.

- [ ] **Step 3: Bump the schema and add the fields**

`src/systems/save/core.ts:5`: `const CURRENT_SCHEMA = 6;`

Add to `GameSave` in `game.ts`:

```ts
  /** One-time flag: the movement-rework refund has been paid for this save
   *  lineage. Merged with || like the other one-time flags. NOT keyed on
   *  schemaVersion — an old client can downgrade the stamp on a save that has
   *  already been refunded. See the design doc's Migration section. */
  movementRefundApplied?: boolean;
  /** What this player actually got back, for the announcement to display. */
  movementRefundAmount?:  number;
  /** Ids of one-time announcements this player has dismissed. */
  seenAnnouncements?:     string[];
```

Add to `migrateGame`'s `version >= 5` branch and the unknown-version passthrough: `movementRefundApplied: parsed.movementRefundApplied`, `movementRefundAmount: parsed.movementRefundAmount`, `seenAnnouncements: parsed.seenAnnouncements`.

Add to `mergeGame`'s explicit literal:

```ts
    movementRefundApplied: local.movementRefundApplied || cloud.movementRefundApplied,
    movementRefundAmount:  Math.max(local.movementRefundAmount ?? 0, cloud.movementRefundAmount ?? 0),
    seenAnnouncements: [...new Set([
      ...(local.seenAnnouncements ?? []), ...(cloud.seenAnnouncements ?? []),
    ])],
```

In `freshGame()`, seed `seenAnnouncements: [MOVEMENT_ANNOUNCEMENT_ID]` — a genuinely new player should not be told what changed about a system they never used. **Do NOT set `movementRefundApplied`.** Pre-setting it on a fresh save denies the refund to every Android reinstall and new-device restore, because that path is fresh-save-then-cloud-merge. A genuinely new save owns none of the three keys and so pays out zero on its own.

- [ ] **Step 4: Write the reconciliation function**

```ts
/** Purchase prices of the upgrades removed by the movement rework, frozen as
 *  historical constants. Deliberately NOT read from UPGRADE_DEFS: those entries
 *  are deleted, so a lookup would return 0 and silently refund nothing. */
const MOVEMENT_REFUND_PRICES: Record<string, number> = {
  wall_jump: 450, dash: 600, dive: 500,
};

export const MOVEMENT_ANNOUNCEMENT_ID = 'movement-v0.4';

/**
 * Pay back Scrap spent on upgrades the movement rework made default-unlocked.
 *
 * MUST run after any cloud merge, never inside migrateGame. Migration happens
 * at load(), the GPGS merge happens later, and mergeGame resolves balance with
 * Math.max — so a refund applied during migration is double-credited the moment
 * one device has already spent it (see cloudSave.ts:33-35). Running post-merge
 * against the reconciled upgrade map pays exactly once.
 *
 * Safe to call repeatedly; the flag makes it a no-op after the first payout.
 */
export function reconcileMovementRefund(): void {
  const data = load();
  if (data.movementRefundApplied) return;

  let amount = 0;
  for (const [id, price] of Object.entries(MOVEMENT_REFUND_PRICES)) {
    if ((data.upgrades[id] ?? 0) > 0) {
      amount += price;
      delete data.upgrades[id];
    }
  }

  data.balance              += amount;
  data.movementRefundAmount  = amount;
  data.movementRefundApplied = true;
  // Persist unconditionally: load() only writes when the stored version differs
  // from CURRENT_SCHEMA, so relying on that side effect would recompute the
  // refund every launch and never save it.
  persist(data);
  if (amount > 0) syncSaveToCloud();
}

export function getMovementRefundAmount(): number {
  return load().movementRefundAmount ?? 0;
}

export function hasSeenAnnouncement(id: string): boolean {
  return (load().seenAnnouncements ?? []).includes(id);
}

export function markAnnouncementSeen(id: string): void {
  const data = load();
  const seen = new Set(data.seenAnnouncements ?? []);
  seen.add(id);
  data.seenAnnouncements = [...seen];
  persist(data);
}
```

Import `syncSaveToCloud` from `../cloudSave`. If that creates a circular import, emit an event the boot layer listens for instead — do not silently drop the sync, since it is what closes the stale-snapshot window.

- [ ] **Step 5: Call it post-merge**

In `src/systems/bootSequence.ts`, immediately after `applyMergedSave(merged);` at line 86:

```ts
    reconcileMovementRefund(); // after the merge, never inside migrate()
```

- [ ] **Step 6: Export from the barrel**

Add `reconcileMovementRefund`, `getMovementRefundAmount`, `hasSeenAnnouncement`, `markAnnouncementSeen`, `MOVEMENT_ANNOUNCEMENT_ID` to `src/systems/SaveData.ts` (they come through `export * from './save/game'` automatically — verify, and add explicitly if not).

- [ ] **Step 7: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS, **including Task 1's v5 tripwire test**, which now runs against a real `CURRENT_SCHEMA = 6`. If that test fails here, Task 1's fix is wrong — stop and fix it rather than adjusting the test.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Schema 6: post-merge Scrap refund for removed movement upgrades

Refund runs as reconcileMovementRefund() after any cloud merge, never
inside migrateGame: migration precedes the GPGS merge and mergeGame
resolves balance with Math.max, so a migrate-time refund is
double-credited once a device has spent it.

freshGame() deliberately does NOT pre-set the flag — the Android
reinstall path is fresh-save-then-cloud-merge, and pre-setting it would
deny the refund to every returning player. Prices are frozen constants,
not UPGRADE_DEFS lookups, which now return 0."
```

---

### Task 10: The announcement modal

**Files:**
- Create: `src/ui/AnnouncementModal.ts`
- Modify: `src/scenes/MenuScene.ts` (near the entrance-complete callback at line 156-160)
- Test: `src/ui/__tests__/announcementLogic.test.ts`
- Create: `src/ui/announcementLogic.ts`

**Interfaces:**
- Consumes: `hasSeenAnnouncement`, `markAnnouncementSeen`, `getMovementRefundAmount`, `MOVEMENT_ANNOUNCEMENT_ID` (Task 9).
- Produces: `buildAnnouncementBeats(refundAmount: number): string[]`, `class AnnouncementModal`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/__tests__/announcementLogic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAnnouncementBeats } from '../announcementLogic';

describe('buildAnnouncementBeats', () => {
  it('includes the refund beat with the player\'s actual amount', () => {
    const beats = buildAnnouncementBeats(1550);
    expect(beats).toHaveLength(3);
    expect(beats[2]).toContain('1,550');
    expect(beats[2]).toContain('Scrap');
  });

  it('omits the refund beat entirely at zero rather than saying "0 Scrap"', () => {
    const beats = buildAnnouncementBeats(0);
    expect(beats).toHaveLength(2);
    expect(beats.join(' ')).not.toContain('0 Scrap');
  });

  it('always explains the pool and the unlocks', () => {
    const beats = buildAnnouncementBeats(600);
    expect(beats[0].toLowerCase()).toContain('stamina');
    expect(beats[1].toLowerCase()).toContain('dash');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/__tests__/announcementLogic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure logic**

Create `src/ui/announcementLogic.ts`:

```ts
/** Copy for the movement-rework announcement, as three beats. The refund beat
 *  is per-player, so it is omitted rather than rendered as "0 Scrap" for
 *  someone who owned none of the removed upgrades. */
export function buildAnnouncementBeats(refundAmount: number): string[] {
  const beats = [
    'Your air moves now share one Stamina pool. Air jump, dash and wall jump each cost one bar. Stamina refills fast on the ground and slowly in the air.',
    'Dash, Wall Jump and Dive are now unlocked for everyone from the start. The shop sells power, not access.',
  ];
  if (refundAmount > 0) {
    beats.push(`You had already bought some of those, so we refunded ${refundAmount.toLocaleString('en-US')} Scrap. Spend it on the new Stamina upgrades.`);
  }
  return beats;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/__tests__/announcementLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the modal**

Create `src/ui/AnnouncementModal.ts` — a reusable id-keyed modal, seeded with this one entry. Follow the existing modal styling in `hudTheme.ts` / the menu's coach-mark overlay so it matches. It must:

- render a panel with a title, the beats as body paragraphs, and a single dismiss button
- call `markAnnouncementSeen(id)` on dismiss
- be constructed only when `!hasSeenAnnouncement(id)`

- [ ] **Step 6: Wire it into `MenuScene`**

In the entrance-complete callback at `MenuScene.ts:156-160`, ahead of the existing tour gate:

```ts
    this.time.delayedCall(ENTRANCE_FULL_SPAN_MS * introScale + 200, () => {
      this.entranceComplete = true;
      // Refund must settle before the modal reads the amount. Idempotent, so
      // this also covers the never-signed-in path that bootSequence misses.
      reconcileMovementRefund();
      if (!hasSeenAnnouncement(MOVEMENT_ANNOUNCEMENT_ID)) {
        new AnnouncementModal(this, MOVEMENT_ANNOUNCEMENT_ID,
          'Movement Rework', buildAnnouncementBeats(getMovementRefundAmount()));
        return; // don't stack the coach-mark tour on top of the modal
      }
      if (!getMenuTutorialSeen()) this.startMenuTour();
    });
```

`MenuScene` already listens for `SAVE_MERGED_EVENT` at line 141; confirm a late merge does not need to re-open the modal (it should not — the flag is set on dismiss).

- [ ] **Step 7: Run tests + build + visual check**

```bash
npm test && npm run build
npm run scene-preview -- MenuScene '{}' iphone-se
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add the movement-rework announcement modal

Reusable id-keyed modal gated on seenAnnouncements, seeded with one
entry. Reconciles the refund first so beat 3 shows the player's real
number, and omits that beat entirely at zero."
```

---

### Task 11: Tutorial — teach stamina, verify the wall is still climbable

**Files:**
- Modify: `src/scenes/TutorialScene.ts:124` (delete the ability override), plus a new step
- Modify: `src/systems/TutorialDirector.ts:2` (add `'stamina'` to the step union)
- Modify: `src/data/tutorialFixture.ts` (new step entry + both control-scheme copy maps at lines ~103, ~118)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing downstream.

- [ ] **Step 1: Delete the now-redundant override**

`TutorialScene.ts:124` reads:

```ts
const cfg = { ...playerConfig, dash: true, dive: true, wallJump: true };
```

Those fields no longer exist on `PlayerConfig` (Task 4). Replace with `const cfg = playerConfig;` and simplify the call site.

- [ ] **Step 2: Add the step kind**

`TutorialDirector.ts:2`, extend the union:

```ts
  | 'move' | 'jump' | 'stamina' | 'walljump' | 'dash' | 'dive'
```

- [ ] **Step 3: Add the step, before `walljump`**

In `src/data/tutorialFixture.ts`, insert ahead of the `walljump` entry at line 82:

```ts
  { id: 'stamina', message: 'The bar top-left is your Stamina. Air jumps, dashes and wall jumps each cost one bar. It refills fast on the ground and slowly in the air.', advanceOn: 'jump', mode: 'hint' },
```

Add matching entries to both control-scheme copy maps (keyboard ~line 103, touch ~line 118):

```ts
  stamina: 'Watch the Stamina bar top-left as you jump — each air move spends a bar, and standing still on the ground refills them.',
```

- [ ] **Step 4: Verify the wall-jump step is still passable**

The `walljump` step tells a brand-new player *"Repeat to climb."* With 3 bars, 1 per wall jump and 3000ms airborne regen, a stamina-naive beginner may now stall partway up. **This needs live verification, not reasoning** — it is a first-session drop-off risk.

Use the `smoke-testing-heap` skill and play the tutorial to completion in the browser. If the wall cannot be climbed on a first attempt without pausing to regen, either lower the wall in the fixture or add a ledge partway up. Record what you found in the commit message.

- [ ] **Step 5: Run tests + build + commit**

```bash
npm test && npm run build
git add -A
git commit -m "Tutorial: teach stamina and verify the wall-jump step

New stamina step before walljump, in both control-scheme copy maps.
Drops the dash/dive/wallJump PlayerConfig override, which no longer
typechecks now those are always unlocked.

Wall-jump step verified climbable in-browser: <record the finding>"
```

---

## Final verification before opening the PR

- [ ] `npm test` — full suite green
- [ ] `npm run build` — no TS errors
- [ ] Live smoke test via the `smoke-testing-heap` skill, covering specifically:
  - Running to 0 stamina mid-climb and recovering via wall slide → land → refill. **This is the design's riskiest change and the thing most likely to feel broken.**
  - Chimney-climbing an alternating wall pair — confirm ~4 jumps then a forced recovery beat, not a dead stop.
  - Stomp-chaining a column of enemies still works (both the bar and the cap must come back).
  - Mobile joystick layout: the 2-row tray does not collide with the stick, and the dash button visibly dims at 0 stamina.
- [ ] A save carrying `wall_jump`/`dash`/`dive` gets exactly 1,550 Scrap once, and not again on relaunch.
- [ ] **Raise `min_version` to this build as part of the release, not before.** Per the spec, this is the primary defence against a stale client dropping the refund flag during a merge. It is a release step, not a code change in this branch.

## Deferred (explicitly not in this plan)

- Heap difficulty rebalance after the mobility increase
- Leaderboard reset or movement-system score tagging — decided against in the spec
- Fractional stamina costs, per-action regen penalties, remote-config announcement copy
