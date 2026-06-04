# Consumables System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A data-driven consumables system (timed + whole-run buffs) replacing the hardcoded shield path, shipping five consumables, with a timed-buff expiry subsystem and cosmetic-ready seams.

**Architecture:** Pure buff math (`buffMath.ts`) + a `BuffManager` that owns active timed buffs, ticks expiry, and drives a new Player **buff-modifier layer** (composing with the salvage carry layer). Activation is generalized in `PlaceableManager` via a `CONSUMABLE_DEFS` behavior registry. `wallSpeedMult` is combined in `GameScene`; Revive hooks the existing damage path.

**Tech Stack:** TypeScript, Phaser 3.90, Vitest. Pure logic is TDD-unit-tested; Phaser wiring (BuffManager/GameScene/PlaceableManager/StoreScene/HUD) is verified by `npm run build` + scene-preview + device, matching repo convention.

Spec: `docs/superpowers/specs/2026-06-03-consumables-system-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/systems/buffMath.ts` | Pure buff aggregation + tick/upsert | **Create** |
| `src/systems/__tests__/buffMath.test.ts` | Unit tests | **Create** |
| `src/entities/Player.ts` | Buff-modifier layer + Revive flag | Modify |
| `src/entities/__tests__/Player.test.ts` | Buff/revive tests | Modify |
| `src/data/itemDefs.ts` | Store catalog | Modify (category rename + 4 entries) |
| `src/data/consumableDefs.ts` | Consumable behavior registry | **Create** |
| `src/data/__tests__/consumableDefs.test.ts` | Catalog↔behavior invariant | **Create** |
| `src/systems/BuffManager.ts` | Active-buff state, expiry tick, HUD | **Create** |
| `src/scenes/GameScene.ts` | Construct/tick BuffManager, wall combine, Revive hook | Modify |
| `src/systems/PlaceableManager.ts` | Generalized consumable activation | Modify |
| `src/scenes/StoreScene.ts` | Consumable tab label + accent colors | Modify |

---

## Task 1: Pure buff math (`buffMath.ts`) — TDD

**Files:**
- Create: `src/systems/buffMath.ts`
- Test: `src/systems/__tests__/buffMath.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/buffMath.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { aggregateBuffEffects, upsertBuff, tickBuffs, ActiveBuff } from '../buffMath';

describe('aggregateBuffEffects', () => {
  it('returns identity for an empty list', () => {
    expect(aggregateBuffEffects([])).toEqual({
      speedMult: 1, jumpBonus: 0, extraAirJumps: 0,
      gravityMult: 1, cooldownMult: 1, wallSpeedMult: 1,
    });
  });

  it('multiplies multiplicative levers and adds additive ones', () => {
    const agg = aggregateBuffEffects([
      { speedMult: 1.3, jumpBonus: 75 },
      { speedMult: 1.1, wallSpeedMult: 0.25, jumpBonus: 10 },
    ]);
    expect(agg.speedMult).toBeCloseTo(1.43);
    expect(agg.jumpBonus).toBe(85);
    expect(agg.wallSpeedMult).toBe(0.25);
    expect(agg.gravityMult).toBe(1);
  });
});

describe('upsertBuff', () => {
  const mk = (id: string, remainingMs: number): ActiveBuff =>
    ({ id, effect: { speedMult: 1.3 }, remainingMs, durationMs: 30_000 });

  it('appends a new buff', () => {
    const out = upsertBuff([], mk('adrenaline', 30_000));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('adrenaline');
  });

  it('refreshes (replaces) an existing buff by id without duplicating', () => {
    const out = upsertBuff([mk('adrenaline', 2_000)], mk('adrenaline', 30_000));
    expect(out).toHaveLength(1);
    expect(out[0].remainingMs).toBe(30_000);
  });
});

describe('tickBuffs', () => {
  const mk = (id: string, remainingMs: number): ActiveBuff =>
    ({ id, effect: {}, remainingMs, durationMs: 30_000 });

  it('decrements remaining time without dropping when still active', () => {
    const { active, changed } = tickBuffs([mk('a', 1_000)], 16);
    expect(active[0].remainingMs).toBe(984);
    expect(changed).toBe(false);
  });

  it('drops an expired buff and flags changed', () => {
    const { active, changed } = tickBuffs([mk('a', 10)], 16);
    expect(active).toHaveLength(0);
    expect(changed).toBe(true);
  });

  it('never expires a whole-run buff (Infinity)', () => {
    const { active, changed } = tickBuffs([mk('a', Infinity)], 16);
    expect(active[0].remainingMs).toBe(Infinity);
    expect(changed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/buffMath.test.ts`
