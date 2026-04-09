# Place-Ables Design Spec
_Date: 2026-04-08_

## Overview

A main-menu Store where players purchase consumable items to deploy during runs. Items are split into two categories: **Placeables** (physical objects dropped onto the heap world) and **Buffs** (player-state activations). Placeables that persist are saved to localStorage with world position; buffs are consumed at run end.

---

## 1. Data Model

### Static Definitions — `src/data/itemDefs.ts`

```ts
type ItemCategory = 'placeable' | 'buff';

interface Item {
  id:             string;
  name:           string;
  description:    string;
  cost:           number;
  category:       ItemCategory;
  persistsOnHeap: boolean;  // false = does not survive run end
}
```

All four launch items are defined here as `ITEM_DEFS: Item[]`.

### Runtime Constructs (assembled from def + save state)

```ts
interface InventoryItem extends Item {
  quantity: number;
}

interface PlaceableItem extends Item {
  x:     number;
  y:     number;
  meta?: Record<string, number>;  // e.g. { spawnsLeft: 5 }
}
```

These are NOT stored directly — they are assembled at runtime by merging `itemDefs` with `RawSave`.

### Serialized Save Shape

```ts
interface RawSave {
  balance:   number;
  upgrades:  Record<string, number>;
  inventory: Record<string, number>;   // id → quantity owned
  placed:    Array<{
    id:    string;
    x:     number;
    y:     number;
    meta?: Record<string, number>;
  }>;
}
```

Defaults: `inventory: {}`, `placed: []`. The existing spread-merge in `load()` handles migrating saves that lack these fields.

### New SaveData Functions

- `getInventory(): Record<string, number>` — full inventory map
- `getItemQuantity(id: string): number`
- `spendItem(id: string): boolean` — decrements quantity, returns false if 0
- `addPlaced(item: { id, x, y, meta? }): void`
- `removePlaced(index: number): void`
- `getPlaced(): PlacedItem[]`
- `updatePlacedMeta(index: number, meta: Record<string, number>): void`
- `removeExpiredPlaced(): void` — removes items where meta.spawnsLeft === 0

---

## 2. Store Scene — `src/scenes/StoreScene.ts`

Accessible from `MenuScene` alongside the Upgrades button. Visually mirrors `UpgradeScene`: same sky gradient, star field, floating clouds, scrollable rows, header/footer pattern.

### Category Filter Tabs
At the top of the header, below the title: **All | Placeable | Buff** tabs. Tapping a tab filters visible rows. Active tab highlighted in accent color.

### Item Rows
Each row shows:
- Item name + category accent bar
- Description
- Cost in coins
- `Own: N` quantity display (replaces level indicator)
- BUY button — always enabled if balance sufficient; no stock limit

### Navigation
- Desktop: arrow keys + ENTER, ESC back to menu
- Mobile: tap-to-buy, tap back button in footer

---

## 3. Placement Mode (In-Game)

### Opening the Hotbar
- **Desktop:** press `R`
- **Mobile:** tap the hotbar HUD icon (fixed bottom-left area)

This opens a horizontal inventory bar showing owned items with quantities. Items with quantity 0 are hidden.

### Selecting an Item
Tap/click an item icon in the hotbar. This enters **placement mode** for that item.

**Shield** is a special case: selecting it immediately activates the buff on the player (no placement flow), consumes 1 from inventory, and closes the hotbar.

### Placement Flow (Placeables only)
1. A ghost preview of the item appears, following touch drag or cursor
2. Ghost snaps to valid heap surfaces:
   - Ladder: any surface
   - I-Beam: any surface
   - Checkpoint: walkable-only surfaces (slope ≤ `maxWalkableSlopeDeg`)
3. Ghost is **green** when placement is valid, **red** when invalid
4. A **"Place" confirm button** appears in the HUD (fixed position, visible only during placement mode)
5. Tapping/clicking Place on a valid position:
   - Consumes 1 from inventory via `spendItem`
   - Saves to `SaveData.placed`
   - Spawns the physics object immediately
6. **Cancel:** tap the cancel button, press R again, or press ESC — returns to normal play without consuming the item

---

## 4. Item Behaviors

### Ladder (`category: 'placeable'`, `persistsOnHeap: true`)
- Placed vertically on the heap surface; height is a designer-tuned constant (approx. 4–5 player heights)
- Implemented as a static trigger zone (Arcade overlap, not collider)
- While player overlaps the ladder: climbing mode active — vertical input moves player up/down along ladder axis, gravity disabled, jump suppressed
- Exiting the overlap zone restores normal physics

### I-Beam Platform (`category: 'placeable'`, `persistsOnHeap: true`)
- Horizontal platform extending from the heap surface
- One-way static physics body: player can jump up through from below, stands on top
- Width is a designer-tuned constant

### Checkpoint (`category: 'placeable'`, `persistsOnHeap: true`)
- Placed on a flat/walkable surface only
- Only 1 checkpoint active on the heap at a time — placing a new one removes the previous from `SaveData.placed` (remaining spawns on the old checkpoint are lost)
- `meta: { spawnsLeft: 5 }` — decrements on each respawn at this checkpoint
- When `spawnsLeft` reaches 0, removed from `placed` on next `removeExpiredPlaced()` call
- On death: if a checkpoint exists with `spawnsLeft > 0`, player respawns at checkpoint world position instead of run start

### Shield (`category: 'buff'`, `persistsOnHeap: false`)
- Activates immediately on selection from hotbar — no placement flow
- Consumed from inventory immediately
- Player gets a visual indicator while shield is active (e.g. glow or icon on player sprite)
- Absorbs one hit that would otherwise end the run
- After absorbing a hit, triggers the existing `PLAYER_INVINCIBLE_MS` invincibility window to prevent a same-tick follow-up kill
- Shield does not survive run end — not saved to `placed`

---

## 5. PlaceableManager System — `src/systems/PlaceableManager.ts`

Owns all in-game placeable logic:
- At run start: reads `SaveData.placed`, spawns physics bodies for all persisting items
- During run: manages placement mode state, ghost rendering, surface validation, confirm/cancel
- On item placed: calls `SaveData.addPlaced`, spawns physics body immediately
- On checkpoint respawn: calls `SaveData.updatePlacedMeta` to decrement `spawnsLeft`, then `removeExpiredPlaced`
- At run end: calls cleanup for non-persisting items (shield state cleared from Player)

`GameScene` holds a reference to `PlaceableManager` and wires it to the Player and HUD.

---

## 6. HUD Changes — `src/ui/HUD.ts`

- New hotbar icon (bottom area) to open item selection — only visible if inventory is non-empty
- Hotbar overlay: horizontal row of item icons + quantity badges, shown on R/tap
- Placement mode UI: ghost renderer (Graphics object), Place/Cancel buttons (fixed screen position, depth above gameplay)

---

## 7. MenuScene Changes

- Add "Store" button alongside existing Upgrades button
- Navigates to `StoreScene`

---

## 8. Out of Scope (this spec)

- Multiplayer / server-backed placed items
- Item animations beyond ghost preview
- Additional item categories beyond 'placeable' and 'buff'
- Save versioning migration (tracked separately in Todo.md)
