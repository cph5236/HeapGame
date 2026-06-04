# Item Rarity Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each spawned salvage pickup a rarity tier (Common→Mythic) that scales both its gameplay effect and its score bonus, is visible before grab, and is validated server-side.

**Architecture:** A shared `Rarity` type + `RARITY_SCORE_MULT` table is the single source of truth for the multiplier (client + server). Effect scaling is auto-derived per lever (good levers grow with rarity, bad levers shrink toward neutral) via a pure `applyRarity`. Rarity is rolled at spawn by weighted `pickRarity`, carried as `{ def, rarity }`, and threaded over the wire as `salvageItems: { id, rarity }[]`, which the server validates and re-scores. The whole feature is anchored at **Rare = 1×**, so the existing tuned values stay unchanged for the Rare tier.

**Tech Stack:** TypeScript 5.9, Phaser 3.90, Vitest, Hono/Workers (server). Tests via `npm test`. Always `npm run build` before claiming done.

**Design spec:** [docs/superpowers/specs/2026-06-04-item-rarity-tiers-design.md](../specs/2026-06-04-item-rarity-tiers-design.md)

**Branch:** `feat/item-rarity-tiers` (already created).

**No DB migration** — salvage is computed, never stored as rows; the score is a single number. Schema is untouched.

---

## Task 1: Shared rarity foundation (no behavior change)

Add the rarity type + multiplier table to the shared module and make
`computeSalvageBonus` rarity-aware. Existing callers pass `rarity: 'rare'`
(identity, ×1) so behavior is **identical** after this task — this is pure
groundwork that keeps the build green.

**Files:**
- Modify: `shared/pickupScores.ts`
- Test: `shared/__tests__/pickupScores.test.ts`
- Modify (callers, keep compiling): `src/scenes/ScoreScene.ts:102-104`, `server/src/routes/scores.ts:232`

- [ ] **Step 1: Update the existing tests to the new `SalvageItem[]` signature and add rarity cases**

Replace the `computeSalvageBonus` describe block in `shared/__tests__/pickupScores.test.ts` (lines 9-22) with:

```ts
describe('computeSalvageBonus', () => {
  it('returns 0 for an empty list', () => {
    expect(computeSalvageBonus([])).toBe(0);
  });

  it('sums known item bonuses at Rare (1x identity)', () => {
    const items = [
      { id: 'spring-coil', rarity: 'rare' as const },
      { id: 'engine-block', rarity: 'rare' as const },
    ];
    expect(computeSalvageBonus(items)).toBe(
      PICKUP_BONUS['spring-coil'] + PICKUP_BONUS['engine-block'],
    );
  });

  it('ignores unknown ids (counts them as 0)', () => {
    const items = [
      { id: 'spring-coil', rarity: 'rare' as const },
      { id: 'totally-fake', rarity: 'rare' as const },
    ];
    expect(computeSalvageBonus(items)).toBe(PICKUP_BONUS['spring-coil']);
  });

  it('scales the bonus by rarity multiplier, rounded per item', () => {
    // spring-coil = 50. Common 0.75 -> 38 (round(37.5)); Mythic 2.0 -> 100.
    expect(computeSalvageBonus([{ id: 'spring-coil', rarity: 'common' }])).toBe(38);
    expect(computeSalvageBonus([{ id: 'spring-coil', rarity: 'mythic' }])).toBe(100);
  });

  it('treats an unknown rarity as 0 contribution', () => {
    // @ts-expect-error intentionally bad rarity to prove it is ignored, not NaN
    expect(computeSalvageBonus([{ id: 'spring-coil', rarity: 'ultra' }])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- shared/__tests__/pickupScores.test.ts`
Expected: FAIL — `computeSalvageBonus` still takes `string[]`; rarity cases error/throw.

- [ ] **Step 3: Add the rarity types + table and rewrite `computeSalvageBonus` in `shared/pickupScores.ts`**

Add near the top of the file, after the `PICKUP_BONUS` map (after line 31):

```ts
/** Salvage rarity tiers. Anchored at 'rare' = 1x (the existing tuned values). */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythic';

/** Multiplier applied to both effect magnitude and score bonus, per tier.
 *  Single source of truth shared by client effect-scaling and server scoring. */
export const RARITY_SCORE_MULT: Record<Rarity, number> = {
  common:    0.75,
  uncommon:  0.90,
  rare:      1.00,
  legendary: 1.40,
  mythic:    2.00,
};

/** One carried salvage item: which item, and the rarity it was found at. */
export interface SalvageItem {
  id:     string;
  rarity: Rarity;
}

/** True when `r` is a known rarity tier (used for server-side validation). */
export function isRarity(r: unknown): r is Rarity {
  return typeof r === 'string' && r in RARITY_SCORE_MULT;
}
```