Expected: FAIL — `buffMath` module / exports not found.

- [ ] **Step 3: Implement the module**

Create `src/systems/buffMath.ts`:

```typescript
import type { PickupEffect } from '../data/pickupDefs';

export interface BuffAggregate {
  speedMult: number;
  jumpBonus: number;
  extraAirJumps: number;
  gravityMult: number;
  cooldownMult: number;
  wallSpeedMult: number;
}

export interface ActiveBuff {
  id: string;
  effect: Partial<PickupEffect>;
  remainingMs: number; // Infinity for whole-run
  durationMs: number;  // Infinity for whole-run; used for the HUD ratio
}

const IDENTITY: BuffAggregate = {
  speedMult: 1, jumpBonus: 0, extraAirJumps: 0,
  gravityMult: 1, cooldownMult: 1, wallSpeedMult: 1,
};

/** Fold buff effects into one set: mults multiply, jump/air-jumps add. */
export function aggregateBuffEffects(effects: Partial<PickupEffect>[]): BuffAggregate {
  return effects.reduce<BuffAggregate>((acc, e) => ({
    speedMult:     acc.speedMult     * (e.speedMult     ?? 1),
    jumpBonus:     acc.jumpBonus     + (e.jumpBonus     ?? 0),
    extraAirJumps: acc.extraAirJumps + (e.extraAirJumps ?? 0),
    gravityMult:   acc.gravityMult   * (e.gravityMult   ?? 1),
    cooldownMult:  acc.cooldownMult  * (e.cooldownMult  ?? 1),
    wallSpeedMult: acc.wallSpeedMult * (e.wallSpeedMult ?? 1),
  }), { ...IDENTITY });
}

/** Add a buff, or refresh an existing one with the same id (no duplicates). */
export function upsertBuff(active: ActiveBuff[], buff: ActiveBuff): ActiveBuff[] {
  const idx = active.findIndex(b => b.id === buff.id);
  if (idx === -1) return [...active, buff];
  const copy = active.slice();
  copy[idx] = buff;
  return copy;
}

/** Decrement timers and drop expired buffs. `changed` is true if any were dropped. */
export function tickBuffs(active: ActiveBuff[], deltaMs: number): { active: ActiveBuff[]; changed: boolean } {
  let changed = false;
  const next: ActiveBuff[] = [];
  for (const b of active) {
    if (b.remainingMs === Infinity) { next.push(b); continue; }
    const remainingMs = b.remainingMs - deltaMs;
    if (remainingMs <= 0) { changed = true; continue; }
    next.push({ ...b, remainingMs });
  }
  return { active: next, changed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/buffMath.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/systems/buffMath.ts src/systems/__tests__/buffMath.test.ts
git commit -m "feat(buffs): pure buff math (aggregate, upsert, tick)"
```

---

## Task 2: Player buff-modifier layer + Revive — TDD

**Files:**
- Modify: `src/entities/Player.ts`
- Test: `src/entities/__tests__/Player.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/entities/__tests__/Player.test.ts` (the harness `makePlayer`, `imState`, `PLAYER_SPEED`, `PLAYER_JUMP_VELOCITY` are already in this file):

