# Consumables System — Design

**Date:** 2026-06-03
**Branch:** `feat/consumables-system`
**Playtest item:** #8 from `Todo/Todo_Playtest_Feedback.md` ("Add more things to the store"), scoped to **consumable buffs**. Cosmetic skins are a deliberate future add-on (design seams only here).

## Goal

Replace the hardcoded single-buff path (`if (itemId === 'shield')`) with a **data-driven consumables system**: adding a new consumable is one data entry. Ship five consumables on it — three timed, two whole-run — which requires a **timed-buff expiry subsystem**. Leave clean seams so a future cosmetics category drops in.

## Current state

- Store catalog: `ITEM_DEFS` (`src/data/itemDefs.ts`), `category: 'placeable' | 'buff'`. Buffs = just `shield`.
- `StoreScene` renders `ITEM_DEFS` with All / Placeable / Buff tabs; purchase → `SaveData` inventory count.
- In-run, items are selected from a hotbar in `PlaceableManager`. `selectItem` hardcodes `if (itemId === 'shield') { activateShield(); }`; everything else enters placement mode.
- `activateShield` = `spendItem('shield')` + `player.activateShield()` (a boolean + aura).
- Run-modifier levers exist on `Player` via `setCarryModifiers` — but are **owned by the salvage pickup system** (`PickupManager` aggregates carried `PickupDef`s and calls `player.setCarryModifiers`, *replacing* the values). `wallSpeedMult` is **not** a Player stat: `GameScene` reads `pickupManager.getWallSpeedMult()` and passes it to `TrashWallManager.update`.
- Death/shield: `GameScene.handleEnemyDamage` ([line 682](../src/scenes/GameScene.ts#L682)) absorbs a hit if `player.hasActiveShield`, else runs the death sequence.

## Scope

**In:**
- A consumables data model + behavior registry (data-driven).
- A `BuffManager` that owns active timed/whole-run **modifier** buffs, ticks expiry, and re-aggregates.
- A Player **buff-modifier layer** that composes with the salvage carry layer; a new **Revive** survival flag.
- Generalized activation (hotbar → registry dispatch), replacing the shield special-case.
- Five consumables: Shield (migrated), Revive, Adrenaline, Pogo Spring, Stall.
- A minimal HUD readout for active **temp** buffs (label + shrinking timer bar).
- Cosmetic-readiness seams (category enum + data-driven store tabs + documented per-category handler). No cosmetic code.

**Out:**
- Cosmetic skins (future spec).
- Run-start / pre-run loadout activation (the data model leaves room: `activation` defaults `'on-demand'`).
- `InfiniteGameScene` parity (this wires into `GameScene`; infinite mode is a follow-up).
- Any change to salvage pickups or the score model.

## Architecture

### 1. Data — store catalog vs. behavior

Keep **storefront** in `ITEM_DEFS` and **behavior** in a separate registry (mirrors how placeables keep store data in `ITEM_DEFS` and behavior in `PlaceableManager`).

- `src/data/itemDefs.ts`: rename category `'buff' → 'consumable'` (the `ItemCategory` type, the `shield` entry, and add the four new entries: `adrenaline`, `pogo`, `stall`, `revive`).
- New `src/data/consumableDefs.ts`:

```ts
import type { PickupEffect } from './pickupDefs'; // reuse the modifier-lever vocabulary

/** A consumable's run-time behavior, keyed by item id (storefront lives in ITEM_DEFS). */
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

`activation` is implicitly on-demand for now (documented; a future `'run-start'` is an additive change). `durationMs: null` denotes a whole-run modifier buff (none in this batch, but the type supports it for trivial future adds like "Extra Wing").

### 2. `BuffManager` — the expiry subsystem

New `src/systems/BuffManager.ts`, created in `GameScene`, ticked each frame:

- State: `active: { id: string; effect: Partial<PickupEffect>; remainingMs: number }[]` (whole-run buffs use `remainingMs = Infinity`).
- `activate(id, behavior)`: if a buff with that `id` is already active, **refresh** its `remainingMs` (no double-stack of one buff); else push it. Then re-aggregate.
- `update(deltaMs)`: decrement each `remainingMs`; drop any ≤ 0; if anything dropped, re-aggregate.
- **Re-aggregate**: fold active effects into a single modifier set (mults multiply, `jumpBonus`/`extraAirJumps` add), then:
  - `player.setBuffModifiers(stats)` for the Player-consumed levers (speed, jump, air-jumps, gravity, cooldown).
  - store `wallSpeedMult` for `getWallSpeedMult()` (GameScene reads it for the trash wall).
- `getActiveTimed()`: list of `{ id, remainingMs, durationMs }` for the HUD.
- A pure aggregation helper (e.g. `aggregateBuffEffects(effects)`) lives in `BuffManager` or alongside it and is **unit-tested**.

### 3. Player — buff layer + Revive

- **Buff-modifier layer:** add `buff*` fields mirroring the `carry*` fields, set via `setBuffModifiers(...)` (same shape as `setCarryModifiers`). The Player's effective stats **combine both layers**: multiplicative levers multiply (`carrySpeedMult * buffSpeedMult`, gravity, cooldown), additive levers add (`carryJumpBonus + buffJumpBonus`, `carryExtraAirJumps + buffExtraAirJumps`). Update the existing application sites to read the combined value. (`wallSpeedMult` is not a Player stat — handled in GameScene, see §4.)
- **Revive:** `armRevive()` sets a `reviveArmed` boolean; `consumeRevive(): boolean` returns true and clears it if armed. (Independent of shield.)

### 4. Activation + integration

- **`PlaceableManager.selectItem`:** replace the `if (itemId === 'shield')` branch with a consumable check: if `CONSUMABLE_DEFS[itemId]` exists, `spendItem(itemId)` then dispatch:
  - `shield` → `player.activateShield()`
  - `revive` → `player.armRevive()`
  - `modifier` → `buffManager.activate(itemId, behavior)`
  Then `closeAll()` (as shield does today). Otherwise fall through to the existing placement flow. `PlaceableManager` gets a `BuffManager` reference (injected from `GameScene`).
- **`GameScene`:**
  - Construct `BuffManager`; call `buffManager.update(delta)` in the scene update.
  - Combine wall speed: `trashWallManager.update(..., pickupManager.getWallSpeedMult() * buffManager.getWallSpeedMult())`.
  - In `handleEnemyDamage`, add a **Revive** branch after the shield branch: if `player.consumeRevive()`, grant brief invincibility + restore the player (unfreeze, refill air-jumps), play a small respawn cue, and `return` (no death). Revive covers **fatal hits** only — not trash-wall engulfment (reviving into the wall would die again immediately; excluded by design).

### 5. Store UI

- `StoreScene`: rename the Buff tab label to **Consumable** (`TAB_LABELS`); drive the tab list from the category set so adding a future `cosmetic` tab is data-only. Add `ACCENT_COLORS` entries for the new ids (`adrenaline`, `pogo`, `stall`, `revive`).

### 6. HUD — active temp buffs

A minimal screen-space readout (in `BuffManager` or `HUD`, fed by `BuffManager.getActiveTimed()`): each active **timed** buff shows a small label/icon + a shrinking bar (`remainingMs / durationMs`). Whole-run survival flags don't need a timer — Shield already shows its player aura; **Revive** shows a small persistent "armed" icon while held. Keep it compact.

### 7. Cosmetic seam (design-only)

- `ItemCategory = 'placeable' | 'consumable' | 'cosmetic'` (the third value is reserved; no cosmetic items/handlers built).
- Store tab rendering iterates the category list (so `cosmetic` is a data add later).
- Documented per-category acquire/use handler: placeable → place (PlaceableManager), consumable → activate (this system), **cosmetic → equip (future)**.

## Data flow

Purchase (StoreScene) → `SaveData` inventory++ → in run, tap consumable in hotbar (PlaceableManager) → `spendItem` + dispatch via `CONSUMABLE_DEFS` → modifier buffs go to `BuffManager` (aggregate → `player.setBuffModifiers` + wall mult) / `shield`+`revive` set Player flags → each frame `BuffManager.update(delta)` expires timed buffs and re-aggregates → HUD reflects active timers.

## The five consumables

| id | name | kind | effect | duration |
|----|------|------|--------|----------|
| `shield` | Shield | shield (until hit) | absorb 1 fatal hit | whole-run |
| `revive` | Revive | revive (one-use) | respawn on fatal hit | whole-run |
| `adrenaline` | Adrenaline | modifier (temp) | `speedMult 1.3` | 30s |
| `pogo` | Pogo Spring | modifier (temp) | `jumpBonus 75` | 30s |
| `stall` | Stall | modifier (temp) | `wallSpeedMult 0.25` | 15s |

Names/descriptions/costs for the four new `ITEM_DEFS` entries are finalized in the plan (costs are designer-tunable; suggested starting points: Adrenaline 200, Pogo 200, Stall 250, Revive 400).

## Edge cases

- **Re-activate an active temp buff:** refreshes its timer to full; effect not double-counted (one entry per id).
- **Stacking:** different temp buffs compose; a buff lever stacks with a carried-salvage lever (buff layer × carry layer).
- **Checkpoint respawn:** run continues in the same scene → active buffs keep ticking (run-scoped).
- **Run end / death (no revive) / scene shutdown:** `BuffManager` is destroyed with the scene; buffs do not persist across runs.
- **Revive + shield both held:** independent; shield absorbs first (its branch runs first), revive on a later fatal hit.
- **Pause (e.g., score overlay):** buffs only tick during the gameplay update, which is paused appropriately.
- **Empty / unowned:** activation requires `spendItem` to succeed (inventory > 0); the hotbar only shows owned items.

## Testing

- **`BuffManager` (unit):** timer decrement; expiry drops the buff and re-aggregates; same-id re-activation refreshes (no double effect); whole-run (`Infinity`) never expires; `getWallSpeedMult` reflects active Stall and reverts on expiry.
- **Aggregation helper (unit):** mults multiply, jump/air-jumps add, empty → identity.
- **Player composition (unit):** buff layer combines with carry layer (e.g., carry speed 1.15 × buff speed 1.3); `armRevive`/`consumeRevive` one-shot semantics.
- **Build** (`npm run build`).
- **Device/browser smoke:** buy each consumable; activate from hotbar; confirm Adrenaline/Pogo feel + HUD countdown; Stall visibly slows the wall and reverts after 15s; Revive respawns once on a fatal hit then is gone; Shield still works via the generic path.

## Out of scope (restated)

Cosmetic skins; run-start/loadout activation; `InfiniteGameScene`; changes to salvage pickups or scoring.