Then replace the existing `computeSalvageBonus` (lines 39-44) with:

```ts
/** Sum the rarity-scaled bonuses for a list of carried items. Unknown ids or
 *  unknown rarities contribute 0. Each item is rounded independently so client
 *  and server agree exactly. */
export function computeSalvageBonus(items: readonly SalvageItem[]): number {
  let total = 0;
  for (const it of items) {
    const base = PICKUP_BONUS[it.id];
    const mult = RARITY_SCORE_MULT[it.rarity as Rarity];
    if (base === undefined || mult === undefined) continue;
    total += Math.round(base * mult);
  }
  return total;
}
```

- [ ] **Step 4: Update the two existing callers to pass the new shape (temporary `'rare'` default)**

In `src/scenes/ScoreScene.ts`, the field stays `_salvageItemIds: string[]` for now;
change only the bonus derivation (lines 102-104) to map ids to Rare:

```ts
    this._salvageBonus       = this._salvageItemIds.length > 0
      ? computeSalvageBonus(this._salvageItemIds.map(id => ({ id, rarity: 'rare' as const })))
      : (data.salvageBonus ?? 0);
```

In `server/src/routes/scores.ts`, change line 232 to:

```ts
      salvageBonus = computeSalvageBonus(salvageItemIds.map((id: string) => ({ id, rarity: 'rare' as const })));
```

- [ ] **Step 5: Run the shared tests + a typecheck build to verify green**

Run: `npm test -- shared/__tests__/pickupScores.test.ts`
Expected: PASS (all cases).
Run: `npm run build`
Expected: PASS (no TS errors — callers compile with the new signature).

- [ ] **Step 6: Commit**

```bash
git add shared/pickupScores.ts shared/__tests__/pickupScores.test.ts src/scenes/ScoreScene.ts server/src/routes/scores.ts
git commit -m "feat(rarity): shared Rarity type + rarity-aware computeSalvageBonus

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rarity table + effect scaling (`applyRarity`)

Add the client-side rarity table (spawn weights, colors, labels, glow tuning)
and the pure effect-scaling function. Nothing consumes it yet.

**Files:**
- Modify: `src/data/pickupDefs.ts`
- Test: Create `src/data/__tests__/pickupDefs.test.ts`

- [ ] **Step 1: Write the failing tests for `applyRarity`**

Create `src/data/__tests__/pickupDefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyRarity, RARITY_DEFS, PickupEffect } from '../pickupDefs';

const skateboard: PickupEffect = { speedMult: 1.15, jumpBonus: -50, extraAirJumps: 0 };

describe('applyRarity', () => {
  it('is the identity at Rare (1x)', () => {
    expect(applyRarity(skateboard, 'rare')).toEqual(skateboard);
  });

  it('grows the good lever and shrinks the bad lever at Mythic', () => {
    const m = applyRarity(skateboard, 'mythic'); // mult 2.0
    // good: speed delta +0.15 -> x2 = +0.30 -> 1.30
    expect(m.speedMult).toBeCloseTo(1.30, 5);
    // bad: jump -50 -> x(1/2) = -25
    expect(m.jumpBonus).toBeCloseTo(-25, 5);
  });

  it('shrinks the good lever and grows the bad lever at Common', () => {
    const c = applyRarity(skateboard, 'common'); // mult 0.75
    expect(c.speedMult).toBeCloseTo(1 + 0.15 * 0.75, 5); // 1.1125
    expect(c.jumpBonus).toBeCloseTo(-50 / 0.75, 5);      // -66.67
  });

  it('treats gravity/cooldown/wallSpeed below 1 as the beneficial direction', () => {
    // feather: gravityMult 0.92 (float = good) -> Mythic pushes further down
    const feather: PickupEffect = { speedMult: 1, jumpBonus: 0, extraAirJumps: 0, gravityMult: 0.92 };
    const m = applyRarity(feather, 'mythic');
    expect(m.gravityMult!).toBeCloseTo(1 + (0.92 - 1) * 2, 5); // 0.84
  });

  it('reduces a harmful gravity penalty toward neutral at Mythic', () => {
    // concrete-boots: gravityMult 1.25 (heavy = bad)
    const boots: PickupEffect = { speedMult: 1, jumpBonus: 0, extraAirJumps: 0, gravityMult: 1.25 };
    const m = applyRarity(boots, 'mythic');
    expect(m.gravityMult!).toBeCloseTo(1 + 0.25 / 2, 5); // 1.125
  });

  it('never scales extraAirJumps (discrete capability)', () => {
    const balloon: PickupEffect = { speedMult: 1, jumpBonus: 0, extraAirJumps: 1 };
    expect(applyRarity(balloon, 'mythic').extraAirJumps).toBe(1);
    expect(applyRarity(balloon, 'common').extraAirJumps).toBe(1);
  });

  it('leaves undefined optional levers undefined', () => {
    const r = applyRarity(skateboard, 'mythic');
    expect(r.gravityMult).toBeUndefined();
    expect(r.cooldownMult).toBeUndefined();
    expect(r.wallSpeedMult).toBeUndefined();
  });

  it('clamps multiplicative levers to a small positive floor', () => {
    // engine-block at Common makes speed slower; ensure it never goes <= 0
    const block: PickupEffect = { speedMult: 0.75, jumpBonus: 0, extraAirJumps: 0 };
    const c = applyRarity(block, 'common');
    expect(c.speedMult).toBeGreaterThan(0);
  });
});