```typescript
// ── Buff-modifier layer + Revive ──────────────────────────────────────────────

describe('Player — buff-modifier layer', () => {
  it('buff speedMult stacks multiplicatively with carry speedMult', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    player.setCarryModifiers({ speedMult: 1.2, jumpBonus: 0, extraAirJumps: 0 });
    player.setBuffModifiers({ speedMult: 1.5, jumpBonus: 0, extraAirJumps: 0 });
    imState.tiltFactor = 1;

    player.update(16);

    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBeCloseTo(PLAYER_SPEED * 1.2 * 1.5);
  });

  it('buff jumpBonus adds to carry jumpBonus and jumpBoost', async () => {
    const { player, spy } = await makePlayer({ onGround: true, config: { jumpBoost: 10 } });
    player.setCarryModifiers({ speedMult: 1, jumpBonus: 20, extraAirJumps: 0 });
    player.setBuffModifiers({ speedMult: 1, jumpBonus: 75, extraAirJumps: 0 });
    imState.jumpJustPressed = true;

    player.update(16);

    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY - (10 + 20 + 75));
  });
});

describe('Player — revive', () => {
  it('consumeRevive returns true once after armRevive, then false', async () => {
    const { player } = await makePlayer();
    expect(player.consumeRevive()).toBe(false);
    player.armRevive();
    expect(player.consumeRevive()).toBe(true);
    expect(player.consumeRevive()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/entities/__tests__/Player.test.ts`
Expected: FAIL — `setBuffModifiers` / `armRevive` / `consumeRevive` are not functions.

- [ ] **Step 3: Add the buff fields + revive flag**

In `src/entities/Player.ts`, find:

```typescript
  private carrySpeedMult:     number = 1;
  private carryJumpBonus:     number = 0;
  private carryExtraAirJumps: number = 0;
  private carryGravityMult:   number = 1;
  private carryCooldownMult:  number = 1;
  private shieldActive: boolean = false;
```

Replace with:

```typescript
  private carrySpeedMult:     number = 1;
  private carryJumpBonus:     number = 0;
  private carryExtraAirJumps: number = 0;
  private carryGravityMult:   number = 1;
  private carryCooldownMult:  number = 1;
  // Consumable buff layer — composes with the carry layer (mults multiply, additive add).
  private buffSpeedMult:     number = 1;
  private buffJumpBonus:     number = 0;
  private buffExtraAirJumps: number = 0;
  private buffGravityMult:   number = 1;
  private buffCooldownMult:  number = 1;
  private shieldActive: boolean = false;
  private reviveArmed:  boolean = false;
```

- [ ] **Step 4: Combine the layers at the five consumption sites**

In `src/entities/Player.ts`:

(a) Jump velocity — find `return PLAYER_JUMP_VELOCITY - (this.jumpBoost + this.carryJumpBonus);` and replace with:
```typescript
    return PLAYER_JUMP_VELOCITY - (this.jumpBoost + this.carryJumpBonus + this.buffJumpBonus);
```

(b) Air jumps — find `return this.maxAirJumps + this.carryExtraAirJumps;` and replace with:
```typescript
    return this.maxAirJumps + this.carryExtraAirJumps + this.buffExtraAirJumps;
```

(c) Gravity — find `ctx.body.setGravityY(WORLD_GRAVITY_Y * (factor * this.carryGravityMult - 1));` and replace with:
```typescript
    ctx.body.setGravityY(WORLD_GRAVITY_Y * (factor * this.carryGravityMult * this.buffGravityMult - 1));
```

(d) Move speed — find `const moveSpeed = this.placementMode ? PLACEMENT_MOVE_SPEED : PLAYER_SPEED * this.carrySpeedMult;` and replace with:
```typescript
    const moveSpeed = this.placementMode ? PLACEMENT_MOVE_SPEED : PLAYER_SPEED * this.carrySpeedMult * this.buffSpeedMult;
```

(e) Dash cooldown — find `this.dashCooldown = DASH_COOLDOWN_MS * this.carryCooldownMult;` and replace with:
```typescript
      this.dashCooldown = DASH_COOLDOWN_MS * this.carryCooldownMult * this.buffCooldownMult;
```

(f) Wall-jump cooldown — find `this.wallJumpCooldown = WALL_JUMP_COOLDOWN_MS * this.carryCooldownMult;` and replace with:
```typescript
    this.wallJumpCooldown = WALL_JUMP_COOLDOWN_MS * this.carryCooldownMult * this.buffCooldownMult;
```

- [ ] **Step 5: Add `setBuffModifiers`, `armRevive`, `consumeRevive`**

In `src/entities/Player.ts`, find the end of `setCarryModifiers` (the block that ends with the `gainedAirJump` refill and its closing brace). Immediately after that method's closing `}`, add:

```typescript
  setBuffModifiers(
    mods: { speedMult: number; jumpBonus: number; extraAirJumps: number;
            gravityMult?: number; cooldownMult?: number },
  ): void {
    const gainedAirJump = mods.extraAirJumps > this.buffExtraAirJumps;
    this.buffSpeedMult     = mods.speedMult;
    this.buffJumpBonus     = mods.jumpBonus;
    this.buffExtraAirJumps = mods.extraAirJumps;
    this.buffGravityMult   = mods.gravityMult  ?? 1;
    this.buffCooldownMult  = mods.cooldownMult ?? 1;
    if (gainedAirJump) this.airJumpsRemaining = this.effectiveMaxAirJumps;
  }

  /** Arm a one-use revive (consumed on the next fatal hit). */
  armRevive(): void { this.reviveArmed = true; }

  /** Consume the armed revive. Returns true (and disarms) if one was armed. */
  consumeRevive(): boolean {
    if (!this.reviveArmed) return false;
    this.reviveArmed = false;
    return true;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/entities/__tests__/Player.test.ts`
Expected: PASS (new buff/revive tests green; all existing Player tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/entities/Player.ts src/entities/__tests__/Player.test.ts
git commit -m "feat(player): buff-modifier layer (composes with carry) + revive flag"
```

---

## Task 3: Consumable data — catalog rename + behavior registry — TDD

**Files:**
- Modify: `src/data/itemDefs.ts`
- Create: `src/data/consumableDefs.ts`
- Test: `src/data/__tests__/consumableDefs.test.ts`

- [ ] **Step 1: Write the failing invariant test**

Create `src/data/__tests__/consumableDefs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ITEM_DEFS } from '../itemDefs';
import { CONSUMABLE_DEFS } from '../consumableDefs';