describe('RARITY_DEFS', () => {
  it('has an entry for every tier with a positive spawn weight', () => {
    for (const r of ['common', 'uncommon', 'rare', 'legendary', 'mythic'] as const) {
      expect(RARITY_DEFS[r].spawnWeight).toBeGreaterThan(0);
      expect(typeof RARITY_DEFS[r].color).toBe('number');
      expect(RARITY_DEFS[r].label.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/data/__tests__/pickupDefs.test.ts`
Expected: FAIL — `applyRarity` / `RARITY_DEFS` not exported.

- [ ] **Step 3: Implement `RARITY_DEFS`, `scaleLever`, and `applyRarity` in `src/data/pickupDefs.ts`**

Add the import at the top (after line 11's existing `PICKUP_BONUS` import):

```ts
import { Rarity, RARITY_SCORE_MULT } from '../../shared/pickupScores';
export type { Rarity } from '../../shared/pickupScores';
```

Add after the `PickupEffect` interface (after line 26):

```ts
/** Per-tier presentation + spawn tuning. The score/effect multiplier itself
 *  lives in shared RARITY_SCORE_MULT (single source of truth). */
export interface RarityDef {
  /** Relative spawn weight (normalised over the sum at roll time). */
  spawnWeight: number;
  /** Tier color for the glow halo + overlay label. */
  color:       number;
  /** Short uppercase label shown in the proximity overlay. */
  label:       string;
  /** Glow halo base scale + alpha, so rarer items read as more special. */
  glowScale:   number;
  glowAlpha:   number;
}

export const RARITY_DEFS: Record<Rarity, RarityDef> = {
  common:    { spawnWeight: 50, color: 0x9aa0ad, label: 'COMMON',    glowScale: 0.70, glowAlpha: 0.55 },
  uncommon:  { spawnWeight: 28, color: 0x5fd66b, label: 'UNCOMMON',  glowScale: 0.85, glowAlpha: 0.70 },
  rare:      { spawnWeight: 15, color: 0x4aa3ff, label: 'RARE',      glowScale: 1.00, glowAlpha: 0.85 },
  legendary: { spawnWeight: 6,  color: 0xb45cff, label: 'LEGENDARY', glowScale: 1.15, glowAlpha: 0.95 },
  mythic:    { spawnWeight: 1,  color: 0xffc23d, label: 'MYTHIC',    glowScale: 1.30, glowAlpha: 1.00 },
};

/** Scale one effect lever for rarity. Good deltas (matching `benefDir`) grow by
 *  `m`; bad deltas shrink toward neutral by `1/m`. `floor` clamps multiplicative
 *  levers off zero. */
function scaleLever(
  value: number, neutral: number, benefDir: 1 | -1, m: number, floor = -Infinity,
): number {
  const d = value - neutral;
  if (d === 0) return value;
  const factor = Math.sign(d) === benefDir ? m : 1 / m;
  return Math.max(floor, neutral + d * factor);
}

/** Apply rarity scaling to an effect: good levers grow, bad levers shrink toward
 *  neutral. `extraAirJumps` is discrete and never scaled. */
export function applyRarity(effect: PickupEffect, rarity: Rarity): PickupEffect {
  const m = RARITY_SCORE_MULT[rarity];
  return {
    speedMult:     scaleLever(effect.speedMult, 1, +1, m, 0.05),
    jumpBonus:     scaleLever(effect.jumpBonus, 0, +1, m),
    extraAirJumps: effect.extraAirJumps,
    gravityMult:   effect.gravityMult  === undefined ? undefined : scaleLever(effect.gravityMult,  1, -1, m, 0.05),
    cooldownMult:  effect.cooldownMult === undefined ? undefined : scaleLever(effect.cooldownMult, 1, -1, m, 0.05),
    wallSpeedMult: effect.wallSpeedMult === undefined ? undefined : scaleLever(effect.wallSpeedMult, 1, -1, m, 0.05),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/data/__tests__/pickupDefs.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/data/pickupDefs.ts src/data/__tests__/pickupDefs.test.ts
git commit -m "feat(rarity): RARITY_DEFS table + player-favoring applyRarity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Weighted `pickRarity` helper

A pure, deterministic weighted-selection helper for choosing a tier at spawn.
Nothing consumes it yet.

**Files:**
- Modify: `src/systems/PickupHelpers.ts`
- Test: Create `src/systems/__tests__/PickupHelpers.rarity.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/PickupHelpers.rarity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickRarity } from '../PickupHelpers';
import { RARITY_DEFS } from '../../data/pickupDefs';
import type { Rarity } from '../../../shared/pickupScores';

const WEIGHTS = (Object.keys(RARITY_DEFS) as Rarity[]).map(
  r => [r, RARITY_DEFS[r].spawnWeight] as [Rarity, number],
);

describe('pickRarity', () => {
  it('returns the first tier when rand is 0', () => {
    expect(pickRarity(0, WEIGHTS)).toBe('common');
  });

  it('returns the last tier when rand is just below 1', () => {
    expect(pickRarity(0.999999, WEIGHTS)).toBe('mythic');
  });

  it('selects the tier whose cumulative band contains rand', () => {
    // total weight 100; common band [0,0.5), uncommon [0.5,0.78), rare [0.78,0.93)
    expect(pickRarity(0.40, WEIGHTS)).toBe('common');
    expect(pickRarity(0.60, WEIGHTS)).toBe('uncommon');
    expect(pickRarity(0.85, WEIGHTS)).toBe('rare');
  });

  it('roughly matches the weight distribution over many rolls', () => {
    const counts: Record<string, number> = {};
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const r = pickRarity((i + 0.5) / N, WEIGHTS);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    // common ~50% — allow a wide tolerance band
    expect(counts['common'] / N).toBeGreaterThan(0.45);
    expect(counts['common'] / N).toBeLessThan(0.55);
    expect(counts['mythic'] / N).toBeLessThan(0.03);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/systems/__tests__/PickupHelpers.rarity.test.ts`
Expected: FAIL — `pickRarity` not exported.

- [ ] **Step 3: Implement `pickRarity` in `src/systems/PickupHelpers.ts`**

Add the import at the top (after line 6):

```ts
import type { Rarity } from '../../shared/pickupScores';
```

Add at the end of the file:

```ts
/** Choose a rarity tier by weighted selection.
 *
 * @param rand    A random value in [0, 1) (injected for determinism).
 * @param weights Ordered [tier, weight] pairs; weights need not sum to 1.
 */
export function pickRarity(
  rand: number,
  weights: readonly (readonly [Rarity, number])[],
): Rarity {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let threshold = rand * total;
  for (const [tier, w] of weights) {
    threshold -= w;
    if (threshold < 0) return tier;
  }
  return weights[weights.length - 1][0]; // fp safety net
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/systems/__tests__/PickupHelpers.rarity.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/systems/PickupHelpers.ts src/systems/__tests__/PickupHelpers.rarity.test.ts
git commit -m "feat(rarity): weighted pickRarity helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Carried items become rarity-aware (`aggregateModifiers`)

Change the carry model from `PickupDef[]` to `CarriedPickup[]` (`{ def, rarity }`)
and make `aggregateModifiers` apply rarity scaling to both effects and the summed
bonus. PickupManager is updated to carry a `'rare'` default so behavior is
**identical** until Task 5 rolls real rarity.

**Files:**
- Modify: `src/data/pickupDefs.ts`
- Modify: `src/systems/PickupManager.ts`
- Test: `src/data/__tests__/pickupDefs.test.ts`

- [ ] **Step 1: Write the failing tests for rarity-aware `aggregateModifiers`**

Append to `src/data/__tests__/pickupDefs.test.ts`:

```ts
import { aggregateModifiers, PICKUP_DEFS } from '../pickupDefs';

describe('aggregateModifiers (rarity-aware)', () => {
  const springCoil = PICKUP_DEFS.find(d => d.id === 'spring-coil')!; // jump +50, bonus 50

  it('applies rarity scaling to a single carried item at Mythic', () => {
    const agg = aggregateModifiers([{ def: springCoil, rarity: 'mythic' }]);
    expect(agg.jumpBonus).toBeCloseTo(100, 5); // +50 good lever x2
    expect(agg.totalBonus).toBe(100);          // 50 x 2
  });

  it('matches the old behavior at Rare (identity)', () => {
    const agg = aggregateModifiers([{ def: springCoil, rarity: 'rare' }]);
    expect(agg.jumpBonus).toBe(50);
    expect(agg.totalBonus).toBe(50);
  });

  it('composes a mixed-rarity stack', () => {
    const agg = aggregateModifiers([
      { def: springCoil, rarity: 'rare' },    // +50 jump, 50 pts
      { def: springCoil, rarity: 'common' },  // +37.5 jump, round(37.5)=38 pts
    ]);
    expect(agg.jumpBonus).toBeCloseTo(50 + 50 * 0.75, 5);
    expect(agg.totalBonus).toBe(50 + 38);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/data/__tests__/pickupDefs.test.ts`
Expected: FAIL — `aggregateModifiers` still takes `PickupDef[]`; no `CarriedPickup`.

- [ ] **Step 3: Add `CarriedPickup` and rewrite `aggregateModifiers` in `src/data/pickupDefs.ts`**

Add after the `CarryModifiers` interface (after line 57):

```ts
/** A carried pickup paired with the rarity it was found at. */
export interface CarriedPickup {
  def:    PickupDef;
  rarity: Rarity;
}
```

Replace `aggregateModifiers` (lines 62-76) with:

```ts
export function aggregateModifiers(carried: readonly CarriedPickup[]): CarryModifiers {
  return carried.reduce<CarryModifiers>(
    (acc, { def, rarity }) => {
      const e = applyRarity(def.effect, rarity);
      return {
        speedMult:     acc.speedMult * e.speedMult,
        jumpBonus:     acc.jumpBonus + e.jumpBonus,
        extraAirJumps: acc.extraAirJumps + e.extraAirJumps,
        gravityMult:   acc.gravityMult * (e.gravityMult ?? 1),
        cooldownMult:  acc.cooldownMult * (e.cooldownMult ?? 1),
        wallSpeedMult: acc.wallSpeedMult * (e.wallSpeedMult ?? 1),
        totalBonus:    acc.totalBonus + Math.round(def.scoreBonus * RARITY_SCORE_MULT[rarity]),
      };
    },
    { speedMult: 1, jumpBonus: 0, extraAirJumps: 0,
      gravityMult: 1, cooldownMult: 1, wallSpeedMult: 1, totalBonus: 0 },
  );
}
```

- [ ] **Step 4: Update PickupManager to carry `CarriedPickup` (temporary `'rare'` default)**

In `src/systems/PickupManager.ts`:

Update the import on line 15 to include `CarriedPickup`:

```ts
import { PICKUP_DEFS, PickupDef, CarriedPickup, aggregateModifiers, formatEffectSummary, CarryModifiers } from '../data/pickupDefs';
```

Change the `carried` field (line 70) to:

```ts
  private carried:    CarriedPickup[]  = [];
```

Change `getCarriedIds` (line 166) to map through `.def`:

```ts
  getCarriedIds(): string[] { return this.carried.map(c => c.def.id); }
```

Change the grab push (line 215) to carry Rare for now (Task 5 swaps in the real roll):

```ts
      this.carried.push({ def: pickup.def, rarity: 'rare' });
```

Update the HUD count reference (line 372) — `this.carried.length` already works, no change needed.

- [ ] **Step 5: Run the data tests + build to verify green**

Run: `npm test -- src/data/__tests__/pickupDefs.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: PASS (PickupManager compiles with `CarriedPickup`).

- [ ] **Step 6: Commit**

```bash
git add src/data/pickupDefs.ts src/systems/PickupManager.ts src/data/__tests__/pickupDefs.test.ts
git commit -m "feat(rarity): rarity-aware carry model + aggregateModifiers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Thread real rarity end-to-end (spawn → carry → wire → server)

Roll a real rarity at spawn, carry it through grab, expose it as
`getCarriedItems(): SalvageItem[]`, send it over the wire as `salvageItems`, and
validate + score it on the server. After this task, client display and server
score agree on rarity-scaled values.

**Files:**
- Modify: `src/systems/PickupManager.ts`
- Modify: `src/scenes/GameScene.ts:619`
- Modify: `src/scenes/ScoreScene.ts` (data type, derivation, submit)
- Modify: `server/src/routes/scores.ts`
- Test: `server/tests/scores.test.ts` (add rarity cases)

- [ ] **Step 1: Roll rarity at spawn and store it on the pickup**

In `src/systems/PickupManager.ts`:

Add `Rarity`, `RARITY_DEFS`, and `pickRarity` to imports. Update line 15 import to add `RARITY_DEFS`:

```ts
import { PICKUP_DEFS, PickupDef, CarriedPickup, RARITY_DEFS, aggregateModifiers, formatEffectSummary, CarryModifiers } from '../data/pickupDefs';
```

Add to the helper import on line 16:

```ts
import { shouldSpawnPickup, findNearestInRange, walkableSurfaceCandidates, pickPolarity, pickRarity } from './PickupHelpers';
```

Add to the shared import on line 18:

```ts
import { SALVAGE_MIN_SPACING_PX, Rarity, SalvageItem } from '../../shared/pickupScores';
```

Add a `rarity` field to the `SpawnedPickup` interface (after line 39's `def`):

```ts
interface SpawnedPickup {
  def:       PickupDef;
  rarity:    Rarity;
  obj:       Phaser.GameObjects.Container; // [glow, core]
  glow:      Phaser.GameObjects.Image;     // pulsing halo (own tween)
  x:         number;
  y:         number;
  collected: boolean;
}
```

Add a module-level constant near the other consts (after line 29):

```ts
/** Ordered [tier, weight] pairs for pickRarity, derived once from RARITY_DEFS. */
const RARITY_WEIGHTS = (Object.keys(RARITY_DEFS) as Rarity[])
  .map(r => [r, RARITY_DEFS[r].spawnWeight] as [Rarity, number]);
```

In `trySpawnAt` (lines 132-142), roll a rarity and pass it through. Replace the body's `this.spawnPickup(def, x, surfaceY);` line (140) with:

```ts
    const rarity = pickRarity(Math.random(), RARITY_WEIGHTS);
    this.spawnPickup(def, rarity, x, surfaceY);
```

- [ ] **Step 2: Thread rarity through `spawnPickup`, `devForceSpawn`, and `grab`**

Change `spawnPickup` signature (line 172) and its final push (line 199):

```ts
  private spawnPickup(def: PickupDef, rarity: Rarity, x: number, surfaceY: number): void {
```

```ts
    this.pickups.push({ def, rarity, obj, glow, x, y, collected: false });
```

Change `devForceSpawn` (line 157) to accept + forward rarity:

```ts
  devForceSpawn(def: PickupDef, rarity: Rarity, x: number, surfaceY: number): void {
    this.spawnPickup(def, rarity, x, surfaceY);
  }
```

Change the grab push (the line edited in Task 4, now line ~215) to use the real rarity:

```ts
      this.carried.push({ def: pickup.def, rarity: pickup.rarity });
```

- [ ] **Step 3: Replace `getCarriedIds` with `getCarriedItems`**

Change `getCarriedIds` (line 165-166) to:

```ts
  /** Carried items + rarities — sent to the server for authoritative scoring. */
  getCarriedItems(): SalvageItem[] { return this.carried.map(c => ({ id: c.def.id, rarity: c.rarity })); }
```

- [ ] **Step 4: Find any other `devForceSpawn` callers and fix them**

Run: `grep -rn "devForceSpawn" src --include=*.ts`
For each caller (e.g. a scene-preview hook), add a rarity argument. If a caller has no obvious tier, pass `'rare'`. Example edit pattern:

```ts
// before: pm.devForceSpawn(def, x, y)
// after:  pm.devForceSpawn(def, 'rare', x, y)
```

(If `grep` shows no callers other than the definition, skip this step.)

- [ ] **Step 5: Update GameScene to pass `salvageItems` to ScoreScene**

In `src/scenes/GameScene.ts`, change line 619 from `salvageItemIds: this.pickupManager.getCarriedIds(),` to:

```ts
            salvageItems: this.pickupManager.getCarriedItems(),
```

- [ ] **Step 6: Update ScoreScene to receive, derive, and submit `salvageItems`**

In `src/scenes/ScoreScene.ts`:

Add the shared import (find the existing `computeSalvageBonus` import near the top and extend it):

```ts
import { computeSalvageBonus, SalvageItem } from '../../shared/pickupScores';
```

Change the field declaration (line 44) from `_salvageItemIds: string[]` to:

```ts
  private _salvageItems: SalvageItem[]                      = [];
```

Change the `init` data type (line 83) and assignment (lines 99-104):

```ts
    salvageItems?:        SalvageItem[];
```

```ts
    this._salvageItems       = data.salvageItems        ?? [];
    // Derive the bonus from items (matching the server). Fall back to a raw
    // salvageBonus only for dev-preview convenience.
    this._salvageBonus       = this._salvageItems.length > 0
      ? computeSalvageBonus(this._salvageItems)
      : (data.salvageBonus ?? 0);
```

Change the submit payload (line 927) from `salvageItemIds: this._salvageItemIds,` to:

```ts
            salvageItems: this._salvageItems,
```

- [ ] **Step 7: Replace the existing salvage test block with `salvageItems` + rarity cases**

The existing `describe('POST /scores — salvage pickups', ...)` block in
`server/tests/scores.test.ts` (lines 480-520) uses the old `salvageItemIds`
payload and will break on the rename. **Replace the entire block** (lines
480-520) with the following, which reuses the file's existing `makeApp`,
`submitScore`, `validBody`, `SubmitScoreResponse`, and `PICKUP_BONUS` helpers:

```ts
// ── POST /scores — salvage pickups ──────────────────────────────────────────────

describe('POST /scores — salvage pickups', () => {
  it('adds validated salvage bonuses to the recomputed score (Rare = 1x)', async () => {
    const res  = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItems: [
        { id: 'spring-coil', rarity: 'rare' },
        { id: 'worn-boot',   rarity: 'rare' },
      ] },
    }));
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.score).toBe(1000 + PICKUP_BONUS['spring-coil'] + PICKUP_BONUS['worn-boot']);
  });

  it('scales the salvage bonus by rarity multiplier', async () => {
    // spring-coil base 50: rare 50 + mythic 100 = 150
    const res  = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItems: [
        { id: 'spring-coil', rarity: 'rare' },
        { id: 'spring-coil', rarity: 'mythic' },
      ] },
    }));
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.score).toBe(1000 + 50 + 100);
  });

  it('ignores unknown salvage ids (counts them as 0)', async () => {
    const res  = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItems: [
        { id: 'spring-coil',     rarity: 'rare' },
        { id: 'not-a-real-item', rarity: 'rare' },
      ] },
    }));
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.score).toBe(1000 + PICKUP_BONUS['spring-coil']);
  });

  it('scores normally when salvageItems is omitted', async () => {
    const res  = await submitScore(makeApp(), validBody({ inputs: { baseHeightPx: 1000 } }));
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.score).toBe(1000);
  });

  it('rejects a salvage list that exceeds the height-derived cap', async () => {
    // baseHeightPx 1000 → maxSalvageItems = floor(1000/700)+2 = 3; 4 items is too many
    const res = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItems: [
        { id: 'spring-coil', rarity: 'rare' },
        { id: 'spring-coil', rarity: 'rare' },
        { id: 'spring-coil', rarity: 'rare' },
        { id: 'spring-coil', rarity: 'rare' },
      ] },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects salvageItems with an unknown rarity tier', async () => {
    const res = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItems: [{ id: 'spring-coil', rarity: 'ultra' }] as unknown as [] },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects salvageItems that is not an array of valid {id,rarity} objects', async () => {
    const res = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItems: [1, 2, 3] as unknown as [] },
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 8: Run the server tests to verify they fail**

Run: `npm test -- server/tests/scores.test.ts`
Expected: FAIL — server still reads `salvageItemIds`, so `salvageItems` is ignored and the rarity/reject cases don't behave.

- [ ] **Step 9: Update the server to parse + validate + score `salvageItems`**

In `server/src/routes/scores.ts`:

Extend the shared import on line 18:

```ts
import { computeSalvageBonus, maxSalvageItems, isRarity, SalvageItem } from '../../../shared/pickupScores';
```

Change the destructure on line 117 to read `salvageItems`:

```ts
    const { baseHeightPx, kills, elapsedMs, isFailure, salvageItems } = inputs;
```

Replace the whole salvage block (lines 213-233) with:

```ts
    // Salvage pickups — validate shape (id + known rarity), cap the count by
    // plausible climb, then score from the server's own bonus table.
    let salvageBonus = 0;
    if (salvageItems !== undefined) {
      const validShape = Array.isArray(salvageItems) && salvageItems.every(
        (it: unknown) =>
          it !== null && typeof it === 'object' &&
          typeof (it as SalvageItem).id === 'string' &&
          isRarity((it as SalvageItem).rarity),
      );
      if (!validShape) {
        console.warn(`[scores] reject: bad salvageItems (heapId=${heapId})`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad salvageItems', heapId });
        }
        return c.json({ error: 'invalid score submission' }, 400);
      }
      const cap = maxSalvageItems(baseHeightPx);
      if (salvageItems.length > cap) {
        console.warn(`[scores] reject: salvage count ${salvageItems.length} exceeds cap ${cap} (heapId=${heapId})`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'score:rejected', { reason: 'salvage count exceeds cap', heapId, count: salvageItems.length, cap });
        }
        return c.json({ error: 'invalid score submission' }, 400);
      }
      salvageBonus = computeSalvageBonus(salvageItems as SalvageItem[]);
    }
```