describe('consumable defs ↔ item defs consistency', () => {
  const consumableIds = ITEM_DEFS.filter(i => i.category === 'consumable').map(i => i.id);

  it('every consumable store item has a behavior', () => {
    for (const id of consumableIds) {
      expect(CONSUMABLE_DEFS[id], `missing behavior for ${id}`).toBeDefined();
    }
  });

  it('every behavior maps to a consumable store item', () => {
    const ids = new Set(consumableIds);
    for (const id of Object.keys(CONSUMABLE_DEFS)) {
      expect(ids.has(id), `behavior ${id} has no consumable item`).toBe(true);
    }
  });

  it('includes the five first-batch consumables', () => {
    for (const id of ['shield', 'revive', 'adrenaline', 'pogo', 'stall']) {
      expect(CONSUMABLE_DEFS[id]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/__tests__/consumableDefs.test.ts`
Expected: FAIL — `consumableDefs` module not found.

- [ ] **Step 3: Update `itemDefs.ts` (category rename + new entries)**

In `src/data/itemDefs.ts`, find:

```typescript
export type ItemCategory = 'placeable' | 'buff';
```

Replace with:

```typescript
// 'cosmetic' is reserved for a future store category (no items/handlers yet).
export type ItemCategory = 'placeable' | 'consumable' | 'cosmetic';
```

Then find the `shield` entry:

```typescript
  {
    id:             'shield',
    name:           'Shield',
    description:    'Absorb one fatal hit. Activates immediately.',
    cost:           150,
    category:       'buff',
    persistsOnHeap: false,
  },
```

Replace with (rename category + add the four new consumables before the closing `];`):

```typescript
  {
    id:             'shield',
    name:           'Shield',
    description:    'Absorb one fatal hit. Activates immediately.',
    cost:           150,
    category:       'consumable',
    persistsOnHeap: false,
  },
  {
    id:             'revive',
    name:           'Revive',
    description:    'Respawn once if a hit would kill you.',
    cost:           400,
    category:       'consumable',
    persistsOnHeap: false,
  },
  {
    id:             'adrenaline',
    name:           'Adrenaline',
    description:    'Surge of speed for 30 seconds.',
    cost:           200,
    category:       'consumable',
    persistsOnHeap: false,
  },
  {
    id:             'pogo',
    name:           'Pogo Spring',
    description:    'Higher jumps for 30 seconds.',
    cost:           200,
    category:       'consumable',
    persistsOnHeap: false,
  },
  {
    id:             'stall',
    name:           'Stall',
    description:    'Slow the rising trash for 15 seconds.',
    cost:           250,
    category:       'consumable',
    persistsOnHeap: false,
  },
```

- [ ] **Step 4: Create the behavior registry**

Create `src/data/consumableDefs.ts`:

```typescript
// src/data/consumableDefs.ts
//
// Run-time behavior for store consumables, keyed by item id. Storefront data
// (name/cost/description/category) lives in itemDefs.ts; this file owns what a
// consumable DOES when activated. Adding a consumable = one ITEM_DEFS entry +
// one entry here.

import type { PickupEffect } from './pickupDefs';

export type ConsumableBehavior =
  | { kind: 'modifier'; durationMs: number | null; effect: Partial<PickupEffect> } // null = whole-run
  | { kind: 'shield' }
  | { kind: 'revive' };

export const CONSUMABLE_DEFS: Record<string, ConsumableBehavior> = {
  shield:     { kind: 'shield' },
  revive:     { kind: 'revive' },
  adrenaline: { kind: 'modifier', durationMs: 30_000, effect: { speedMult: 1.3 } },
  pogo:       { kind: 'modifier', durationMs: 30_000, effect: { jumpBonus: 75 } },
  stall:      { kind: 'modifier', durationMs: 15_000, effect: { wallSpeedMult: 0.25 } },
};
```

- [ ] **Step 5: Run tests + a stray-category check**

Run: `npx vitest run src/data/__tests__/consumableDefs.test.ts`
Expected: PASS.

Run: `grep -rn "'buff'" src/` — Expected: no matches in non-test source (confirms the category rename left no strays).

Run: `npm run build` — Expected: succeeds (catches any `ItemCategory` consumers needing the new union, e.g. StoreScene — fixed in Task 6; if the build fails only in StoreScene on `'buff'`, that's expected and resolved there).

> Note: if `npm run build` fails here solely because `StoreScene.ts` still references `'buff'`, proceed — Task 6 fixes it. Re-run the full build at the end of Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/data/itemDefs.ts src/data/consumableDefs.ts src/data/__tests__/consumableDefs.test.ts
git commit -m "feat(store): consumable category + behavior registry (CONSUMABLE_DEFS)"
```

---

## Task 4: `BuffManager` (active buffs, expiry tick, HUD)

**Files:**
- Create: `src/systems/BuffManager.ts`

- [ ] **Step 1: Create the manager**

Create `src/systems/BuffManager.ts`:

```typescript
// src/systems/BuffManager.ts
//
// Owns the player's active consumable buffs: applies them, ticks down timed
// ones, drops expired ones, re-aggregates, and drives the Player buff layer +
// a small HUD timer readout. wallSpeedMult is exposed for GameScene to combine
// with the salvage wall multiplier (it is not a Player stat).

import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { ConsumableBehavior } from '../data/consumableDefs';
import { ITEM_DEFS } from '../data/itemDefs';
import { ActiveBuff, aggregateBuffEffects, tickBuffs, upsertBuff } from './buffMath';

interface BuffHudRow {
  label: Phaser.GameObjects.Text;
  barBg: Phaser.GameObjects.Rectangle;
  bar:   Phaser.GameObjects.Rectangle;
}

const HUD_X = 8;
const HUD_TOP = 90;
const HUD_ROW_H = 24;
const HUD_BAR_W = 90;

export class BuffManager {
  private active: ActiveBuff[] = [];
  private wallSpeedMult = 1;
  private readonly hudRows = new Map<string, BuffHudRow>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
  ) {}

  /** Activate a modifier consumable. Caller has already spent the item. */
  activate(id: string, behavior: Extract<ConsumableBehavior, { kind: 'modifier' }>): void {
    const dur = behavior.durationMs ?? Infinity;
    this.active = upsertBuff(this.active, { id, effect: behavior.effect, remainingMs: dur, durationMs: dur });
    this.reaggregate();
  }

  /** Tick timers each frame (deltaMs from the scene update). */
  update(deltaMs: number): void {
    if (this.active.length > 0) {
      const { active, changed } = tickBuffs(this.active, deltaMs);
      this.active = active;
      if (changed) this.reaggregate();
    }
    this.renderHud();
  }

  /** Combined wall-speed multiplier from active buffs (1 = no change). */
  getWallSpeedMult(): number { return this.wallSpeedMult; }

  private reaggregate(): void {
    const agg = aggregateBuffEffects(this.active.map(b => b.effect));
    this.player.setBuffModifiers({
      speedMult: agg.speedMult,
      jumpBonus: agg.jumpBonus,
      extraAirJumps: agg.extraAirJumps,
      gravityMult: agg.gravityMult,
      cooldownMult: agg.cooldownMult,
    });
    this.wallSpeedMult = agg.wallSpeedMult;
  }

  /** Draw/refresh a HUD row per timed buff; remove rows for expired buffs. */
  private renderHud(): void {
    const timed = this.active.filter(b => b.remainingMs !== Infinity);
    const live = new Set(timed.map(b => b.id));

    // Remove rows for buffs no longer active.
    for (const [id, row] of this.hudRows) {
      if (!live.has(id)) {
        row.label.destroy(); row.barBg.destroy(); row.bar.destroy();
        this.hudRows.delete(id);
      }
    }

    timed.forEach((b, i) => {
      const y = HUD_TOP + i * HUD_ROW_H;
      const name = ITEM_DEFS.find(d => d.id === b.id)?.name ?? b.id;
      const ratio = Math.max(0, Math.min(1, b.remainingMs / b.durationMs));

      let row = this.hudRows.get(b.id);
      if (!row) {
        row = {
          label: this.scene.add.text(HUD_X, y, name, {
            fontSize: '12px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
          }).setScrollFactor(0).setDepth(40),
          barBg: this.scene.add.rectangle(HUD_X, y + 16, HUD_BAR_W, 4, 0x000000, 0.5)
            .setOrigin(0, 0.5).setScrollFactor(0).setDepth(40),
          bar: this.scene.add.rectangle(HUD_X, y + 16, HUD_BAR_W, 4, 0xffdd55)
            .setOrigin(0, 0.5).setScrollFactor(0).setDepth(41),
        };
        this.hudRows.set(b.id, row);
      }
      row.label.setY(y);
      row.barBg.setY(y + 16);
      row.bar.setY(y + 16).setDisplaySize(HUD_BAR_W * ratio, 4);
    });
  }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds (BuffManager not yet wired in; StoreScene `'buff'` may still error — that's resolved in Task 6).

> If the only build error is `StoreScene.ts` referencing `'buff'`, proceed; otherwise fix the BuffManager error before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/systems/BuffManager.ts
git commit -m "feat(buffs): BuffManager — active buffs, expiry tick, HUD timers"
```

---

## Task 5: Integration — GameScene + PlaceableManager activation

**Files:**
- Modify: `src/systems/PlaceableManager.ts`
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: PlaceableManager — accept a BuffManager and generalize activation**

In `src/systems/PlaceableManager.ts`, add imports near the existing `import { spendItem, getItemQuantity, PlacedItemSave } from ...` and other imports at the top of the file:

```typescript
import { CONSUMABLE_DEFS } from '../data/consumableDefs';
import type { BuffManager } from './BuffManager';
```

Find the constructor signature/header:

```typescript
  constructor(
```

and the `this.scene = scene; this.player = player;` assignments. Add a `buffManager` parameter and field. Specifically, find:

```typescript
    this.scene               = scene;
    this.player              = player;
```

Replace with:

```typescript
    this.scene               = scene;
    this.player              = player;
    this.buffManager         = buffManager;
```

Add the parameter to the constructor's parameter list (it is the last parameter) and a private field. Find the constructor's first parameter block — add `buffManager: BuffManager,` as the **last** constructor parameter, and add this field declaration alongside the other private fields near the top of the class:

```typescript
  private readonly buffManager: BuffManager;
```

Then find `selectItem` and its shield branch:

```typescript
  private selectItem(itemId: string): void {
    if (itemId === 'shield') {
      this.activateShield();
      this.closeAll();
      return;
    }
```

Replace with:

```typescript
  private selectItem(itemId: string): void {
    const behavior = CONSUMABLE_DEFS[itemId];
    if (behavior) {
      if (spendItem(itemId)) {
        if (behavior.kind === 'shield')        this.player.activateShield();
        else if (behavior.kind === 'revive')   this.player.armRevive();
        else                                   this.buffManager.activate(itemId, behavior);
      }
      this.closeAll();
      return;
    }
```

Then find and DELETE the now-unused private method:

```typescript
  private activateShield(): void {
    if (!spendItem('shield')) return;
    this.player.activateShield();
  }
```

- [ ] **Step 2: GameScene — import + field + construct BuffManager before PlaceableManager**

In `src/scenes/GameScene.ts`, add the import near the other system imports (e.g. by the `import { PlaceableManager } ...` line):

```typescript
import { BuffManager } from '../systems/BuffManager';
```

Add a field near `private placeableManager!: PlaceableManager;`:

```typescript
  private buffManager!: BuffManager;
```

Find:

```typescript
    this.placeableManager = new PlaceableManager(this, this.player, this.heapWalkableGroup, this.heapWallGroup, this._heapId);
```

Replace with:

```typescript
    this.buffManager = new BuffManager(this, this.player);
    this.placeableManager = new PlaceableManager(this, this.player, this.heapWalkableGroup, this.heapWallGroup, this._heapId, this.buffManager);
```

- [ ] **Step 3: GameScene — tick BuffManager + combine wall speed**

In `src/scenes/GameScene.ts`, find:

```typescript
    this.placeableManager.update();
    this.pickupManager.update(this.player.sprite.x, this.player.sprite.y);
```

Replace with:

```typescript
    this.placeableManager.update();
    this.pickupManager.update(this.player.sprite.x, this.player.sprite.y);
    this.buffManager.update(delta);
```

Then find:

```typescript
    this.trashWallManager.update(this.player.sprite.y, delta, this.pickupManager.getWallSpeedMult());
```

Replace with:

```typescript
    this.trashWallManager.update(this.player.sprite.y, delta, this.pickupManager.getWallSpeedMult() * this.buffManager.getWallSpeedMult());
```

> Verify `delta` is the parameter name of this scene's `update(time, delta)`. If the method signature uses a different name, use that name instead.

- [ ] **Step 4: GameScene — Revive hook in `handleEnemyDamage`**

In `src/scenes/GameScene.ts`, find the shield branch in `handleEnemyDamage`:

```typescript
    // Shield absorbs the hit
    if (this.player.hasActiveShield) {
      this.player.absorbHit();
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }
```

Add immediately after it (before `if (this._playerDead) return;`):

```typescript
    // Revive: negate this fatal hit once, with a longer invuln window so the
    // same enemy doesn't immediately re-kill. (Covers fatal hits, not wall death.)
    if (this.player.consumeRevive()) {
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds (StoreScene `'buff'` may still error — resolved in Task 6; if so, proceed).

- [ ] **Step 6: Commit**

```bash
git add src/systems/PlaceableManager.ts src/scenes/GameScene.ts
git commit -m "feat(buffs): wire BuffManager into GameScene + generalize consumable activation

Activation dispatches via CONSUMABLE_DEFS (shield/revive/modifier); buff wall
speed combines with salvage for the trash wall; Revive negates a fatal hit."
```

---

## Task 6: StoreScene — consumable tab + accent colors

**Files:**
- Modify: `src/scenes/StoreScene.ts`

- [ ] **Step 1: Rename the Buff tab to Consumable**

In `src/scenes/StoreScene.ts`, find:

```typescript
const TAB_LABELS: Array<{ label: string; value: ItemCategory | 'all' }> = [
  { label: 'All',       value: 'all' },
  { label: 'Placeable', value: 'placeable' },
  { label: 'Buff',      value: 'buff' },
];
```

Replace with:

```typescript
const TAB_LABELS: Array<{ label: string; value: ItemCategory | 'all' }> = [
  { label: 'All',         value: 'all' },
  { label: 'Placeable',   value: 'placeable' },
  { label: 'Consumable',  value: 'consumable' },
];
```

- [ ] **Step 2: Add accent colors for the new items**

In `src/scenes/StoreScene.ts`, find:

```typescript
const ACCENT_COLORS: Record<string, number> = {
  ladder:     0x44cc88,
  ibeam:      0x4488ff,
  checkpoint: 0xffaa22,
  shield:     0xcc44ff,
};
```

Replace with:

```typescript
const ACCENT_COLORS: Record<string, number> = {
  ladder:     0x44cc88,
  ibeam:      0x4488ff,
  checkpoint: 0xffaa22,
  shield:     0xcc44ff,
  revive:     0xff5577,
  adrenaline: 0xff7733,
  pogo:       0x33ddff,
  stall:      0xaa88ff,
};
```

- [ ] **Step 3: Build + screenshot the store**

Run: `npm run build`
Expected: succeeds with **no** TS errors anywhere now (the `ItemCategory` union + all `'buff'` references are fully resolved).

Run: `npm run scene-preview -- StoreScene '{}' pixel7`
Expected: `screenshots/preview.png` shows the store with a **Consumable** tab; the new items appear (All tab) with their accent colors.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/StoreScene.ts
git commit -m "feat(store): Consumable tab + accent colors for new consumables"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including new `buffMath`, Player buff/revive, and `consumableDefs` cases.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: clean, no TS errors.

- [ ] **Step 3: Stray-reference check**

Run: `grep -rn "'buff'" src/`
Expected: no matches in source (category fully renamed).

- [ ] **Step 4: Device / browser smoke test (manual checklist)**

Launch (`npm run dev`), buy the consumables (dev coins via menu settings), start a run, open the hotbar, and confirm:
- **Adrenaline** — noticeably faster; HUD shows a "Adrenaline" timer bar counting down ~30s; speed returns to normal on expiry.
- **Pogo Spring** — higher jumps for ~30s; HUD timer; reverts on expiry.
- **Stall** — the rising trash wall visibly slows for ~15s, then resumes; HUD timer.
- **Revive** — on a fatal enemy hit, the player survives once (brief invuln) and does not die; a second fatal hit ends the run.
- **Shield** — still absorbs one hit (works via the generic path).
- Activating an already-active temp buff **refreshes** its timer (doesn't stack a second copy).
- A buff stacks with carried salvage of the same lever (e.g., Adrenaline + a speed pickup).

- [ ] **Step 5: Final commit if the smoke test surfaced fixes**

(Only if Step 4 required changes.)

---

## Self-Review

**Spec coverage:**
- Data-driven registry (`CONSUMABLE_DEFS`) + category rename → Task 3. ✓
- `BuffManager` expiry subsystem (tick/aggregate/wall mult/HUD) → Task 1 (math) + Task 4 (manager). ✓
- Player buff-modifier layer composing with carry + Revive → Task 2. ✓
- Generalized activation replacing shield special-case → Task 5 Step 1. ✓
- Five consumables (Shield/Revive/Adrenaline 1.3/30s, Pogo 75/30s, Stall 0.25/15s) → Task 3 (data) + behaviors. ✓
- Wall-speed combine in GameScene + Revive hook → Task 5 Steps 3–4. ✓
- HUD temp-buff timers → Task 4. ✓
- Cosmetic seam (`'cosmetic'` reserved + tab via TAB_LABELS data + documented handler) → Task 3 (type) + Task 6 (tab data). ✓
- Testing (unit: buffMath, Player composition, data invariant; build; device) → Tasks 1–3 + 7. ✓

**Placeholder scan:** none — every code step has complete code; the only conditional notes are the *expected* mid-sequence build failures from the `'buff'`→`'consumable'` rename, which Task 6 resolves and Task 7 re-verifies.

**Type/name consistency:** `ActiveBuff`, `aggregateBuffEffects`, `tickBuffs`, `upsertBuff` (Task 1) consumed by `BuffManager` (Task 4); `ConsumableBehavior` union (Task 3) dispatched in `PlaceableManager` (Task 5) and consumed by `BuffManager.activate` (Task 4); `setBuffModifiers` signature (Task 2) matches the object `BuffManager.reaggregate` passes (Task 4); `armRevive`/`consumeRevive` (Task 2) used in GameScene/PlaceableManager (Task 5); `CONSUMABLE_DEFS` keys match the new `ITEM_DEFS` `'consumable'` ids (Task 3, enforced by the invariant test).