- [ ] **Step 10: Run the server tests + full build to verify green**

Run: `npm test -- server/tests/scores.test.ts`
Expected: PASS (scoring + reject-unknown-rarity + count-cap).
Run: `npm run build`
Expected: PASS (client + server compile; no remaining `salvageItemIds`).

- [ ] **Step 11: Verify no stale `salvageItemIds` references remain**

Run: `grep -rn "salvageItemIds\|getCarriedIds" src server shared --include=*.ts`
Expected: no matches (all renamed). If any remain, update them to the
`salvageItems` / `getCarriedItems` equivalents and re-run Step 10.

- [ ] **Step 12: Commit**

```bash
git add src/systems/PickupManager.ts src/scenes/GameScene.ts src/scenes/ScoreScene.ts server/src/routes/scores.ts server/tests/scores.test.ts
git commit -m "feat(rarity): thread rarity spawn->carry->wire->server scoring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Rarity visuals (glow + overlay tier label)

Drive the pickup glow by rarity tier (color, scale, alpha) and show a colored
tier label in the proximity overlay, so rarer items read as special before grab.

**Files:**
- Modify: `src/systems/PickupManager.ts`

- [ ] **Step 1: Tint + scale the glow by rarity in `spawnPickup`**

In `src/systems/PickupManager.ts`, inside `spawnPickup` (after Task 5 its
signature is `(def, rarity, x, surfaceY)`), replace the glow creation + pulse
tween (lines 179-193) with rarity-driven values:

```ts
    const rdef = RARITY_DEFS[rarity];
    // Pulsing radial-gradient halo in the rarity colour (rarer = bigger/brighter).
    const glow = this.scene.add.image(0, 0, GLOW_TEX_KEY)
      .setTint(rdef.color)
      .setScale(rdef.glowScale)
      .setAlpha(rdef.glowAlpha);
    // Solid item circle keeps the item's own colour.
    const core = this.scene.add.circle(0, 0, PICKUP_CORE_RADIUS, def.color, 1)
      .setStrokeStyle(1.5, 0xffffff, 0.85);

    const obj = this.scene.add.container(x, y, [glow, core]).setDepth(8);

    // Halo pulse (own tween on the glow child), amplitude scaled by rarity.
    this.scene.tweens.add({
      targets: glow, scale: rdef.glowScale * 1.45, alpha: Math.max(0.4, rdef.glowAlpha - 0.25),
      duration: 750, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });
```

- [ ] **Step 2: Add a colored tier label to the proximity overlay**

In `createOverlay` (after `this.overlayName` is created, ~line 278), add a tier
label text object:

```ts
    this.overlayRarity = s.add.text(0, 0, '', {
      fontSize: '12px', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(32);
```

Declare the field near the other overlay fields (after line 80):

```ts
  private overlayRarity!: Phaser.GameObjects.Text;
```

Add it to the `overlayParts` array (line 294-296) so it shows/hides with the panel:

```ts
    this.overlayParts = [
      this.overlayBg, this.overlayName, this.overlayRarity, this.overlayFlavor, this.overlayEffect, this.overlayBonus, this.overlayPrompt,
    ];
```

In `refreshOverlay`, set the label text/color/position from the active pickup's
rarity. After the `overlayName` line (line 311), add:

```ts
    const rdef = RARITY_DEFS[p.rarity];
    this.overlayRarity
      .setPosition(cx, topY - 128)
      .setText(rdef.label)
      .setColor('#' + rdef.color.toString(16).padStart(6, '0'))
      .setVisible(true);
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Visually verify the overlay + glow at phone size**

Run: `npm run scene-preview -- GameScene '{}' pixel7`
(If GameScene needs a dev hook to force-spawn a known-rarity pickup, use the
`devForceSpawn(def, rarity, x, y)` path. Otherwise inspect via `npm run dev` and
walk up to a spawned pickup.)
Expected: glow color matches the tier ramp (grey→green→blue→purple→gold); the
overlay shows a colored tier label above the item name.

- [ ] **Step 5: Commit**

```bash
git add src/systems/PickupManager.ts
git commit -m "feat(rarity): rarity-driven glow + overlay tier label

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — all suites, including the new rarity tests.

- [ ] **Step 2: Production build (catches TS errors tests miss)**

Run: `npm run build`
Expected: PASS, no errors.

- [ ] **Step 3: Grep for leftover transitional `'rare'` defaults**

Run: `grep -rn "rarity: 'rare'" src server --include=*.ts`
Expected: only legitimate fallbacks remain (e.g. a `devForceSpawn` caller with no
real tier, or the dev-preview `salvageBonus` path). The grab path and wire path
must use the rolled rarity (from `pickup.rarity`), **not** a literal `'rare'`.
If a literal remains in `grab` or in the score submission, it's a bug — fix it.

- [ ] **Step 4: Smoke test a real run**

Run: `npm run dev` (port 3000), play a short run, grab a few pickups of varied
rarity, reach the top, and confirm: the carried HUD bonus reflects rarity, the
score screen's salvage bonus matches, and the server accepts the submission
(check the network tab / server logs for a 200, not a reject).

- [ ] **Step 5: Update the Todo to mark item #5 done (optional housekeeping)**

If desired, note in `Todo/Todo_Playtest_Feedback.md` that item #5 is implemented
on `feat/item-rarity-tiers`, then commit that doc change.

---

## Done criteria

- All `npm test` suites pass; `npm run build` is clean.
- Pickups spawn with a visible rarity (glow + label); effects and score scale by
  tier with Rare == today's values.
- The server validates `salvageItems` rarity, rejects unknown tiers, preserves
  the count cap, and re-scores authoritatively.
- No `salvageItemIds` / `getCarriedIds` references remain.
