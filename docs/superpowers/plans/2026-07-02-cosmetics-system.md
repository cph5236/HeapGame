# Cosmetics System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Character cosmetics: 52 items across 5 slots (hat/face/tie/skin/trail), bought with coins in a new character-editor scene, rendered on the in-game player, and shown as mini-avatars on the top-5 leaderboard rows via a server-synced loadout.

**Architecture:** Client-authoritative economy (like upgrades/consumables) — coins, ownership, and equipped state live in `SaveData` + GPGS cloud merge. The server stores only the equipped loadout (JSON blob keyed by `playerGuid`) in a new `player_customization` table in the `heap_scores` D1 DB, LEFT-JOINed into leaderboard reads. One shared avatar compositor renders the bag+cosmetics in-game, in the editor, and on leaderboards.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vite 6, Hono + D1 (Cloudflare Worker), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-cosmetics-system-design.md`

## Global Constraints

- Work on branch `feature/cosmetics-system` (already created). NEVER push to main; do not push at all unless the user asks.
- `npm test` runs all Vitest suites (root covers `src/`, `shared/`, `server/tests/`). Run from repo root.
- **Always run `npm run build` before claiming work done** — it catches TS errors tests miss.
- D1 schema changes need BOTH a migration file (`server/migrations/heap_scores/NNNN_*.sql`, incremental SQL only) AND the reference schema (`server/schema/heap_scores.sql`) updated to final state. Never edit an applied migration.
- Do NOT start or kill a Vite dev server — the user runs their own on `localhost:3000`.
- Do not commit `.wrangler/state/`.
- All git commits: no push, message style `feat(cosmetics): …` / `test:` / `docs:`, end body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Player sprite facts used throughout: texture `trashbag-nostrings` is 174×197 px, displayed at `PLAYER_WIDTH`=40 × `PLAYER_HEIGHT`=46 logical px (origin center), so baseScale ≈ 0.2335. Tie strings are drawn by `PlayerAnimator` at collar offset `PLAYER_HEIGHT * -1.2 * baseScaleY` ≈ −13 logical px from center.

---

### Task 1: Shared cosmetic catalog + loadout validation

**Files:**
- Create: `shared/cosmeticCatalog.ts`
- Test: `shared/__tests__/cosmeticCatalog.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; no Phaser, no imports — it must stay importable by the Worker).
- Produces: `CosmeticSlot`, `COSMETIC_SLOTS`, `CatalogEntry`, `COSMETIC_CATALOG`, `EquippedLoadout`, `getCatalogEntry(id): CatalogEntry | undefined`, `validateLoadout(input: unknown): EquippedLoadout | null`, `MAX_LOADOUT_JSON_LEN = 512`. Later tasks (server routes, SaveData, defs) all import from here.

- [ ] **Step 1: Write the failing test**

```ts
// shared/__tests__/cosmeticCatalog.test.ts
import { describe, it, expect } from 'vitest';
import {
  COSMETIC_CATALOG, COSMETIC_SLOTS, getCatalogEntry, validateLoadout,
} from '../cosmeticCatalog';

describe('COSMETIC_CATALOG integrity', () => {
  it('has 52 entries with unique ids', () => {
    expect(COSMETIC_CATALOG.length).toBe(52);
    const ids = COSMETIC_CATALOG.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a valid slot', () => {
    for (const e of COSMETIC_CATALOG) {
      expect(COSMETIC_SLOTS).toContain(e.slot);
    }
  });

  it('per-slot counts match the design', () => {
    const count = (slot: string) => COSMETIC_CATALOG.filter(e => e.slot === slot).length;
    expect(count('tie')).toBe(12);
    expect(count('skin')).toBe(8);
    expect(count('hat')).toBe(14);
    expect(count('face')).toBe(10);
    expect(count('trail')).toBe(8);
  });

  it('getCatalogEntry finds known ids and misses unknown ones', () => {
    expect(getCatalogEntry('hat_cone')?.slot).toBe('hat');
    expect(getCatalogEntry('nope')).toBeUndefined();
  });
});

describe('validateLoadout', () => {
  it('accepts a valid loadout and returns a normalized copy', () => {
    expect(validateLoadout({ hat: 'hat_cone', tie: 'tie_gold' }))
      .toEqual({ hat: 'hat_cone', tie: 'tie_gold' });
  });

  it('accepts the empty loadout', () => {
    expect(validateLoadout({})).toEqual({});
  });

  it('rejects non-objects', () => {
    expect(validateLoadout(null)).toBeNull();
    expect(validateLoadout('hat_cone')).toBeNull();
    expect(validateLoadout(['hat_cone'])).toBeNull();
    expect(validateLoadout(undefined)).toBeNull();
  });

  it('rejects unknown slot keys', () => {
    expect(validateLoadout({ pants: 'hat_cone' })).toBeNull();
  });

  it('rejects unknown item ids', () => {
    expect(validateLoadout({ hat: 'hat_fedora' })).toBeNull();
  });

  it('rejects an id equipped in the wrong slot', () => {
    expect(validateLoadout({ face: 'hat_cone' })).toBeNull();
  });

  it('rejects non-string values', () => {
    expect(validateLoadout({ hat: 42 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/__tests__/cosmeticCatalog.test.ts`
Expected: FAIL — cannot resolve `../cosmeticCatalog`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/cosmeticCatalog.ts
//
// Cosmetic item ids + slots — the single source of truth shared by the game
// client and the Worker (which validates synced loadouts against it). Names,
// prices, and render specs are client-only and live in src/data/cosmeticDefs.ts.

export const COSMETIC_SLOTS = ['hat', 'face', 'tie', 'skin', 'trail'] as const;
export type CosmeticSlot = typeof COSMETIC_SLOTS[number];

export interface CatalogEntry {
  id:   string;
  slot: CosmeticSlot;
}

/** Equipped loadout: at most one item id per slot; missing slot = default/none. */
export type EquippedLoadout = Partial<Record<CosmeticSlot, string>>;

/** Hard cap on the serialized loadout blob the server will store. */
export const MAX_LOADOUT_JSON_LEN = 512;

export const COSMETIC_CATALOG: readonly CatalogEntry[] = [
  // ── Tie (12) ──
  { id: 'tie_red',     slot: 'tie' },
  { id: 'tie_blue',    slot: 'tie' },
  { id: 'tie_green',   slot: 'tie' },
  { id: 'tie_yellow',  slot: 'tie' },
  { id: 'tie_pink',    slot: 'tie' },
  { id: 'tie_purple',  slot: 'tie' },
  { id: 'tie_orange',  slot: 'tie' },
  { id: 'tie_cyan',    slot: 'tie' },
  { id: 'tie_black',   slot: 'tie' },
  { id: 'tie_neon',    slot: 'tie' },
  { id: 'tie_gold',    slot: 'tie' },
  { id: 'tie_rainbow', slot: 'tie' },
  // ── Skin (8) ──
  { id: 'skin_default',   slot: 'skin' },
  { id: 'skin_frost',     slot: 'skin' },
  { id: 'skin_toxic',     slot: 'skin' },
  { id: 'skin_shadow',    slot: 'skin' },
  { id: 'skin_golden',    slot: 'skin' },
  { id: 'skin_ember',     slot: 'skin' },
  { id: 'skin_bubblegum', slot: 'skin' },
  { id: 'skin_ghostly',   slot: 'skin' },
  // ── Hat (14) ──
  { id: 'hat_cone',      slot: 'hat' },
  { id: 'hat_bottlecap', slot: 'hat' },
  { id: 'hat_tincan',    slot: 'hat' },
  { id: 'hat_banana',    slot: 'hat' },
  { id: 'hat_party',     slot: 'hat' },
  { id: 'hat_crown',     slot: 'hat' },
  { id: 'hat_tophat',    slot: 'hat' },
  { id: 'hat_hardhat',   slot: 'hat' },
  { id: 'hat_propeller', slot: 'hat' },
  { id: 'hat_wizard',    slot: 'hat' },
  { id: 'hat_cowboy',    slot: 'hat' },
  { id: 'hat_boat',      slot: 'hat' },
  { id: 'hat_beanie',    slot: 'hat' },
  { id: 'hat_fishbone',  slot: 'hat' },
  // ── Face (10) ──
  { id: 'face_googly',       slot: 'face' },
  { id: 'face_sunglasses',   slot: 'face' },
  { id: 'face_3dglasses',    slot: 'face' },
  { id: 'face_monocle',      slot: 'face' },
  { id: 'face_eyepatch',     slot: 'face' },
  { id: 'face_mustache',     slot: 'face' },
  { id: 'face_clownnose',    slot: 'face' },
  { id: 'face_heartglasses', slot: 'face' },
  { id: 'face_goggles',      slot: 'face' },
  { id: 'face_scar',         slot: 'face' },
  // ── Trail (8) ──
  { id: 'trail_flies',   slot: 'trail' },
  { id: 'trail_stink',   slot: 'trail' },
  { id: 'trail_bubbles', slot: 'trail' },
  { id: 'trail_sparkle', slot: 'trail' },
  { id: 'trail_smoke',   slot: 'trail' },
  { id: 'trail_coins',   slot: 'trail' },
  { id: 'trail_embers',  slot: 'trail' },
  { id: 'trail_rainbow', slot: 'trail' },
];

const BY_ID = new Map(COSMETIC_CATALOG.map(e => [e.id, e]));

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return BY_ID.get(id);
}

/**
 * Validates an unknown parsed value as an equipped loadout.
 * Returns a normalized loadout (known slots only, each id existing and
 * belonging to that slot) or null if anything is invalid.
 */
export function validateLoadout(input: unknown): EquippedLoadout | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: EquippedLoadout = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(COSMETIC_SLOTS as readonly string[]).includes(key)) return null;
    if (typeof value !== 'string') return null;
    const entry = BY_ID.get(value);
    if (!entry || entry.slot !== key) return null;
    out[key as CosmeticSlot] = value;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/__tests__/cosmeticCatalog.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add shared/cosmeticCatalog.ts shared/__tests__/cosmeticCatalog.test.ts
git commit -m "feat(cosmetics): shared catalog + loadout validation"
```

---

### Task 2: Client cosmetic defs (names, prices, render specs)

**Files:**
- Create: `src/data/cosmeticDefs.ts`
- Test: `src/data/__tests__/cosmeticDefs.test.ts`

**Interfaces:**
- Consumes: `COSMETIC_CATALOG`, `CosmeticSlot`, `getCatalogEntry` from `shared/cosmeticCatalog`.
- Produces: `CosmeticDef { id, slot, name, price, render }`, render spec union (`TieRender { kind:'tie', color, rainbow? }`, `SkinRender { kind:'skin', tint }`, `HatRender { kind:'hat', textureKey, offsetX, offsetY }`, `FaceRender { kind:'face', textureKey, offsetX, offsetY }`, `TrailRender { kind:'trail', textureKey, tint, frequency, speedY, lifespan, scale, alpha }`), `COSMETIC_DEFS: readonly CosmeticDef[]`, `getCosmeticDef(id): CosmeticDef | undefined`, `DEFAULT_TIE_COLOR = 0xff0000`. PNG texture keys follow the convention `cos-<id>` (e.g. `cos-hat_cone`). Offsets are logical px from the bag sprite's center (bag is 40×46, top edge at y = −23).

- [ ] **Step 1: Write the failing test**

```ts
// src/data/__tests__/cosmeticDefs.test.ts
import { describe, it, expect } from 'vitest';
import { COSMETIC_DEFS, getCosmeticDef } from '../cosmeticDefs';
import { COSMETIC_CATALOG, getCatalogEntry } from '../../../shared/cosmeticCatalog';

describe('COSMETIC_DEFS integrity', () => {
  it('covers the shared catalog exactly (same ids, same slots)', () => {
    expect(COSMETIC_DEFS.length).toBe(COSMETIC_CATALOG.length);
    for (const def of COSMETIC_DEFS) {
      const entry = getCatalogEntry(def.id);
      expect(entry, `def ${def.id} missing from shared catalog`).toBeDefined();
      expect(entry!.slot).toBe(def.slot);
    }
  });

  it('render spec kind matches the slot', () => {
    for (const def of COSMETIC_DEFS) {
      expect(def.render.kind).toBe(def.slot);
    }
  });

  it('prices are non-negative integers', () => {
    for (const def of COSMETIC_DEFS) {
      expect(Number.isInteger(def.price)).toBe(true);
      expect(def.price).toBeGreaterThanOrEqual(0);
    }
  });

  it('tie and skin slots each have at least one free item', () => {
    expect(COSMETIC_DEFS.some(d => d.slot === 'tie'  && d.price === 0)).toBe(true);
    expect(COSMETIC_DEFS.some(d => d.slot === 'skin' && d.price === 0)).toBe(true);
  });

  it('PNG items use the cos-<id> texture key convention', () => {
    for (const def of COSMETIC_DEFS) {
      if (def.render.kind === 'hat' || def.render.kind === 'face') {
        expect(def.render.textureKey).toBe(`cos-${def.id}`);
      }
    }
  });

  it('getCosmeticDef resolves ids', () => {
    expect(getCosmeticDef('tie_gold')?.price).toBeGreaterThan(0);
    expect(getCosmeticDef('missing')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/__tests__/cosmeticDefs.test.ts`
Expected: FAIL — cannot resolve `../cosmeticDefs`.

- [ ] **Step 3: Write the implementation**

```ts
// src/data/cosmeticDefs.ts
//
// Client-side cosmetic registry: display name, coin price (0 = free), and a
// per-slot render spec. Ids/slots must mirror shared/cosmeticCatalog.ts (the
// integrity test enforces it). Designer-tunable: prices and px offsets here.

import type { CosmeticSlot } from '../../shared/cosmeticCatalog';

export interface TieRender   { kind: 'tie';   color: number; rainbow?: boolean }
export interface SkinRender  { kind: 'skin';  tint: number }
export interface HatRender   { kind: 'hat';   textureKey: string; offsetX: number; offsetY: number }
export interface FaceRender  { kind: 'face';  textureKey: string; offsetX: number; offsetY: number }
export interface TrailRender {
  kind: 'trail';
  textureKey: string;          // procedural particle texture (see TextureGenerators)
  tint:       number;
  frequency:  number;          // ms between emissions
  speedY:     [number, number];
  lifespan:   number;          // ms
  scale:      [number, number]; // start → end
  alpha:      number;
}
export type CosmeticRender = TieRender | SkinRender | HatRender | FaceRender | TrailRender;

export interface CosmeticDef {
  id:     string;
  slot:   CosmeticSlot;
  name:   string;
  price:  number;   // coins; 0 = free (implicitly owned)
  render: CosmeticRender;
}

export const DEFAULT_TIE_COLOR = 0xff0000;

const hat  = (id: string, name: string, price: number, offsetX: number, offsetY: number): CosmeticDef =>
  ({ id, slot: 'hat', name, price, render: { kind: 'hat', textureKey: `cos-${id}`, offsetX, offsetY } });
const face = (id: string, name: string, price: number, offsetX: number, offsetY: number): CosmeticDef =>
  ({ id, slot: 'face', name, price, render: { kind: 'face', textureKey: `cos-${id}`, offsetX, offsetY } });
const tie  = (id: string, name: string, price: number, color: number, rainbow = false): CosmeticDef =>
  ({ id, slot: 'tie', name, price, render: { kind: 'tie', color, rainbow } });
const skin = (id: string, name: string, price: number, tint: number): CosmeticDef =>
  ({ id, slot: 'skin', name, price, render: { kind: 'skin', tint } });

export const COSMETIC_DEFS: readonly CosmeticDef[] = [
  // ── Tie colors (strings drawn by PlayerAnimator) ──
  tie('tie_red',     'Red',     0,    0xff0000),
  tie('tie_blue',    'Blue',    0,    0x3377ff),
  tie('tie_green',   'Green',   0,    0x33cc55),
  tie('tie_yellow',  'Yellow',  0,    0xffdd33),
  tie('tie_pink',    'Pink',    250,  0xff66aa),
  tie('tie_purple',  'Purple',  250,  0xaa55ff),
  tie('tie_orange',  'Orange',  250,  0xff8822),
  tie('tie_cyan',    'Cyan',    250,  0x33ddee),
  tie('tie_black',   'Black',   250,  0x222222),
  tie('tie_neon',    'Neon',    250,  0x39ff14),
  tie('tie_gold',    'Gold',    500,  0xd9a520),
  tie('tie_rainbow', 'Rainbow', 2000, 0xff0000, true),
  // ── Bag skins (multiplicative sprite tint; hues that read on the dark bag) ──
  skin('skin_default',   'Classic',   0,   0xffffff),
  skin('skin_frost',     'Frosty',    500, 0x99bbff),
  skin('skin_toxic',     'Toxic',     500, 0x88dd66),
  skin('skin_shadow',    'Shadow',    500, 0x555566),
  skin('skin_golden',    'Golden',    500, 0xddbb55),
  skin('skin_ember',     'Ember',     500, 0xff8866),
  skin('skin_bubblegum', 'Bubblegum', 500, 0xff99cc),
  skin('skin_ghostly',   'Ghostly',   500, 0xaaffdd),
  // ── Hats (PNG; offsets from bag center, bag top edge at y=-23) ──
  hat('hat_cone',      'Traffic Cone',  800,  0, -26),
  hat('hat_bottlecap', 'Bottle Cap',    500,  0, -24),
  hat('hat_tincan',    'Tin Can',       500,  0, -25),
  hat('hat_banana',    'Banana Peel',   600,  0, -24),
  hat('hat_party',     'Party Hat',     750,  2, -27),
  hat('hat_crown',     'Crown',         2500, 0, -25),
  hat('hat_tophat',    'Top Hat',       1200, 0, -27),
  hat('hat_hardhat',   'Hard Hat',      800,  0, -25),
  hat('hat_propeller', 'Propeller Cap', 1000, 0, -26),
  hat('hat_wizard',    'Wizard Hat',    1500, 0, -28),
  hat('hat_cowboy',    'Cowboy Hat',    1000, 0, -25),
  hat('hat_boat',      'Paper Boat',    600,  0, -25),
  hat('hat_beanie',    'Beanie',        500,  0, -24),
  hat('hat_fishbone',  'Fish Skeleton', 900,  0, -25),
  // ── Face (PNG; upper third of the bag) ──
  face('face_googly',       'Googly Eyes',   500, 0, -8),
  face('face_sunglasses',   'Sunglasses',    600, 0, -8),
  face('face_3dglasses',    '3D Glasses',    600, 0, -8),
  face('face_monocle',      'Monocle',       800, 5, -8),
  face('face_eyepatch',     'Eye Patch',     600, -4, -9),
  face('face_mustache',     'Mustache',      700, 0, -2),
  face('face_clownnose',    'Clown Nose',    500, 0, -5),
  face('face_heartglasses', 'Heart Glasses', 800, 0, -8),
  face('face_goggles',      'Ski Goggles',   700, 0, -8),
  face('face_scar',         'Sticker Scar',  500, 6, -10),
  // ── Trails (particle emitters; textures generated in TextureGenerators) ──
  { id: 'trail_flies',   slot: 'trail', name: 'Buzzing Flies',  price: 750,
    render: { kind: 'trail', textureKey: 'cos-fly',    tint: 0x333322, frequency: 90,  speedY: [-30, 30],  lifespan: 700,  scale: [1, 0.6],   alpha: 0.9 } },
  { id: 'trail_stink',   slot: 'trail', name: 'Stink Lines',    price: 750,
    render: { kind: 'trail', textureKey: 'cos-puff',   tint: 0x77cc44, frequency: 140, speedY: [-60, -20], lifespan: 900,  scale: [0.7, 1.3], alpha: 0.5 } },
  { id: 'trail_bubbles', slot: 'trail', name: 'Bubbles',        price: 900,
    render: { kind: 'trail', textureKey: 'cos-bubble', tint: 0xbbddff, frequency: 120, speedY: [-50, -15], lifespan: 1100, scale: [0.6, 1],   alpha: 0.8 } },
  { id: 'trail_sparkle', slot: 'trail', name: 'Sparkles',       price: 1200,
    render: { kind: 'trail', textureKey: 'cos-star',   tint: 0xffffaa, frequency: 80,  speedY: [-20, 20],  lifespan: 600,  scale: [1, 0.2],   alpha: 1 } },
  { id: 'trail_smoke',   slot: 'trail', name: 'Smoke Puffs',    price: 900,
    render: { kind: 'trail', textureKey: 'cos-puff',   tint: 0x888888, frequency: 130, speedY: [-40, -10], lifespan: 1000, scale: [0.8, 1.6], alpha: 0.45 } },
  { id: 'trail_coins',   slot: 'trail', name: 'Coin Glints',    price: 1500,
    render: { kind: 'trail', textureKey: 'cos-coin',   tint: 0xffcc33, frequency: 150, speedY: [10, 60],   lifespan: 800,  scale: [1, 0.4],   alpha: 1 } },
  { id: 'trail_embers',  slot: 'trail', name: 'Embers',         price: 1200,
    render: { kind: 'trail', textureKey: 'cos-dot',    tint: 0xff6622, frequency: 70,  speedY: [-70, -20], lifespan: 750,  scale: [1, 0.3],   alpha: 0.9 } },
  { id: 'trail_rainbow', slot: 'trail', name: 'Rainbow Streak', price: 1500,
    render: { kind: 'trail', textureKey: 'cos-dot',    tint: 0xffffff, frequency: 40,  speedY: [-10, 10],  lifespan: 500,  scale: [1.4, 0.2], alpha: 0.9 } },
];

const DEF_BY_ID = new Map(COSMETIC_DEFS.map(d => [d.id, d]));

export function getCosmeticDef(id: string): CosmeticDef | undefined {
  return DEF_BY_ID.get(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/__tests__/cosmeticDefs.test.ts shared/__tests__/cosmeticCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/cosmeticDefs.ts src/data/__tests__/cosmeticDefs.test.ts
git commit -m "feat(cosmetics): client item defs with prices and render specs"
```

---

### Task 3: SaveData schema v5 — ownership, equipped loadout, cloud merge

**Files:**
- Modify: `src/systems/SaveData.ts`
- Test: `src/systems/__tests__/SaveDataCosmetics.test.ts` (new file; follow the localStorage/reset patterns in `src/systems/__tests__/SaveData.test.ts`)

**Interfaces:**
- Consumes: `getCosmeticDef` from `src/data/cosmeticDefs`; `EquippedLoadout`, `CosmeticSlot` from `shared/cosmeticCatalog`.
- Produces (all exported from SaveData): `isCosmeticOwned(id): boolean` (true for price-0 items), `purchaseCosmetic(id): boolean`, `getOwnedCosmetics(): string[]`, `getEquippedCosmetics(): EquippedLoadout`, `equipCosmetic(slot, id | null): boolean` (null clears the slot; rejects unowned/wrong-slot ids), `getLoadoutSyncPending(): boolean`, `setLoadoutSyncPending(v): void`. `RawSave` gains `cosmeticsOwned: string[]`, `cosmeticsEquipped: EquippedLoadout`, `loadoutSyncPending?: boolean`.

**CRITICAL migration hazard:** `migrate()` currently routes any version that isn't `CURRENT_SCHEMA` or `1` into the v2→v3 branch that remaps placed-item Y values. When `CURRENT_SCHEMA` becomes 5, a v4 save MUST NOT take that remap path. Add an explicit v4 branch.

- [ ] **Step 1: Write the failing test**

```ts
// src/systems/__tests__/SaveDataCosmetics.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetCacheForTests, resetAllData, addBalance, getBalance,
  isCosmeticOwned, purchaseCosmetic, getOwnedCosmetics,
  getEquippedCosmetics, equipCosmetic,
  getLoadoutSyncPending, setLoadoutSyncPending,
  mergeCloudSave, getRawSaveForCloudSync, getSchemaVersionForTests,
} from '../SaveData';

beforeEach(() => {
  resetAllData();
  resetCacheForTests();
});

describe('cosmetics ownership', () => {
  it('free items are implicitly owned', () => {
    expect(isCosmeticOwned('tie_red')).toBe(true);
    expect(isCosmeticOwned('skin_default')).toBe(true);
  });

  it('paid items are not owned until purchased', () => {
    expect(isCosmeticOwned('tie_gold')).toBe(false);
  });

  it('purchase deducts price and adds to owned', () => {
    addBalance(1000);
    expect(purchaseCosmetic('tie_gold')).toBe(true);   // costs 500
    expect(getBalance()).toBe(500);
    expect(isCosmeticOwned('tie_gold')).toBe(true);
    expect(getOwnedCosmetics()).toContain('tie_gold');
  });

  it('purchase fails on insufficient funds and unknown ids', () => {
    addBalance(100);
    expect(purchaseCosmetic('tie_gold')).toBe(false);
    expect(getBalance()).toBe(100);
    expect(purchaseCosmetic('nonsense')).toBe(false);
  });

  it('re-purchasing an owned item fails without charging', () => {
    addBalance(1000);
    purchaseCosmetic('tie_gold');
    expect(purchaseCosmetic('tie_gold')).toBe(false);
    expect(getBalance()).toBe(500);
  });
});

describe('equipped loadout', () => {
  it('starts empty', () => {
    expect(getEquippedCosmetics()).toEqual({});
  });

  it('equips owned items and clears with null', () => {
    expect(equipCosmetic('tie', 'tie_blue')).toBe(true);   // free
    expect(getEquippedCosmetics()).toEqual({ tie: 'tie_blue' });
    expect(equipCosmetic('tie', null)).toBe(true);
    expect(getEquippedCosmetics()).toEqual({});
  });

  it('rejects unowned items and slot mismatches', () => {
    expect(equipCosmetic('tie', 'tie_gold')).toBe(false);   // not owned
    expect(equipCosmetic('hat', 'tie_red')).toBe(false);    // wrong slot
    expect(getEquippedCosmetics()).toEqual({});
  });

  it('persists the loadout sync pending flag', () => {
    expect(getLoadoutSyncPending()).toBe(false);
    setLoadoutSyncPending(true);
    expect(getLoadoutSyncPending()).toBe(true);
  });
});

describe('v4 → v5 migration', () => {
  it('adds cosmetic fields without remapping placed Y values', () => {
    localStorage.setItem('heap_save', JSON.stringify({
      schemaVersion: 4, balance: 42, upgrades: {}, inventory: {},
      placed: { h1: [{ id: 'a', x: 10, y: 999 }] },
      selectedHeapId: 'h1', playerGuid: 'g', playerName: 'N', highScores: {},
    }));
    resetCacheForTests();
    expect(getSchemaVersionForTests()).toBe(5);
    const raw = getRawSaveForCloudSync();
    expect(raw.placed['h1'][0].y).toBe(999);        // NOT remapped
    expect(raw.cosmeticsOwned).toEqual([]);
    expect(raw.cosmeticsEquipped).toEqual({});
  });
});

describe('cloud merge', () => {
  it('unions owned cosmetics and takes primary equipped', () => {
    const local = { ...getRawSaveForCloudSync(), balance: 100,
      cosmeticsOwned: ['tie_gold'], cosmeticsEquipped: { tie: 'tie_gold' } };
    const cloud = { ...getRawSaveForCloudSync(), balance: 50,
      cosmeticsOwned: ['hat_cone'], cosmeticsEquipped: { hat: 'hat_cone' } };
    const merged = mergeCloudSave(local as any, cloud as any);
    expect(merged.cosmeticsOwned.sort()).toEqual(['hat_cone', 'tie_gold']);
    expect(merged.cosmeticsEquipped).toEqual({ tie: 'tie_gold' }); // local is primary (higher balance)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/SaveDataCosmetics.test.ts`
Expected: FAIL — `isCosmeticOwned` etc. not exported.

- [ ] **Step 3: Implement in `src/systems/SaveData.ts`**

3a. Bump schema and extend `RawSave`:

```ts
const CURRENT_SCHEMA = 5;
```

Add to the `RawSave` interface (after `highScores`):

```ts
  cosmeticsOwned:      string[];
  cosmeticsEquipped:   EquippedLoadout;
  loadoutSyncPending?: boolean;
```

Add imports at the top:

```ts
import { getCosmeticDef, COSMETIC_DEFS } from '../data/cosmeticDefs';
import type { EquippedLoadout, CosmeticSlot } from '../../shared/cosmeticCatalog';
```

(`COSMETIC_DEFS` import may be dropped if unused after implementation — keep only what's needed.)

3b. `freshSave()`: add `cosmeticsOwned: [], cosmeticsEquipped: {},` after `highScores: {}`.

3c. `migrate()`: in the `version === CURRENT_SCHEMA` branch add
`cosmeticsOwned: parsed.cosmeticsOwned ?? [], cosmeticsEquipped: parsed.cosmeticsEquipped ?? {}, loadoutSyncPending: parsed.loadoutSyncPending,`.
Then add an explicit **v4 branch** BEFORE the v2/v3 fallthrough (after the `version === 1` block):

```ts
  // v4 → v5: identical layout, just add the cosmetics fields. Must NOT fall
  // through to the v2→v3 branch below, which remaps placed-item Y values.
  if (version === 4) {
    return {
      schemaVersion:  CURRENT_SCHEMA,
      balance:        parsed.balance        ?? 0,
      upgrades:       parsed.upgrades       ?? {},
      inventory:      parsed.inventory      ?? {},
      placed:         parsed.placed         ?? {},
      selectedHeapId: parsed.selectedHeapId ?? '',
      playerGuid:     parsed.playerGuid     ?? generateGuid(),
      playerName:     parsed.playerName     ?? generateDefaultName(),
      gpgsPlayerId:   parsed.gpgsPlayerId,
      highScores:     parsed.highScores     ?? {},
      cosmeticsOwned:    [],
      cosmeticsEquipped: {},
      tutorialDone:   parsed.tutorialDone   ?? true,
      verboseLogging: parsed.verboseLogging,
      _legacyPlaced:  parsed._legacyPlaced,
      soundSettings:  parsed.soundSettings  ?? { ...DEFAULT_SOUND_SETTINGS },
      adRunsSinceLast: parsed.adRunsSinceLast,
      adRunTarget:     parsed.adRunTarget,
      controlMode:    parsed.controlMode,
      joystickSide:   parsed.joystickSide,
    };
  }
```

Also add `cosmeticsOwned: [], cosmeticsEquipped: {},` to the v1 branch and the v2/v3 fallthrough return.

3d. New accessors section (place after the "High scores" section):

```ts
// ── Cosmetics ─────────────────────────────────────────────────────────────────

export function getOwnedCosmetics(): string[] { return [...load().cosmeticsOwned]; }

export function isCosmeticOwned(id: string): boolean {
  const def = getCosmeticDef(id);
  if (!def) return false;
  if (def.price === 0) return true;
  return load().cosmeticsOwned.includes(id);
}

export function purchaseCosmetic(id: string): boolean {
  const def = getCosmeticDef(id);
  if (!def || def.price === 0) return false;
  if (isCosmeticOwned(id)) return false;
  const data = load();
  if (data.balance < def.price) return false;
  data.balance -= def.price;
  data.cosmeticsOwned.push(id);
  persist(data);
  return true;
}

export function getEquippedCosmetics(): EquippedLoadout {
  return { ...load().cosmeticsEquipped };
}

/** Equip an owned item into its slot, or clear the slot with null. */
export function equipCosmetic(slot: CosmeticSlot, id: string | null): boolean {
  const data = load();
  if (id === null) {
    delete data.cosmeticsEquipped[slot];
    persist(data);
    return true;
  }
  const def = getCosmeticDef(id);
  if (!def || def.slot !== slot || !isCosmeticOwned(id)) return false;
  data.cosmeticsEquipped[slot] = id;
  persist(data);
  return true;
}

export function getLoadoutSyncPending(): boolean { return load().loadoutSyncPending ?? false; }
export function setLoadoutSyncPending(v: boolean): void {
  const data = load();
  data.loadoutSyncPending = v;
  persist(data);
}
```

3e. `mergeCloudSave()`: after the highScores union add

```ts
  // Union owned cosmetics; equipped follows the primary save.
  const cosmeticsOwned = [...new Set([
    ...(local.cosmeticsOwned ?? []), ...(cloud.cosmeticsOwned ?? []),
  ])];
```

and add to its return object:

```ts
    cosmeticsOwned,
    cosmeticsEquipped:  { ...(primary.cosmeticsEquipped ?? {}) },
    loadoutSyncPending: local.loadoutSyncPending,
```

- [ ] **Step 4: Run tests — new file AND the existing SaveData suite (migration regressions)**

Run: `npx vitest run src/systems/__tests__/SaveDataCosmetics.test.ts src/systems/__tests__/SaveData.test.ts`
Expected: PASS. If existing SaveData tests assert `schemaVersion === 4` or construct v4 fixtures expecting no migration, update those expectations to 5 — the schema bump is intentional.

- [ ] **Step 5: Commit**

```bash
git add src/systems/SaveData.ts src/systems/__tests__/SaveDataCosmetics.test.ts src/systems/__tests__/SaveData.test.ts
git commit -m "feat(cosmetics): SaveData v5 - ownership, equipped loadout, cloud merge"
```

---

### Task 4: D1 migration — player_customization table

**Files:**
- Create: `server/migrations/heap_scores/0002_player_customization.sql`
- Modify: `server/schema/heap_scores.sql`

**Interfaces:**
- Produces: table `player_customization(player_id TEXT PK, loadout TEXT, updated_at TEXT)` in the `heap_scores` DB (binding `DB_SCORES`). Consumed by Tasks 5–6.

- [ ] **Step 1: Write the migration**

```sql
-- server/migrations/heap_scores/0002_player_customization.sql
-- Equipped cosmetic loadout per player (display data only; ownership lives
-- client-side). loadout is a validated JSON object: {"hat":"hat_cone",...}.
CREATE TABLE IF NOT EXISTS player_customization (
  player_id  TEXT NOT NULL PRIMARY KEY,
  loadout    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 2: Update the reference schema**

Append to `server/schema/heap_scores.sql` (final-state file):

```sql
CREATE TABLE IF NOT EXISTS player_customization (
  player_id  TEXT NOT NULL PRIMARY KEY,
  loadout    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 3: Apply locally and verify**

Run: `cd server && npx wrangler d1 migrations apply heap_scores --local`
Expected: `0002_player_customization.sql` listed as applied.
Verify: `cd server && npx wrangler d1 execute heap_scores --local --command "SELECT name FROM sqlite_master WHERE name='player_customization'"`
Expected: one row, `player_customization`.
(Remote apply happens via `.github/workflows/migrate-d1.yml` at merge — do NOT run `--remote`.)

- [ ] **Step 4: Commit**

```bash
git add server/migrations/heap_scores/0002_player_customization.sql server/schema/heap_scores.sql
git commit -m "feat(cosmetics): heap_scores migration 0002 - player_customization table"
```

---

### Task 5: Server — CustomizationDB + PUT/GET routes + wiring

**Files:**
- Create: `server/src/customizationDb.ts`
- Create: `server/src/routes/customization.ts`
- Create: `server/tests/helpers/mockCustomizationDb.ts`
- Modify: `server/src/app.ts` (AppOptions + mount)
- Modify: `server/src/index.ts` (D1 wiring)
- Test: `server/tests/customization.test.ts`

**Interfaces:**
- Consumes: `validateLoadout`, `MAX_LOADOUT_JSON_LEN` from `shared/cosmeticCatalog`; Hono/app patterns from `server/src/app.ts`.
- Produces: `CustomizationDB { getLoadout(playerId): Promise<string | null>; upsertLoadout(playerId, loadoutJson, now): Promise<void> }`, `D1CustomizationDB`, `MockCustomizationDB` (adds test-only `seed(playerId, json)`), routes `PUT /customization/:playerId` (body `{ loadout: {...} }` → `{ ok: true }` or 400 `{ error: 'invalid loadout' }`) and `GET /customization/:playerId` (→ `{ loadout: {...} | null }`), `AppOptions.customizationDb?: CustomizationDB`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/customization.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockCustomizationDB } from './helpers/mockCustomizationDb';

const PLAYER = 'player-aaa';

function makeApp(customizationDb = new MockCustomizationDB()) {
  const heapDb = new MockHeapDB();
  return { app: createApp(heapDb, new MockScoreDB(), { customizationDb }), customizationDb };
}

async function put(app: ReturnType<typeof makeApp>['app'], playerId: string, body: unknown) {
  return app.request(`/customization/${playerId}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('PUT /customization/:playerId', () => {
  it('upserts a valid loadout and GET returns it', async () => {
    const { app } = makeApp();
    const res = await put(app, PLAYER, { loadout: { hat: 'hat_cone', tie: 'tie_gold' } });
    expect(res.status).toBe(200);

    const get = await app.request(`/customization/${PLAYER}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ loadout: { hat: 'hat_cone', tie: 'tie_gold' } });
  });

  it('overwrites an existing loadout', async () => {
    const { app } = makeApp();
    await put(app, PLAYER, { loadout: { hat: 'hat_cone' } });
    await put(app, PLAYER, { loadout: { face: 'face_googly' } });
    const get = await app.request(`/customization/${PLAYER}`);
    expect(await get.json()).toEqual({ loadout: { face: 'face_googly' } });
  });

  it('accepts an empty loadout (clears cosmetics)', async () => {
    const { app } = makeApp();
    const res = await put(app, PLAYER, { loadout: {} });
    expect(res.status).toBe(200);
  });

  it('rejects malformed JSON with 400', async () => {
    const { app } = makeApp();
    const res = await put(app, PLAYER, '{not json');
    expect(res.status).toBe(400);
  });

  it('rejects a missing loadout field with 400', async () => {
    const { app } = makeApp();
    expect((await put(app, PLAYER, {})).status).toBe(400);
  });

  it('rejects unknown slots, unknown ids, and wrong-slot ids with 400', async () => {
    const { app } = makeApp();
    expect((await put(app, PLAYER, { loadout: { pants: 'hat_cone' } })).status).toBe(400);
    expect((await put(app, PLAYER, { loadout: { hat: 'hat_fedora' } })).status).toBe(400);
    expect((await put(app, PLAYER, { loadout: { face: 'hat_cone' } })).status).toBe(400);
    expect((await put(app, PLAYER, { loadout: ['hat_cone'] })).status).toBe(400);
  });

  it('rejects an oversized playerId with 400', async () => {
    const { app } = makeApp();
    expect((await put(app, 'x'.repeat(65), { loadout: {} })).status).toBe(400);
  });

  it('stores re-serialized JSON, never raw input', async () => {
    const { app, customizationDb } = makeApp();
    await put(app, PLAYER, { loadout: { hat: 'hat_cone' } });
    const raw = await customizationDb.getLoadout(PLAYER);
    expect(raw).toBe(JSON.stringify({ hat: 'hat_cone' }));
  });
});

describe('GET /customization/:playerId', () => {
  it('returns null loadout for an unknown player', async () => {
    const { app } = makeApp();
    const res = await app.request(`/customization/${PLAYER}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ loadout: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/customization.test.ts`
Expected: FAIL — cannot resolve `./helpers/mockCustomizationDb` / routes not mounted.

- [ ] **Step 3: Implement**

3a. `server/src/customizationDb.ts`:

```ts
// server/src/customizationDb.ts

/** Abstraction over D1 for the player_customization table. */
export interface CustomizationDB {
  /** Returns the stored loadout JSON string, or null if none. */
  getLoadout(playerId: string): Promise<string | null>;
  /** Insert or replace the loadout for a player. */
  upsertLoadout(playerId: string, loadoutJson: string, now: string): Promise<void>;
}

export class D1CustomizationDB implements CustomizationDB {
  constructor(private d1: D1Database) {}

  async getLoadout(playerId: string): Promise<string | null> {
    const row = await this.d1
      .prepare('SELECT loadout FROM player_customization WHERE player_id=?1')
      .bind(playerId)
      .first<{ loadout: string }>();
    return row?.loadout ?? null;
  }

  async upsertLoadout(playerId: string, loadoutJson: string, now: string): Promise<void> {
    await this.d1
      .prepare(`
        INSERT INTO player_customization (player_id, loadout, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(player_id) DO UPDATE SET loadout=excluded.loadout, updated_at=excluded.updated_at
      `)
      .bind(playerId, loadoutJson, now)
      .run();
  }
}
```

3b. `server/tests/helpers/mockCustomizationDb.ts`:

```ts
// server/tests/helpers/mockCustomizationDb.ts
import type { CustomizationDB } from '../../src/customizationDb';

/** In-memory CustomizationDB for tests. */
export class MockCustomizationDB implements CustomizationDB {
  private rows = new Map<string, string>();

  async getLoadout(playerId: string): Promise<string | null> {
    return this.rows.get(playerId) ?? null;
  }

  async upsertLoadout(playerId: string, loadoutJson: string, _now: string): Promise<void> {
    this.rows.set(playerId, loadoutJson);
  }

  /** Test helper — seed a raw loadout JSON string directly. */
  seed(playerId: string, loadoutJson: string): void {
    this.rows.set(playerId, loadoutJson);
  }
}
```

3c. `server/src/routes/customization.ts`:

```ts
// server/src/routes/customization.ts

import { Hono } from 'hono';
import type { CustomizationDB } from '../customizationDb';
import { validateLoadout, MAX_LOADOUT_JSON_LEN } from '../../../shared/cosmeticCatalog';

const MAX_ID_LEN = 64;

export function customizationRoutes(db: CustomizationDB): Hono {
  const app = new Hono();

  // PUT /customization/:playerId — upsert the equipped loadout (display data only).
  app.put('/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    if (playerId.length === 0 || playerId.length > MAX_ID_LEN) {
      return c.json({ error: 'invalid loadout' }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid loadout' }, 400);
    }
    const loadout = validateLoadout((body as { loadout?: unknown } | null)?.loadout);
    if (loadout === null) return c.json({ error: 'invalid loadout' }, 400);

    // Store our own serialization of the validated object — never raw input.
    const json = JSON.stringify(loadout);
    if (json.length > MAX_LOADOUT_JSON_LEN) return c.json({ error: 'invalid loadout' }, 400);

    await db.upsertLoadout(playerId, json, new Date().toISOString());
    return c.json({ ok: true });
  });

  // GET /customization/:playerId — debug/admin read.
  app.get('/:playerId', async (c) => {
    const raw = await db.getLoadout(c.req.param('playerId'));
    return c.json({ loadout: raw ? JSON.parse(raw) : null });
  });

  return app;
}
```

3d. `server/src/app.ts` — add to imports:

```ts
import { customizationRoutes } from './routes/customization';
import type { CustomizationDB } from './customizationDb';
```

Add to `AppOptions`:

```ts
  /** Player-customization D1 access. If unset, /customization is not mounted. */
  customizationDb?: CustomizationDB;
```

Mount after the `configDb` block (equip writes share the scores rate-limit bucket — they're debounced client-side):

```ts
  if (opts.customizationDb) {
    app.put('/customization/:playerId', rateLimit(lim.scores, 'customization-put'));
    app.route('/customization', customizationRoutes(opts.customizationDb));
  }
```

3e. `server/src/index.ts` — add import `import { D1CustomizationDB } from './customizationDb';` and pass to `createApp` options:

```ts
      customizationDb: new D1CustomizationDB(env.DB_SCORES),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/tests/customization.test.ts && npx vitest run server/tests`
Expected: new suite PASS; full server suite still green.

- [ ] **Step 5: Commit**

```bash
git add server/src/customizationDb.ts server/src/routes/customization.ts server/tests/helpers/mockCustomizationDb.ts server/src/app.ts server/src/index.ts server/tests/customization.test.ts
git commit -m "feat(cosmetics): /customization PUT+GET routes with catalog validation"
```

---

### Task 6: Server — leaderboard loadout enrichment (LEFT JOIN)

**Files:**
- Modify: `server/src/scoreDb.ts` (`ScoreRow` + JOIN in `getTopScores` / `getScoresPaginated`)
- Modify: `server/tests/helpers/mockScoreDb.ts` (loadout support)
- Modify: `server/src/routes/scores.ts` (parse + attach loadout in `buildContext` and the paginated route)
- Modify: `shared/scoreTypes.ts` (`LeaderboardEntry.loadout`)
- Test: extend `server/tests/scores.test.ts`

**Interfaces:**
- Consumes: `player_customization` table (Task 4), `validateLoadout`/`EquippedLoadout` (Task 1), existing `ScoreDB` interface.
- Produces: `ScoreRow.loadout?: string | null`; `LeaderboardEntry.loadout?: EquippedLoadout | null` (present on `top` and paginated entries; parsed + re-validated server-side, `null` when absent/invalid); `MockScoreDB.seedLoadout(playerId, loadoutJson)`. `CachedScoreDB` needs NO change — the cached top-N blob simply carries the extra field (loadout changes surface within the 30 s TTL; accepted staleness).

- [ ] **Step 1: Write the failing tests** (append to `server/tests/scores.test.ts`)

```ts
describe('leaderboard loadout enrichment', () => {
  it('attaches parsed loadouts to top entries', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, 'p1', 'Alpha', 1800);
    db.seed(HEAP_ID, 'p2', 'Beta',  1500);
    db.seedLoadout('p1', JSON.stringify({ hat: 'hat_cone' }));

    const app = makeApp(db);
    const res = await app.request(`/scores/${HEAP_ID}/context?playerId=p2&limit=5`);
    const ctx = await res.json() as { top: Array<{ playerId: string; loadout: unknown }> };

    expect(ctx.top[0].loadout).toEqual({ hat: 'hat_cone' });
    expect(ctx.top[1].loadout).toBeNull();
  });

  it('returns null loadout for invalid stored JSON', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, 'p1', 'Alpha', 1800);
    db.seedLoadout('p1', '{broken');
    const app = makeApp(db);
    const res = await app.request(`/scores/${HEAP_ID}/context?playerId=p1&limit=5`);
    const ctx = await res.json() as { top: Array<{ loadout: unknown }> };
    expect(ctx.top[0].loadout).toBeNull();
  });

  it('re-validates stored loadouts against the catalog', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, 'p1', 'Alpha', 1800);
    db.seedLoadout('p1', JSON.stringify({ hat: 'hat_definitely_removed' }));
    const app = makeApp(db);
    const res = await app.request(`/scores/${HEAP_ID}/context?playerId=p1&limit=5`);
    const ctx = await res.json() as { top: Array<{ loadout: unknown }> };
    expect(ctx.top[0].loadout).toBeNull();
  });

  it('attaches loadouts to paginated leaderboard entries', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, 'p1', 'Alpha', 1800);
    db.seedLoadout('p1', JSON.stringify({ tie: 'tie_gold' }));
    const app = makeApp(db);
    const res = await app.request(`/scores/${HEAP_ID}?page=0&limit=10`);
    const body = await res.json() as { entries: Array<{ loadout: unknown }> };
    expect(body.entries[0].loadout).toEqual({ tie: 'tie_gold' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/scores.test.ts`
Expected: FAIL — `seedLoadout` does not exist / `loadout` undefined vs expected null.

- [ ] **Step 3: Implement**

3a. `shared/scoreTypes.ts` — add import and field:

```ts
import type { EquippedLoadout } from './cosmeticCatalog';
```

```ts
export interface LeaderboardEntry {
  rank:     number;
  playerId: string;
  name:     string;
  score:    number;
  /** Equipped cosmetic loadout for avatar display; null when none/invalid. */
  loadout?: EquippedLoadout | null;
}
```

3b. `server/src/scoreDb.ts` — add to `ScoreRow`:

```ts
  /** Serialized loadout from LEFT JOIN player_customization; only populated by
   *  getTopScores / getScoresPaginated. */
  loadout?: string | null;
```

Replace the two read queries in `D1ScoreDB`:

```ts
  async getTopScores(heapId: string, limit: number): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare(`
        SELECT s.*, pc.loadout AS loadout
          FROM score s
          LEFT JOIN player_customization pc ON pc.player_id = s.player_id
         WHERE s.heap_id=?1
         ORDER BY s.score DESC
         LIMIT ?2
      `)
      .bind(heapId, limit)
      .all<ScoreRow>();
    return result.results;
  }
```

```ts
  async getScoresPaginated(heapId: string, offset: number, limit: number): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare(`
        SELECT s.*, pc.loadout AS loadout
          FROM score s
          LEFT JOIN player_customization pc ON pc.player_id = s.player_id
         WHERE s.heap_id=?1
         ORDER BY s.score DESC
         LIMIT ?2 OFFSET ?3
      `)
      .bind(heapId, limit, offset)
      .all<ScoreRow>();
    return result.results;
  }
```

3c. `server/tests/helpers/mockScoreDb.ts` — add a loadout map + seeding, and emulate the JOIN:

```ts
  private loadouts = new Map<string, string>();

  /** Test helper — seed a player_customization row (raw JSON string). */
  seedLoadout(playerId: string, loadoutJson: string): void {
    this.loadouts.set(playerId, loadoutJson);
  }

  private withLoadout(r: ScoreRow): ScoreRow {
    return { ...r, loadout: this.loadouts.get(r.player_id) ?? null };
  }
```

Then in `getTopScores` and `getScoresPaginated`, map the returned rows through `this.withLoadout`, e.g.:

```ts
  async getTopScores(heapId: string, limit: number): Promise<ScoreRow[]> {
    return Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => this.withLoadout(r));
  }
```

3d. `server/src/routes/scores.ts` — add import:

```ts
import { validateLoadout } from '../../../shared/cosmeticCatalog';
import type { EquippedLoadout } from '../../../shared/cosmeticCatalog';
```

Add a helper above `buildContext`:

```ts
/** Parse + re-validate a stored loadout blob; null on anything suspect. */
function parseLoadout(raw: string | null | undefined): EquippedLoadout | null {
  if (!raw) return null;
  try {
    return validateLoadout(JSON.parse(raw));
  } catch {
    return null;
  }
}
```

In `buildContext`, extend the `top` mapping:

```ts
  const top: LeaderboardEntry[] = topRows.map((row, i) => ({
    rank:     i + 1,
    playerId: row.player_id,
    name:     row.name,
    score:    row.score,
    loadout:  parseLoadout(row.loadout),
  }));
```

In the paginated `GET /:heapId` handler, extend the `entries` mapping the same way (`loadout: parseLoadout(row.loadout),`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/tests`
Expected: all server suites PASS (including `scoreDb.mock.test.ts`, `cacheDecorators.test.ts` — no interface change, only an optional field).

- [ ] **Step 5: Commit**

```bash
git add shared/scoreTypes.ts server/src/scoreDb.ts server/src/routes/scores.ts server/tests/helpers/mockScoreDb.ts server/tests/scores.test.ts
git commit -m "feat(cosmetics): enrich leaderboard reads with player loadouts"
```

---

### Task 7: Pure loadout resolution (`cosmeticsLogic.ts`)

**Files:**
- Create: `src/systems/cosmeticsLogic.ts`
- Test: `src/systems/__tests__/cosmeticsLogic.test.ts`

**Interfaces:**
- Consumes: `getCosmeticDef`, render spec types, `DEFAULT_TIE_COLOR` from `src/data/cosmeticDefs`; `EquippedLoadout` from shared catalog.
- Produces: `ResolvedCosmetics { tieColor: number; tieRainbow: boolean; skinTint: number | null; hat: HatRender | null; face: FaceRender | null; trail: TrailRender | null }`, `resolveCosmetics(equipped: EquippedLoadout): ResolvedCosmetics`, `rainbowColorAt(timeMs: number): number` (3 s hue cycle, pure — no Phaser). Consumed by `PlayerAnimator`, `PlayerCosmetics`, `composeAvatar`, and the editor.

- [ ] **Step 1: Write the failing test**

```ts
// src/systems/__tests__/cosmeticsLogic.test.ts
import { describe, it, expect } from 'vitest';
import { resolveCosmetics, rainbowColorAt } from '../cosmeticsLogic';

describe('resolveCosmetics', () => {
  it('empty loadout resolves to defaults', () => {
    const r = resolveCosmetics({});
    expect(r.tieColor).toBe(0xff0000);
    expect(r.tieRainbow).toBe(false);
    expect(r.skinTint).toBeNull();
    expect(r.hat).toBeNull();
    expect(r.face).toBeNull();
    expect(r.trail).toBeNull();
  });

  it('resolves equipped items to their render specs', () => {
    const r = resolveCosmetics({ tie: 'tie_gold', skin: 'skin_toxic', hat: 'hat_cone', face: 'face_googly', trail: 'trail_flies' });
    expect(r.tieColor).toBe(0xd9a520);
    expect(r.skinTint).toBe(0x88dd66);
    expect(r.hat?.textureKey).toBe('cos-hat_cone');
    expect(r.face?.textureKey).toBe('cos-face_googly');
    expect(r.trail?.textureKey).toBe('cos-fly');
  });

  it('skin_default resolves to no tint', () => {
    expect(resolveCosmetics({ skin: 'skin_default' }).skinTint).toBeNull();
  });

  it('rainbow tie sets the flag', () => {
    expect(resolveCosmetics({ tie: 'tie_rainbow' }).tieRainbow).toBe(true);
  });

  it('ignores stale/unknown ids (e.g. removed items in an old save)', () => {
    const r = resolveCosmetics({ hat: 'hat_removed', tie: 'nope' } as never);
    expect(r.hat).toBeNull();
    expect(r.tieColor).toBe(0xff0000);
  });
});

describe('rainbowColorAt', () => {
  it('cycles: t=0 red, t=1000 ~green-ish, full period returns to start', () => {
    expect(rainbowColorAt(0)).toBe(rainbowColorAt(3000));
    expect(rainbowColorAt(0)).not.toBe(rainbowColorAt(1500));
  });

  it('always returns a 24-bit color', () => {
    for (const t of [0, 250, 999, 2999]) {
      const c = rainbowColorAt(t);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/cosmeticsLogic.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/systems/cosmeticsLogic.ts
//
// Pure loadout → render-spec resolution. No Phaser imports — unit-testable
// and shared by the in-game renderer, the avatar compositor, and the editor.

import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import {
  getCosmeticDef, DEFAULT_TIE_COLOR,
  type HatRender, type FaceRender, type TrailRender,
} from '../data/cosmeticDefs';

export interface ResolvedCosmetics {
  tieColor:   number;
  tieRainbow: boolean;
  skinTint:   number | null;   // null = no tint
  hat:        HatRender  | null;
  face:       FaceRender | null;
  trail:      TrailRender | null;
}

export function resolveCosmetics(equipped: EquippedLoadout): ResolvedCosmetics {
  const out: ResolvedCosmetics = {
    tieColor: DEFAULT_TIE_COLOR, tieRainbow: false,
    skinTint: null, hat: null, face: null, trail: null,
  };

  const tieDef = equipped.tie ? getCosmeticDef(equipped.tie) : undefined;
  if (tieDef?.render.kind === 'tie') {
    out.tieColor   = tieDef.render.color;
    out.tieRainbow = tieDef.render.rainbow ?? false;
  }

  const skinDef = equipped.skin ? getCosmeticDef(equipped.skin) : undefined;
  if (skinDef?.render.kind === 'skin' && skinDef.render.tint !== 0xffffff) {
    out.skinTint = skinDef.render.tint;
  }

  const hatDef = equipped.hat ? getCosmeticDef(equipped.hat) : undefined;
  if (hatDef?.render.kind === 'hat') out.hat = hatDef.render;

  const faceDef = equipped.face ? getCosmeticDef(equipped.face) : undefined;
  if (faceDef?.render.kind === 'face') out.face = faceDef.render;

  const trailDef = equipped.trail ? getCosmeticDef(equipped.trail) : undefined;
  if (trailDef?.render.kind === 'trail') out.trail = trailDef.render;

  return out;
}

const RAINBOW_PERIOD_MS = 3000;

/** Hue-cycling color for the rainbow tie. Pure HSV→RGB, no Phaser. */
export function rainbowColorAt(timeMs: number): number {
  const h = (timeMs % RAINBOW_PERIOD_MS) / RAINBOW_PERIOD_MS;   // 0..1
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = 1; g = f; b = 0; break;
    case 1: r = q; g = 1; b = 0; break;
    case 2: r = 0; g = 1; b = f; break;
    case 3: r = 0; g = q; b = 1; break;
    case 4: r = f; g = 0; b = 1; break;
    case 5: r = 1; g = 0; b = q; break;
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/systems/__tests__/cosmeticsLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/cosmeticsLogic.ts src/systems/__tests__/cosmeticsLogic.test.ts
git commit -m "feat(cosmetics): pure loadout resolution + rainbow color cycle"
```

---

### Task 8: PlayerAnimator — parameterized tie color (+ rainbow)

**Files:**
- Modify: `src/entities/PlayerAnimator.ts`

**Interfaces:**
- Consumes: `rainbowColorAt` from `src/systems/cosmeticsLogic`.
- Produces: `PlayerAnimator.setTieStyle(style: { color: number; rainbow: boolean }): void`. Default behavior (no call) stays exactly today's red strings.

- [ ] **Step 1: Implement** (behavioral logic is covered by cosmeticsLogic tests; this is thin Phaser glue — verify by build + existing suite + smoke)

In `src/entities/PlayerAnimator.ts`:

Add import:

```ts
import { rainbowColorAt } from '../systems/cosmeticsLogic';
```

Add fields after `wallSlideGrace`:

```ts
  private tieColor:   number  = 0xFF0000;
  private tieRainbow: boolean = false;
  private tieTimeMs:  number  = 0;
```

Add the public method after the constructor:

```ts
  /** Set the tie-string color from the equipped cosmetic (rainbow = hue cycle). */
  setTieStyle(style: { color: number; rainbow: boolean }): void {
    this.tieColor   = style.color;
    this.tieRainbow = style.rainbow;
  }
```

At the top of `update()` (after the dormant early-return), accumulate time:

```ts
    this.tieTimeMs += delta;
```

Replace the hardcoded color in `drawStrings()`:

```ts
  private drawStrings(): void {
    this.gfx.clear();
    const color = this.tieRainbow ? rainbowColorAt(this.tieTimeMs) : this.tieColor;
    this.gfx.lineStyle(STRING_STROKE_W, color, 1);
    this.drawQuadraticBezier(0, 0, this.cpLx, this.cpLy, this.endLx, this.endLy);
    this.drawQuadraticBezier(0, 0, this.cpRx, this.cpRy, this.endRx, this.endRy);
  }
```

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: full suite PASS (no behavior change without `setTieStyle`).
Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/entities/PlayerAnimator.ts
git commit -m "feat(cosmetics): parameterize tie-string color with rainbow support"
```

---

### Task 9: PlayerCosmetics renderer + trail textures + scene integration

**Files:**
- Create: `src/entities/PlayerCosmetics.ts`
- Modify: `src/entities/TextureGenerators.ts` (trail particle textures)
- Modify: `src/scenes/GameScene.ts`, `src/scenes/InfiniteGameScene.ts`, `src/scenes/TutorialScene.ts`

**Interfaces:**
- Consumes: `ResolvedCosmetics` (Task 7), `PlayerAnimator.setTieStyle` (Task 8), textures `cos-dot|cos-fly|cos-bubble|cos-star|cos-coin|cos-puff` (this task), PNG textures `cos-<id>` (Task 11 loads them; PlayerCosmetics skips attachments whose texture is missing).
- Produces: `new PlayerCosmetics(sprite, scene, resolved: ResolvedCosmetics)` — attaches hat/face Images (POST_UPDATE-synced, squash-following), applies skin tint, runs the trail emitter while moving; `hide(): void` (death/placement); `destroy(): void`.

- [ ] **Step 1: Add trail particle textures**

In `src/entities/TextureGenerators.ts`, add calls in `generateAllTextures`:

```ts
  generateCosmeticParticleTextures(scene);
```

and the function (same file, following the existing generator style):

```ts
function generateCosmeticParticleTextures(scene: Phaser.Scene): void {
  // cos-dot — 6px filled circle
  let g = scene.add.graphics();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(3, 3, 3);
  g.generateTexture('cos-dot', 6, 6);
  g.destroy();

  // cos-fly — small body + wing nubs
  g = scene.add.graphics();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(3, 4, 2);
  g.fillCircle(1.5, 2, 1.2);
  g.fillCircle(4.5, 2, 1.2);
  g.generateTexture('cos-fly', 7, 7);
  g.destroy();

  // cos-bubble — ring
  g = scene.add.graphics();
  g.lineStyle(1.5, 0xffffff, 1);
  g.strokeCircle(5, 5, 3.5);
  g.generateTexture('cos-bubble', 10, 10);
  g.destroy();

  // cos-star — 4-point sparkle (two thin diamonds)
  g = scene.add.graphics();
  g.fillStyle(0xffffff, 1);
  g.fillTriangle(4, 0, 5.5, 4, 2.5, 4);
  g.fillTriangle(4, 8, 5.5, 4, 2.5, 4);
  g.fillTriangle(0, 4, 4, 5.5, 4, 2.5);
  g.fillTriangle(8, 4, 4, 5.5, 4, 2.5);
  g.generateTexture('cos-star', 8, 8);
  g.destroy();

  // cos-coin — filled circle with rim
  g = scene.add.graphics();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(4, 4, 3.5);
  g.lineStyle(1, 0xcccccc, 1);
  g.strokeCircle(4, 4, 3.5);
  g.generateTexture('cos-coin', 8, 8);
  g.destroy();

  // cos-puff — soft blob (three overlapping circles)
  g = scene.add.graphics();
  g.fillStyle(0xffffff, 0.8);
  g.fillCircle(4, 5, 3);
  g.fillCircle(7, 4, 2.5);
  g.fillCircle(6, 7, 2);
  g.generateTexture('cos-puff', 11, 10);
  g.destroy();
}
```

- [ ] **Step 2: Create `src/entities/PlayerCosmetics.ts`**

```ts
// src/entities/PlayerCosmetics.ts
//
// Visual cosmetic attachments for the in-game player: hat/face Images that
// follow the bag through squash/stretch, skin tint, and a movement trail
// emitter. Mirrors PlayerAnimator's POST_UPDATE sync so attachments never lag
// the physics-synced sprite by a frame. Tie color is PlayerAnimator's job.

import Phaser from 'phaser';
import type { ResolvedCosmetics } from '../systems/cosmeticsLogic';

/** Bag PNG is 174px wide displayed at 40 logical px — attachment art authored
 *  at the same ratio renders at matching scale. */
const ART_SCALE = 40 / 174;
/** Trail emits only while actually moving. */
const TRAIL_MIN_SPEED = 60;

export class PlayerCosmetics {
  private readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private readonly scene:  Phaser.Scene;
  private readonly baseScaleX: number;
  private readonly baseScaleY: number;

  private hatImg:  Phaser.GameObjects.Image | null = null;
  private faceImg: Phaser.GameObjects.Image | null = null;
  private hatOffset  = { x: 0, y: 0 };
  private faceOffset = { x: 0, y: 0 };
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private hidden = false;

  constructor(
    sprite:   Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
    scene:    Phaser.Scene,
    resolved: ResolvedCosmetics,
  ) {
    this.sprite     = sprite;
    this.scene      = scene;
    this.baseScaleX = sprite.scaleX;
    this.baseScaleY = sprite.scaleY;

    if (resolved.skinTint !== null) sprite.setTint(resolved.skinTint);

    if (resolved.hat && scene.textures.exists(resolved.hat.textureKey)) {
      this.hatImg = scene.add.image(sprite.x, sprite.y, resolved.hat.textureKey)
        .setScale(ART_SCALE).setDepth(12);
      this.hatOffset = { x: resolved.hat.offsetX, y: resolved.hat.offsetY };
    }
    if (resolved.face && scene.textures.exists(resolved.face.textureKey)) {
      this.faceImg = scene.add.image(sprite.x, sprite.y, resolved.face.textureKey)
        .setScale(ART_SCALE).setDepth(12);
      this.faceOffset = { x: resolved.face.offsetX, y: resolved.face.offsetY };
    }

    if (resolved.trail) {
      const t = resolved.trail;
      this.emitter = scene.add.particles(0, 0, t.textureKey, {
        tint:      t.tint,
        frequency: t.frequency,
        speedY:    { min: t.speedY[0], max: t.speedY[1] },
        speedX:    { min: -20, max: 20 },
        lifespan:  t.lifespan,
        scale:     { start: t.scale[0], end: t.scale[1] },
        alpha:     { start: t.alpha, end: 0 },
        emitting:  false,
      }).setDepth(9);
      this.emitter.startFollow(sprite);
    }

    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
  }

  /** Hide everything (death / successful placement) — mirrors the animator's dormant path. */
  hide(): void {
    this.hidden = true;
    this.hatImg?.setVisible(false);
    this.faceImg?.setVisible(false);
    if (this.emitter) { this.emitter.stop(); this.emitter.setVisible(false); }
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
    this.hatImg?.destroy();
    this.faceImg?.destroy();
    this.emitter?.destroy();
  }

  private sync(): void {
    if (this.hidden) return;
    // Squash factors relative to the base display scale, so attachments
    // stretch with the bag through the animator's keyframes.
    const fx = this.sprite.scaleX / this.baseScaleX;
    const fy = this.sprite.scaleY / this.baseScaleY;
    const angle = this.sprite.angle;

    if (this.hatImg) {
      this.hatImg.setPosition(
        this.sprite.x + this.hatOffset.x * fx,
        this.sprite.y + this.hatOffset.y * fy,
      );
      this.hatImg.setScale(ART_SCALE * fx, ART_SCALE * fy);
      this.hatImg.setAngle(angle);
    }
    if (this.faceImg) {
      this.faceImg.setPosition(
        this.sprite.x + this.faceOffset.x * fx,
        this.sprite.y + this.faceOffset.y * fy,
      );
      this.faceImg.setScale(ART_SCALE * fx, ART_SCALE * fy);
      this.faceImg.setAngle(angle);
    }
    if (this.emitter) {
      const body = this.sprite.body;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > TRAIL_MIN_SPEED && !this.emitter.emitting) this.emitter.start();
      else if (speed <= TRAIL_MIN_SPEED && this.emitter.emitting) this.emitter.stop();
    }
  }
}
```

- [ ] **Step 3: Wire into the three gameplay scenes**

In **`src/scenes/GameScene.ts`**:

Add imports:

```ts
import { PlayerCosmetics } from '../entities/PlayerCosmetics';
import { resolveCosmetics } from '../systems/cosmeticsLogic';
import { getEquippedCosmetics } from '../systems/SaveData';
```

(`getEquippedCosmetics` joins the existing SaveData import list if one exists.)

Add a field next to `playerAnimator`:

```ts
  private playerCosmetics!: PlayerCosmetics;
```

Immediately after `this.playerAnimator = new PlayerAnimator(this.player.sprite, this);` (line ~207):

```ts
    const cosmetics = resolveCosmetics(getEquippedCosmetics());
    this.playerAnimator.setTieStyle({ color: cosmetics.tieColor, rainbow: cosmetics.tieRainbow });
    this.playerCosmetics = new PlayerCosmetics(this.player.sprite, this, cosmetics);
```

Then find EVERY call site in this scene that passes `justDied: true` or `justPlaced: true` into `playerAnimator.update` (grep `justDied: true` and `justPlaced: true` — currently lines ~238, ~697, ~815) and add directly after each:

```ts
    this.playerCosmetics.hide();
```

Repeat the identical three edits (imports, field, post-animator wiring, hide-at-interrupt sites found by the same greps) in **`src/scenes/InfiniteGameScene.ts`** (animator created at line ~203) and **`src/scenes/TutorialScene.ts`** (line ~171).

- [ ] **Step 4: Verify**

Run: `npm test && npm run build`
Expected: PASS + clean build.
Visual: `npm run scene-preview -- GameScene '{}' pixel7` — screenshot renders (cosmetics default = unchanged look; red strings intact).

- [ ] **Step 5: Commit**

```bash
git add src/entities/PlayerCosmetics.ts src/entities/TextureGenerators.ts src/scenes/GameScene.ts src/scenes/InfiniteGameScene.ts src/scenes/TutorialScene.ts
git commit -m "feat(cosmetics): in-game attachment renderer with squash-sync + trails"
```

---

### Task 10: Avatar compositor (`composeAvatar`)

**Files:**
- Create: `src/ui/avatar.ts`

**Interfaces:**
- Consumes: `resolveCosmetics` (Task 7), texture `trashbag-nostrings`, `cos-<id>` textures when present.
- Produces: `composeAvatar(scene: Phaser.Scene, loadout: EquippedLoadout, opts: { x: number; y: number; scale: number }): Phaser.GameObjects.Container` — static bag + tint + tie strings (idle pose) + hat/face, sized `40*scale × 46*scale` around `(x, y)`. No trail (static contexts). Used by the editor preview, the menu button, and leaderboard rows.

- [ ] **Step 1: Write the implementation** (Phaser scene-graph glue; resolution logic already unit-tested in Task 7 — verified visually in Tasks 12/13)

```ts
// src/ui/avatar.ts
//
// Static mini-player compositor: bag + skin tint + tie strings (idle pose) +
// hat/face attachments in one Container. Used by the character editor preview,
// the menu avatar button, and leaderboard top-5 rows. No trail, no animation.

import Phaser from 'phaser';
import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import { resolveCosmetics } from '../systems/cosmeticsLogic';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from '../constants';

/** Same ratio the in-game bag renders at (174px art → 40 logical px). */
const ART_SCALE = PLAYER_WIDTH / 174;
/** Collar attach point for the strings, matching PlayerAnimator's offset. */
const COLLAR_Y = PLAYER_HEIGHT * -1.2 * (PLAYER_HEIGHT / 197);
/** Idle-pose string control points from PlayerAnimator's IDLE state. */
const IDLE_STRINGS = { cpLx: -9, cpLy: 16, endLx: -12, endLy: 30, cpRx: 9, cpRy: 16, endRx: 12, endRy: 30 };

export function composeAvatar(
  scene:   Phaser.Scene,
  loadout: EquippedLoadout,
  opts:    { x: number; y: number; scale: number },
): Phaser.GameObjects.Container {
  const r = resolveCosmetics(loadout);
  const s = opts.scale;
  const container = scene.add.container(opts.x, opts.y);

  // Tie strings behind the bag top but above nothing else — draw first.
  const strings = scene.add.graphics();
  strings.lineStyle(2.5 * s, r.tieColor, 1);
  drawBezier(strings, 0, COLLAR_Y * s, IDLE_STRINGS.cpLx * s, IDLE_STRINGS.cpLy * s, IDLE_STRINGS.endLx * s, IDLE_STRINGS.endLy * s);
  drawBezier(strings, 0, COLLAR_Y * s, IDLE_STRINGS.cpRx * s, IDLE_STRINGS.cpRy * s, IDLE_STRINGS.endRx * s, IDLE_STRINGS.endRy * s);
  container.add(strings);

  const bag = scene.add.image(0, 0, 'trashbag-nostrings')
    .setDisplaySize(PLAYER_WIDTH * s, PLAYER_HEIGHT * s);
  if (r.skinTint !== null) bag.setTint(r.skinTint);
  container.add(bag);

  if (r.hat && scene.textures.exists(r.hat.textureKey)) {
    container.add(scene.add.image(r.hat.offsetX * s, r.hat.offsetY * s, r.hat.textureKey)
      .setScale(ART_SCALE * s));
  }
  if (r.face && scene.textures.exists(r.face.textureKey)) {
    container.add(scene.add.image(r.face.offsetX * s, r.face.offsetY * s, r.face.textureKey)
      .setScale(ART_SCALE * s));
  }

  return container;
}

function drawBezier(g: Phaser.GameObjects.Graphics, x0: number, y0: number, cpx: number, cpy: number, x1: number, y1: number): void {
  const segments = 12;
  g.beginPath();
  g.moveTo(x0, y0);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    g.lineTo(
      mt * mt * x0 + 2 * mt * t * (x0 + cpx) + t * t * (x0 + x1),
      mt * mt * y0 + 2 * mt * t * (y0 + cpy) + t * t * (y0 + y1),
    );
  }
  g.strokePath();
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/ui/avatar.ts
git commit -m "feat(cosmetics): static avatar compositor for editor/menu/leaderboard"
```

---

### Task 11: Art manifest + asset loading + PNG batch workflow

**Files:**
- Create: `src/data/cosmeticArt.ts`
- Create: `src/sprites/cosmetics/hats/` and `src/sprites/cosmetics/face/` (directories)
- Create: `src/sprites/cosmetics/SOURCES.md`
- Modify: `src/scenes/loadGameAssets.ts`
- Test: `src/data/__tests__/cosmeticArt.test.ts`

**Interfaces:**
- Consumes: PNG files named `<id>.png` (e.g. `hat_cone.png`) dropped into the two directories; `COSMETIC_DEFS`.
- Produces: `COSMETIC_ART: Record<string, string>` (textureKey `cos-<id>` → URL, auto-built via `import.meta.glob` so dropping a file registers it with zero code changes), `isCosmeticArtAvailable(def: CosmeticDef): boolean` (procedural → always true; PNG → key present), `getAvailableCosmeticDefs(): CosmeticDef[]` (editor uses this so art-blocked items never show).

- [ ] **Step 1: Write the failing test**

```ts
// src/data/__tests__/cosmeticArt.test.ts
import { describe, it, expect } from 'vitest';
import { COSMETIC_ART, isCosmeticArtAvailable, getAvailableCosmeticDefs } from '../cosmeticArt';
import { COSMETIC_DEFS } from '../cosmeticDefs';

describe('cosmetic art manifest', () => {
  it('every manifest key follows cos-<id> and maps to a real catalog id', () => {
    const ids = new Set(COSMETIC_DEFS.map(d => d.id));
    for (const key of Object.keys(COSMETIC_ART)) {
      expect(key.startsWith('cos-')).toBe(true);
      expect(ids.has(key.slice(4)), `stray art file for unknown id ${key}`).toBe(true);
    }
  });

  it('procedural items are always available', () => {
    for (const def of COSMETIC_DEFS) {
      if (def.slot === 'tie' || def.slot === 'skin' || def.slot === 'trail') {
        expect(isCosmeticArtAvailable(def)).toBe(true);
      }
    }
  });

  it('getAvailableCosmeticDefs never returns a PNG item without art', () => {
    for (const def of getAvailableCosmeticDefs()) {
      expect(isCosmeticArtAvailable(def)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/__tests__/cosmeticArt.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the manifest**

```ts
// src/data/cosmeticArt.ts
//
// Auto-built manifest of cosmetic PNG art. Drop `<id>.png` (e.g. hat_cone.png)
// into src/sprites/cosmetics/{hats,face}/ and it is registered under texture
// key `cos-<id>` with no code change. Items with no file are simply filtered
// out of the store (isCosmeticArtAvailable) until their art lands.

import { COSMETIC_DEFS, type CosmeticDef } from './cosmeticDefs';

const files: Record<string, string> = {
  ...(import.meta.glob('../sprites/cosmetics/hats/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('../sprites/cosmetics/face/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
};

/** textureKey (`cos-<id>`) → asset URL */
export const COSMETIC_ART: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  const stem = path.split('/').pop()!.replace(/\.png$/, '');
  COSMETIC_ART[`cos-${stem}`] = url;
}

export function isCosmeticArtAvailable(def: CosmeticDef): boolean {
  if (def.render.kind === 'hat' || def.render.kind === 'face') {
    return def.render.textureKey in COSMETIC_ART;
  }
  return true;
}

/** The purchasable/equippable catalog: procedural items + PNG items whose art exists. */
export function getAvailableCosmeticDefs(): CosmeticDef[] {
  return COSMETIC_DEFS.filter(isCosmeticArtAvailable);
}
```

Create the directories with a placeholder so git tracks them:

```bash
mkdir -p src/sprites/cosmetics/hats src/sprites/cosmetics/face
touch src/sprites/cosmetics/hats/.gitkeep src/sprites/cosmetics/face/.gitkeep
```

In `src/scenes/loadGameAssets.ts` add the import and loading loop (after the placeables block, line ~65):

```ts
import { COSMETIC_ART } from '../data/cosmeticArt';
```

```ts
  // ── Cosmetic PNGs (auto-manifest; empty until art lands) ─────────────────
  for (const [key, url] of Object.entries(COSMETIC_ART)) {
    scene.load.image(key, url);
  }
```

Create `src/sprites/cosmetics/SOURCES.md`:

```markdown
# Cosmetic art sources

CC0-only. One line per file: `<file> — <origin> (<license>) — <notes>`.
Files must be named `<catalog id>.png` (e.g. `hat_cone.png`); size hats at
~120–170 px wide, face items ~60–120 px, transparent RGBA, matching the
trashbag's palette (slightly desaturated) with its dark outline.

| File | Origin | License | Notes |
|------|--------|---------|-------|
| (none yet) | | | |
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/data/__tests__/cosmeticArt.test.ts && npm run build`
Expected: PASS (manifest is empty — all assertions hold vacuously for PNGs) + clean build.

- [ ] **Step 5: Acquire the first art batch (interactive; can run in parallel with Tasks 12–14)**

This step needs a human/browser in the loop — the system is fully functional without it (PNG items are hidden until their file lands).

Per-item spec (all transparent RGBA PNG, named exactly as listed):

| File | Concept | Target size | Source suggestion |
|------|---------|-------------|-------------------|
| hat_cone.png | orange traffic cone | ~120×110 | author / CC0 |
| hat_bottlecap.png | crimped metal cap | ~130×70 | author / CC0 |
| hat_tincan.png | open tin can | ~110×110 | author / CC0 |
| hat_banana.png | draped banana peel | ~140×90 | author |
| hat_party.png | striped cone + pompom | ~110×120 | CC0 (common) |
| hat_crown.png | gold crown | ~130×90 | CC0 (common) |
| hat_tophat.png | black top hat | ~130×120 | CC0 (common) |
| hat_hardhat.png | yellow hard hat | ~140×90 | CC0 |
| hat_propeller.png | beanie + propeller | ~130×110 | CC0 |
| hat_wizard.png | starred wizard hat | ~140×130 | CC0 (common) |
| hat_cowboy.png | cowboy hat | ~160×90 | CC0 (common) |
| hat_boat.png | newspaper boat | ~150×80 | author |
| hat_beanie.png | knit beanie | ~130×90 | CC0 |
| hat_fishbone.png | fish skeleton | ~160×70 | author |
| face_googly.png | two googly eyes | ~90×40 | author (trivial) |
| face_sunglasses.png | black shades | ~110×40 | CC0 (common) |
| face_3dglasses.png | red/cyan 3D glasses | ~110×40 | CC0 |
| face_monocle.png | monocle + chain | ~60×70 | CC0 |
| face_eyepatch.png | eye patch + strap | ~100×50 | CC0 |
| face_mustache.png | handlebar mustache | ~100×40 | CC0 (common) |
| face_clownnose.png | red ball nose | ~50×50 | author (trivial) |
| face_heartglasses.png | heart-frame glasses | ~110×45 | CC0 |
| face_goggles.png | ski goggles | ~110×50 | CC0 |
| face_scar.png | crossed band-aid | ~60×60 | author (trivial) |

Workflow:
1. Check kenney.nl asset packs (all CC0 — e.g. the Roguelike/RPG and Generic Item packs contain hats/accessories; 16 px art upscales fine with nearest-neighbor to match the game's pixel-art look) and OpenGameArt with the CC0 license filter.
2. Restyle each pick: recolor toward the trashbag's slightly-desaturated palette, add its dark outline, export at the target size.
3. Trivial items (googly eyes, clown nose, scar) are faster to author directly than to source.
4. Drop files in `src/sprites/cosmetics/{hats,face}/`, record every file in `SOURCES.md`, then tune each def's `offsetX/offsetY` in `cosmeticDefs.ts` using `npm run scene-preview -- CustomizationScene '{}' pixel7`.
5. Any item that stays art-blocked: swap its concept for something easier in both `shared/cosmeticCatalog.ts` and `src/data/cosmeticDefs.ts` (tests enforce they stay in sync).

- [ ] **Step 6: Commit**

```bash
git add src/data/cosmeticArt.ts src/data/__tests__/cosmeticArt.test.ts src/scenes/loadGameAssets.ts src/sprites/cosmetics
git commit -m "feat(cosmetics): auto-manifest art pipeline + CC0 sourcing workflow"
```

---

### Task 12: Loadout sync client (PUT + debounce + session retry)

**Files:**
- Create: `src/systems/CustomizationClient.ts`
- Create: `src/systems/cosmeticsSync.ts`
- Modify: `src/scenes/MenuScene.ts` (session-start retry — one line in `create()`)
- Test: `src/systems/__tests__/cosmeticsSync.test.ts`

**Interfaces:**
- Consumes: `getEquippedCosmetics`, `getPlayerGuid`, `getLoadoutSyncPending`, `setLoadoutSyncPending` (Task 3); `fetchWithLog` from `src/logging/fetchWithLog` (same pattern as `ScoreClient`).
- Produces: `CustomizationClient.putLoadout(playerId, loadout): Promise<boolean>`; `syncLoadoutNow(): Promise<boolean>` (PUTs current save loadout; clears pending on success, sets pending on failure); `scheduleLoadoutSync(scene: Phaser.Scene): void` (2 s debounce via `scene.time`); `flushLoadoutSync(): void` (cancel timer + fire immediately, for scene shutdown).

- [ ] **Step 1: Write the failing test**

```ts
// src/systems/__tests__/cosmeticsSync.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resetAllData, resetCacheForTests, equipCosmetic, getLoadoutSyncPending, setLoadoutSyncPending } from '../SaveData';
import { syncLoadoutNow } from '../cosmeticsSync';

beforeEach(() => {
  resetAllData();
  resetCacheForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe('syncLoadoutNow', () => {
  it('PUTs the equipped loadout and clears the pending flag on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    equipCosmetic('tie', 'tie_blue');
    setLoadoutSyncPending(true);

    const ok = await syncLoadoutNow();

    expect(ok).toBe(true);
    expect(getLoadoutSyncPending()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/customization/');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body).loadout).toEqual({ tie: 'tie_blue' });
  });

  it('sets the pending flag when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const ok = await syncLoadoutNow();
    expect(ok).toBe(false);
    expect(getLoadoutSyncPending()).toBe(true);
  });

  it('sets the pending flag on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const ok = await syncLoadoutNow();
    expect(ok).toBe(false);
    expect(getLoadoutSyncPending()).toBe(true);
  });
});
```

Note: `fetchWithLog` wraps global `fetch`; if the stub doesn't reach it, check how `src/systems/__tests__/CodeClient.test.ts` mocks network calls and mirror that pattern instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/cosmeticsSync.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/systems/CustomizationClient.ts
import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import { fetchWithLog } from '../logging/fetchWithLog';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export class CustomizationClient {
  /** Upsert the equipped loadout. Returns false on any failure (offline etc.). */
  static async putLoadout(playerId: string, loadout: EquippedLoadout): Promise<boolean> {
    try {
      const res = await fetchWithLog(
        `${SERVER_URL}/customization/${encodeURIComponent(playerId)}`,
        {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ loadout }),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
```

```ts
// src/systems/cosmeticsSync.ts
//
// Debounced, offline-safe sync of the equipped loadout to the server.
// Failures set a pending flag in the save; retried on next equip change or
// next session start (MenuScene.create).

import type Phaser from 'phaser';
import { CustomizationClient } from './CustomizationClient';
import {
  getEquippedCosmetics, getPlayerGuid,
  getLoadoutSyncPending, setLoadoutSyncPending,
} from './SaveData';

const DEBOUNCE_MS = 2000;

let pendingTimer: Phaser.Time.TimerEvent | null = null;

/** PUT the current loadout now. Manages the pending flag. */
export async function syncLoadoutNow(): Promise<boolean> {
  const ok = await CustomizationClient.putLoadout(getPlayerGuid(), getEquippedCosmetics());
  setLoadoutSyncPending(!ok);
  return ok;
}

/** Debounced sync — call on every equip change in the editor. */
export function scheduleLoadoutSync(scene: Phaser.Scene): void {
  pendingTimer?.remove();
  pendingTimer = scene.time.delayedCall(DEBOUNCE_MS, () => {
    pendingTimer = null;
    void syncLoadoutNow();
  });
}

/** Cancel any debounce timer and fire immediately (scene shutdown). */
export function flushLoadoutSync(): void {
  if (pendingTimer) {
    pendingTimer.remove();
    pendingTimer = null;
    void syncLoadoutNow();
  }
}

/** Session-start retry for a previously failed sync. */
export function retryPendingLoadoutSync(): void {
  if (getLoadoutSyncPending()) void syncLoadoutNow();
}
```

In `src/scenes/MenuScene.ts` `create()` (near the top, after existing setup calls), add:

```ts
    retryPendingLoadoutSync();
```

with import `import { retryPendingLoadoutSync } from '../systems/cosmeticsSync';`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/systems/__tests__/cosmeticsSync.test.ts && npm run build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add src/systems/CustomizationClient.ts src/systems/cosmeticsSync.ts src/systems/__tests__/cosmeticsSync.test.ts src/scenes/MenuScene.ts
git commit -m "feat(cosmetics): loadout sync client with debounce + offline retry"
```

---

### Task 13: CustomizationScene (character editor) + menu entry

**Files:**
- Create: `src/scenes/CustomizationScene.ts`
- Modify: `src/main.ts` (register scene)
- Modify: `src/scenes/MenuScene.ts` (avatar button in the heap-picker row + hotkey)

**Interfaces:**
- Consumes: `composeAvatar` (Task 10), `getAvailableCosmeticDefs` (Task 11), SaveData cosmetics API (Task 3), `scheduleLoadoutSync`/`flushLoadoutSync` (Task 12), `setupUiCamera`/`logicalWidth`/`logicalHeight` from `src/systems/displayMetrics`, StoreScene's visual conventions.
- Produces: scene key `'CustomizationScene'`; MenuScene gains a 48px avatar button that opens it.

- [ ] **Step 1: Implement the scene**

```ts
// src/scenes/CustomizationScene.ts
//
// Character editor: live avatar preview on top, slot tabs (Hat/Face/Tie/Skin/
// Trail), and an item grid below. Equip applies instantly; purchases use the
// coin balance (client-authoritative, like StoreScene). Equipped loadout syncs
// to the server debounced, flushed on shutdown.

import Phaser from 'phaser';
import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { COSMETIC_SLOTS, type CosmeticSlot } from '../../shared/cosmeticCatalog';
import { type CosmeticDef } from '../data/cosmeticDefs';
import { getAvailableCosmeticDefs } from '../data/cosmeticArt';
import {
  getBalance, isCosmeticOwned, purchaseCosmetic,
  getEquippedCosmetics, equipCosmetic,
} from '../systems/SaveData';
import { syncSaveToCloud } from '../systems/cloudSave';
import { scheduleLoadoutSync, flushLoadoutSync } from '../systems/cosmeticsSync';
import { composeAvatar } from '../ui/avatar';

const SLOT_LABELS: Record<CosmeticSlot, string> = {
  hat: 'Hat', face: 'Face', tie: 'Tie', skin: 'Skin', trail: 'Trail',
};

const PREVIEW_Y     = 190;
const PREVIEW_SCALE = 3;
const TABS_Y        = 330;
const GRID_TOP      = 372;
const GRID_COLS     = 4;
const CELL          = 96;   // cell pitch
const CELL_SIZE     = 84;   // visible cell square

export class CustomizationScene extends Phaser.Scene {
  private activeSlot: CosmeticSlot = 'hat';
  private balanceText!: Phaser.GameObjects.Text;
  private preview: Phaser.GameObjects.Container | null = null;
  private tabObjects:  Phaser.GameObjects.GameObject[] = [];
  private gridObjects: Phaser.GameObjects.GameObject[] = [];
  private confirmObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() { super({ key: 'CustomizationScene' }); }

  create(): void {
    setupUiCamera(this);
    this.activeSlot = 'hat';

    this.add.rectangle(logicalWidth(this) / 2, logicalHeight(this) / 2,
      logicalWidth(this), logicalHeight(this), 0x0a0818).setDepth(0);

    // Header: back button, title, coin balance (StoreScene conventions)
    const backHit = this.add.rectangle(30, 50, 52, 52, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(11);
    this.add.text(30, 50, '←', {
      fontSize: '48px', color: '#ff9922', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);
    backHit.on('pointerup', () => this.scene.start('MenuScene'));

    this.add.text(logicalWidth(this) / 2, 50, 'WARDROBE', {
      fontSize: '38px', fontStyle: 'bold', color: '#ff9922',
      stroke: '#1a0800', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(10);

    this.balanceText = this.add.text(logicalWidth(this) / 2, 96, '', {
      fontSize: '18px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(10);

    // Preview pedestal
    const px = logicalWidth(this) / 2;
    const ped = this.add.graphics().setDepth(4);
    ped.fillStyle(0x1a1a2e, 1);
    ped.fillEllipse(px, PREVIEW_Y + 78, 170, 34);
    ped.lineStyle(1, 0x8899bb, 0.4);
    ped.strokeEllipse(px, PREVIEW_Y + 78, 170, 34);

    // Tap-to-hop zone over the preview
    this.add.zone(px, PREVIEW_Y, 160, 180).setDepth(6)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.hopPreview());

    this.rebuildPreview();
    this.createTabs();
    this.rebuildGrid();
    this.refreshBalance();

    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => flushLoadoutSync());
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  private rebuildPreview(): void {
    this.preview?.destroy();
    this.preview = composeAvatar(this, getEquippedCosmetics(),
      { x: logicalWidth(this) / 2, y: PREVIEW_Y, scale: PREVIEW_SCALE });
    this.preview.setDepth(5);
    // Idle breathing
    this.tweens.add({
      targets: this.preview, scaleX: 1.025, scaleY: 0.975,
      duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });
  }

  private hopPreview(): void {
    if (!this.preview) return;
    this.tweens.add({
      targets: this.preview, y: PREVIEW_Y - 34,
      duration: 220, yoyo: true, ease: 'Quad.Out',
    });
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  private createTabs(): void {
    this.tabObjects.forEach(o => o.destroy());
    this.tabObjects = [];
    const tabW = 78, tabH = 30, gap = 6;
    const totalW = COSMETIC_SLOTS.length * tabW + (COSMETIC_SLOTS.length - 1) * gap;
    const startX = logicalWidth(this) / 2 - totalW / 2 + tabW / 2;

    COSMETIC_SLOTS.forEach((slot, i) => {
      const active = slot === this.activeSlot;
      const x = startX + i * (tabW + gap);
      const bg = this.add.rectangle(x, TABS_Y, tabW, tabH, active ? 0x3a1800 : 0x1a0800)
        .setStrokeStyle(active ? 2 : 1, active ? 0xffaa33 : 0xff9922)
        .setInteractive({ useHandCursor: true }).setDepth(10);
      const txt = this.add.text(x, TABS_Y, SLOT_LABELS[slot], {
        fontSize: '14px', color: active ? '#ffaa33' : '#ff9922',
        stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5).setDepth(11);
      bg.on('pointerup', () => {
        this.activeSlot = slot;
        this.createTabs();
        this.rebuildGrid();
      });
      this.tabObjects.push(bg, txt);
    });
  }

  // ── Item grid ──────────────────────────────────────────────────────────────

  private rebuildGrid(): void {
    this.gridObjects.forEach(o => o.destroy());
    this.gridObjects = [];

    const defs = getAvailableCosmeticDefs().filter(d => d.slot === this.activeSlot);
    const equipped = getEquippedCosmetics()[this.activeSlot];
    const gridW = GRID_COLS * CELL;
    const left  = logicalWidth(this) / 2 - gridW / 2 + CELL / 2;

    // Cell 0: "none"/default
    this.buildCell(left, GRID_TOP + CELL / 2, null, equipped === undefined);

    defs.forEach((def, i) => {
      const idx = i + 1;
      const cx = left + (idx % GRID_COLS) * CELL;
      const cy = GRID_TOP + CELL / 2 + Math.floor(idx / GRID_COLS) * CELL;
      this.buildCell(cx, cy, def, equipped === def.id);
    });
  }

  private buildCell(cx: number, cy: number, def: CosmeticDef | null, isEquipped: boolean): void {
    const owned = def === null || isCosmeticOwned(def.id);
    const bg = this.add.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, isEquipped ? 0x1a0800 : 0x11101f)
      .setStrokeStyle(isEquipped ? 2 : 1, isEquipped ? 0xffaa33 : 0x2a2240)
      .setInteractive({ useHandCursor: true }).setDepth(8);
    this.gridObjects.push(bg);

    // Cell contents: swatch / thumbnail / "none"
    if (def === null) {
      this.gridObjects.push(this.add.text(cx, cy - 6, '∅', {
        fontSize: '26px', color: '#667799',
      }).setOrigin(0.5).setDepth(9));
      this.gridObjects.push(this.add.text(cx, cy + 26, 'None', {
        fontSize: '11px', color: '#8899aa',
      }).setOrigin(0.5).setDepth(9));
    } else {
      const r = def.render;
      if (r.kind === 'tie' || r.kind === 'skin' || r.kind === 'trail') {
        const color = r.kind === 'tie' ? r.color : r.kind === 'skin' ? r.tint : r.tint;
        const sw = this.add.graphics().setDepth(9);
        sw.fillStyle(color, 1);
        sw.fillCircle(cx, cy - 8, 16);
        sw.lineStyle(2, 0x000000, 0.5);
        sw.strokeCircle(cx, cy - 8, 16);
        this.gridObjects.push(sw);
      } else if (this.textures.exists(r.textureKey)) {
        const img = this.add.image(cx, cy - 8, r.textureKey).setDepth(9);
        const maxDim = Math.max(img.width, img.height);
        img.setScale(Math.min(1, 44 / maxDim));
        this.gridObjects.push(img);
      }
      this.gridObjects.push(this.add.text(cx, cy + 18, def.name, {
        fontSize: '10px', color: owned ? '#ffffff' : '#998877',
      }).setOrigin(0.5).setDepth(9));
      if (!owned) {
        this.gridObjects.push(this.add.text(cx, cy + 32, `${def.price}c`, {
          fontSize: '11px', color: getBalance() >= def.price ? '#ff9922' : '#664433',
          stroke: '#000000', strokeThickness: 1,
        }).setOrigin(0.5).setDepth(9));
        bg.setAlpha(0.8);
      }
    }

    bg.on('pointerup', () => this.onCellTap(def, owned));
  }

  private onCellTap(def: CosmeticDef | null, owned: boolean): void {
    if (def === null) {
      equipCosmetic(this.activeSlot, null);
      this.afterLoadoutChange();
      return;
    }
    if (owned) {
      equipCosmetic(this.activeSlot, def.id);
      this.afterLoadoutChange();
      return;
    }
    this.showConfirmPurchase(def);
  }

  private afterLoadoutChange(): void {
    this.rebuildPreview();
    this.rebuildGrid();
    scheduleLoadoutSync(this);
  }

  // ── Purchase confirm dialog ────────────────────────────────────────────────

  private showConfirmPurchase(def: CosmeticDef): void {
    this.closeConfirm();
    const cx = logicalWidth(this) / 2;
    const cy = logicalHeight(this) / 2;

    const overlay = this.add.rectangle(cx, cy, logicalWidth(this), logicalHeight(this), 0x000000, 0.7)
      .setDepth(30).setInteractive();
    const panel = this.add.rectangle(cx, cy, 320, 170, 0x0d0d20)
      .setDepth(31).setStrokeStyle(2, 0xff9922).setInteractive();
    const title = this.add.text(cx, cy - 52, `Buy ${def.name}?`, {
      fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(32);
    const price = this.add.text(cx, cy - 22, `${def.price} coins  (you have ${getBalance()})`, {
      fontSize: '14px', color: '#ffdd77',
    }).setOrigin(0.5).setDepth(32);

    const canAfford = getBalance() >= def.price;
    const buyBg = this.add.rectangle(cx - 70, cy + 38, 120, 40, canAfford ? 0x1a3a1a : 0x1a1a1a)
      .setStrokeStyle(1, canAfford ? 0x44ff88 : 0x444444).setDepth(32)
      .setInteractive({ useHandCursor: canAfford });
    const buyTxt = this.add.text(cx - 70, cy + 38, canAfford ? 'BUY' : 'TOO POOR', {
      fontSize: '15px', color: canAfford ? '#44ff88' : '#666666', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33);
    const cancelBg = this.add.rectangle(cx + 70, cy + 38, 120, 40, 0x2a1010)
      .setStrokeStyle(1, 0xff6666).setDepth(32).setInteractive({ useHandCursor: true });
    const cancelTxt = this.add.text(cx + 70, cy + 38, 'CANCEL', {
      fontSize: '15px', color: '#ff9999', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33);

    this.confirmObjects = [overlay, panel, title, price, buyBg, buyTxt, cancelBg, cancelTxt];

    overlay.on('pointerup', () => this.closeConfirm());
    cancelBg.on('pointerup', () => this.closeConfirm());
    if (canAfford) {
      buyBg.on('pointerup', () => {
        if (purchaseCosmetic(def.id)) {
          syncSaveToCloud();
          equipCosmetic(def.slot, def.id);   // equip on purchase — instant gratification
          this.closeConfirm();
          this.refreshBalance();
          this.afterLoadoutChange();
        }
      });
    }
  }

  private closeConfirm(): void {
    this.confirmObjects.forEach(o => o.destroy());
    this.confirmObjects = [];
  }

  private refreshBalance(): void {
    this.balanceText.setText(`Balance: ${getBalance()} coins`);
  }
}
```

- [ ] **Step 2: Register the scene**

In `src/main.ts`: add `import { CustomizationScene } from './scenes/CustomizationScene';` and append `CustomizationScene` to the `scene: [...]` array (line ~85).

- [ ] **Step 3: MenuScene avatar button**

In `src/scenes/MenuScene.ts`, `createHeapPicker()` (line ~701): the row is currently `264px picker + 8 + 48px trophy = 320`. Shrink the picker to 208 px and add a 48 px avatar button:

- Change `fillRoundedRect(left, 480 - shift, 264, 48, 10)` / matching `strokeRoundedRect` to width `208`.
- Change `const trophyLeft = left + 264 + 8;` to `const trophyLeft = left + 208 + 8;`
- Change `const barCx = left + 132;` to `const barCx = left + 104;`
- Change the picker tap zone `this.add.zone(barCx, rowY, 264, 48)` to width `208`.
- After the trophy zone block, add:

```ts
    // Wardrobe button — mini avatar of the current loadout, right of the trophy.
    const wardrobeLeft = trophyLeft + 48 + 8;
    const wardrobeCx   = wardrobeLeft + 24;
    const wardrobeBg = this.add.graphics().setDepth(8).setAlpha(0);
    wardrobeBg.fillStyle(0x000000, 0.5);
    wardrobeBg.fillRoundedRect(wardrobeLeft, 480 - shift, 48, 48, 10);
    wardrobeBg.lineStyle(1, 0x8899bb, 0.6);
    wardrobeBg.strokeRoundedRect(wardrobeLeft, 480 - shift, 48, 48, 10);
    const wardrobeAvatar = composeAvatar(this, getEquippedCosmetics(),
      { x: wardrobeCx, y: rowY, scale: 0.75 }).setDepth(9).setAlpha(0);
    this.add.zone(wardrobeCx, rowY, 48, 48)
      .setDepth(9).setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.scene.start('CustomizationScene'));
```

with imports `import { composeAvatar } from '../ui/avatar';` and `getEquippedCosmetics` added to the SaveData import list.

**Fade-in wiring:** the heap-picker objects are revealed by MenuScene's entrance tween. Find where `heapPickerBg`/`leaderboardBg` alphas are tweened to 1 (grep `heapPickerBg` in the entrance/tween code) and add `wardrobeBg` + `wardrobeAvatar` to the same tween targets — store them as fields `private wardrobeBg!: Phaser.GameObjects.Graphics; private wardrobeAvatar!: Phaser.GameObjects.Container;` if needed.

**Avatar depends on the `trashbag-nostrings` texture.** MenuScene runs `loadGameAssets` — if the texture may not be loaded yet at `create()` time, guard: only compose the avatar when `this.textures.exists('trashbag-nostrings')`, else draw a '👤' text fallback and swap on the `gameAssetsReady` game event (same pattern as the `heapCatalogReady` refresh in this method).

Also add the hotkey: in `createHotkeyLegend()` add `{ key: 'W', label: 'Wardrobe' },` to the `keys` array, and wherever MenuScene registers keyboard shortcuts for U/S/H/L (grep `keydown-U`), add:

```ts
    this.input.keyboard?.on('keydown-W', () => this.scene.start('CustomizationScene'));
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run build`
Expected: PASS + clean build.
Visual: `npm run scene-preview -- CustomizationScene '{}' pixel7` — header, preview bag with red strings, 5 tabs, grid with None + tie swatches when Tie tab default... (default tab is Hat: grid shows only "None" until art lands — expected). Also `npm run scene-preview -- MenuScene '{}' pixel7` — picker row shows picker/trophy/avatar without overlap.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/CustomizationScene.ts src/main.ts src/scenes/MenuScene.ts
git commit -m "feat(cosmetics): character editor scene + menu wardrobe button"
```

---

### Task 14: Leaderboard avatars — enlarged top-5 rows

**Files:**
- Modify: `src/scenes/scoreLayout.ts` (pure row-slot helper)
- Modify: `src/scenes/ScoreScene.ts` (`createLeaderboardPanel` reservation + `renderLeaderboardEntries`)
- Modify: `src/scenes/LeaderboardScene.ts` (avatars on ranks ≤ 5)
- Test: extend `src/scenes/__tests__/scoreLayout.test.ts`

**Interfaces:**
- Consumes: `LeaderboardEntry.loadout` (Task 6 — flows through existing `ScoreClient` calls untouched), `composeAvatar` (Task 10).
- Produces: `leaderboardRowSlots(rowCount, rowH, enlargeCount): { slots: Array<{ y: number; h: number; enlarged: boolean }>; totalH: number }` and `LB_ROW_SCALE = 1.4` exported from `scoreLayout.ts`.

- [ ] **Step 1: Write the failing tests** (append to `src/scenes/__tests__/scoreLayout.test.ts`)

```ts
import { leaderboardRowSlots, LB_ROW_SCALE } from '../scoreLayout';

describe('leaderboardRowSlots', () => {
  it('enlarges the first N rows by LB_ROW_SCALE', () => {
    const { slots } = leaderboardRowSlots(7, 20, 5);
    expect(slots).toHaveLength(7);
    for (let i = 0; i < 5; i++) {
      expect(slots[i].h).toBe(20 * LB_ROW_SCALE);
      expect(slots[i].enlarged).toBe(true);
    }
    expect(slots[5].h).toBe(20);
    expect(slots[5].enlarged).toBe(false);
  });

  it('stacks y offsets cumulatively and reports totalH', () => {
    const { slots, totalH } = leaderboardRowSlots(3, 20, 2);
    expect(slots[0].y).toBe(0);
    expect(slots[1].y).toBe(28);        // 20 * 1.4
    expect(slots[2].y).toBe(56);        // 28 + 28
    expect(totalH).toBe(76);            // 28 + 28 + 20
  });

  it('handles fewer rows than the enlarge count', () => {
    const { slots, totalH } = leaderboardRowSlots(2, 20, 5);
    expect(slots.every(s => s.enlarged)).toBe(true);
    expect(totalH).toBe(56);
  });

  it('handles zero rows', () => {
    const { slots, totalH } = leaderboardRowSlots(0, 20, 5);
    expect(slots).toEqual([]);
    expect(totalH).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scenes/__tests__/scoreLayout.test.ts`
Expected: FAIL — `leaderboardRowSlots` not exported.

- [ ] **Step 3: Implement the helper** (append to `src/scenes/scoreLayout.ts`)

```ts
/** Height multiplier for the showcase (avatar) rows at the top of a leaderboard. */
export const LB_ROW_SCALE = 1.4;

export interface LeaderboardRowSlot {
  y: number;         // top offset within the panel body
  h: number;         // row height
  enlarged: boolean; // true for the avatar-showcase rows
}

/**
 * Row layout for a leaderboard panel whose first `enlargeCount` rows are
 * enlarged to fit a mini player avatar (the "show off your cosmetics" rows).
 */
export function leaderboardRowSlots(
  rowCount: number,
  rowH: number,
  enlargeCount: number,
): { slots: LeaderboardRowSlot[]; totalH: number } {
  const slots: LeaderboardRowSlot[] = [];
  let y = 0;
  for (let i = 0; i < rowCount; i++) {
    const enlarged = i < enlargeCount;
    const h = enlarged ? rowH * LB_ROW_SCALE : rowH;
    slots.push({ y, h, enlarged });
    y += h;
  }
  return { slots, totalH: y };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scenes/__tests__/scoreLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Rework `ScoreScene.renderLeaderboardEntries` + panel reservation**

Add imports to `src/scenes/ScoreScene.ts`:

```ts
import { leaderboardRowSlots } from './scoreLayout';   // join the existing scoreLayout import
import { composeAvatar } from '../ui/avatar';
```

5a. In `createLeaderboardPanel` (line ~928), replace the flat reservation

```ts
    const panelBottom = PANEL_TOP + (reservedRows * ROW_H + 8);
```

with the enlarged-aware worst case (top LEADERBOARD_TOP_N rows enlarged; the +2 gap/player rows stay normal height):

```ts
    const reservedTopRows = this._mockLeaderboard ? this._mockLeaderboard.top.length : LEADERBOARD_TOP_N;
    const reservedExtra   = reservedRows - reservedTopRows;   // gap + player rows (0 or 2)
    const { totalH: reservedTopH } = leaderboardRowSlots(reservedTopRows, ROW_H, 5);
    const panelBottom = PANEL_TOP + reservedTopH + reservedExtra * ROW_H + 8;
```

5b. In `renderLeaderboardEntries` (line ~1015), replace the fixed-height row loop. Compute slots first:

```ts
    const { slots, totalH } = leaderboardRowSlots(ctx.top.length, rowH, 5);
    const extraRows = ctx.player && !this.playerInTop(ctx) ? 2 : 0;
    const panelH    = totalH + extraRows * rowH + 8;
```

(replace the existing `totalRows`/`panelH` lines; the `bg` rounded rect uses the new `panelH`).

Then rewrite the top-N loop to use slots — replacing `const mid = y + rowH / 2;` bookkeeping with per-slot geometry, an avatar on enlarged rows, and a name indent that clears the avatar:

```ts
    const bodyTop = panelTop + 4;
    for (let i = 0; i < ctx.top.length; i++) {
      const entry    = ctx.top[i];
      const slot     = slots[i];
      const isPlayer = entry.playerId === (ctx.player?.playerId ?? '');
      const nameCol  = isPlayer && this.isNewHighScore ? '#ffdd44' : '#aaccee';
      const rankCol  = isPlayer && this.isNewHighScore ? '#ffdd44' : '#668899';
      const mid      = bodyTop + slot.y + slot.h / 2;

      const stripe = this.add.graphics();
      stripe.fillStyle(i % 2 === 0 ? 0x0d3155 : 0x071d33, 0.5);
      stripe.fillRect(logicalWidth(this) / 2 - panelW / 2, bodyTop + slot.y, panelW, slot.h);
      lb.push(stripe);

      const rankTxt = this.add.text(left, mid, `#${entry.rank}`, {
        fontSize: '11px', fontFamily: 'monospace', color: rankCol,
      }).setOrigin(0, 0.5);
      lb.push(rankTxt);

      let nameX = left + 36;
      if (slot.enlarged) {
        // Mini avatar showcasing the player's cosmetics (~23px tall at 0.5).
        const avatar = composeAvatar(this, entry.loadout ?? {}, {
          x: left + 44, y: mid, scale: 0.5,
        });
        lb.push(avatar);
        nameX = left + 62;
      }

      const nameTxt = this.add.text(nameX, mid, entry.name, {
        fontSize: '11px', fontFamily: 'monospace', color: nameCol,
      }).setOrigin(0, 0.5);
      lb.push(nameTxt);

      const scoreTxt = this.add.text(right, mid, String(entry.score), {
        fontSize: '11px', fontFamily: 'monospace', color: nameCol,
      }).setOrigin(1, 0.5);
      lb.push(scoreTxt);
    }
```

And rebase the follow-on gap/player-row block onto `let y = bodyTop + totalH;` (replacing its previous `y` accumulation; row bodies unchanged).

5c. `LeaderboardScene` (line ~192): rows are already 28 px — add an avatar without enlarging. Inside the `entries.forEach`, after `nameColor` is computed, add:

```ts
      const showAvatar = entry.rank <= 5;
```

then before the `nameText` creation:

```ts
      if (showAvatar) {
        const avatar = composeAvatar(this, entry.loadout ?? {}, {
          x: this.bodyLeft + 44, y: rowY, scale: 0.5,
        });
        this.bodyContainer.add(avatar);
      }
```

and shift the name over on avatar rows: `this.bodyLeft + 70` → `this.bodyLeft + (showAvatar ? 62 : 70)` (the rank column already occupies the far left; 62 clears a 20px avatar centered at +44).
Imports: `import { composeAvatar } from '../ui/avatar';`.

**Texture guard:** both scenes may render before `trashbag-nostrings` is loaded (ScoreScene runs after gameplay so it's loaded there; LeaderboardScene can open from the menu early). In LeaderboardScene wrap the avatar creation in `if (this.textures.exists('trashbag-nostrings'))`.

- [ ] **Step 6: Verify**

Run: `npm test && npm run build`
Expected: PASS + clean build.
Visual: ScoreScene supports mock data — render it with loadouts:

```bash
npm run scene-preview -- ScoreScene '{"mockLeaderboard":{"top":[{"rank":1,"playerId":"a","name":"Alpha","score":9000,"loadout":{"tie":"tie_gold","skin":"skin_toxic"}},{"rank":2,"playerId":"b","name":"Beta","score":7000,"loadout":{"tie":"tie_cyan"}},{"rank":3,"playerId":"c","name":"Gamma","score":5000},{"rank":4,"playerId":"d","name":"Delta","score":3000},{"rank":5,"playerId":"e","name":"Epsilon","score":2000},{"rank":6,"playerId":"f","name":"Zeta","score":1000}],"player":null}}' pixel7
```

Expected: first 5 rows visibly taller with mini bag avatars (gold/cyan strings, toxic tint), row 6 normal, panel + bottom buttons not overlapping. (If ScoreScene's preview requires more init data, check `heap-scene-preview` skill notes for the scene's expected payload.)

- [ ] **Step 7: Commit**

```bash
git add src/scenes/scoreLayout.ts src/scenes/ScoreScene.ts src/scenes/LeaderboardScene.ts src/scenes/__tests__/scoreLayout.test.ts
git commit -m "feat(cosmetics): avatar showcase on enlarged top-5 leaderboard rows"
```

---

### Task 15: Final verification + docs

**Files:**
- Modify: `Todo/Todo.md` (mark the cosmetics item as in-PR / remove at merge)

- [ ] **Step 1: Full suite + build**

Run: `npm test`
Expected: ALL suites pass (src + shared + server).
Run: `npm run build`
Expected: clean TS build.

- [ ] **Step 2: Local server smoke (uses local D1 with migration 0002 applied in Task 4)**

```bash
cd server && npx wrangler dev --local &
sleep 4
curl -s -X PUT localhost:8787/customization/smoke-test -H 'Content-Type: application/json' -d '{"loadout":{"tie":"tie_gold"}}'
curl -s localhost:8787/customization/smoke-test
curl -s -X PUT localhost:8787/customization/smoke-test -H 'Content-Type: application/json' -d '{"loadout":{"tie":"hat_cone"}}'
kill %1
```

Expected: `{"ok":true}` · `{"loadout":{"tie":"tie_gold"}}` · `{"error":"invalid loadout"}`.

- [ ] **Step 3: Scene previews (visual gate)**

```bash
npm run scene-preview -- MenuScene '{}' pixel7
npm run scene-preview -- CustomizationScene '{}' pixel7
```

Check: menu row (picker 208 / trophy / wardrobe avatar) fits; editor tabs + grid + preview render.

- [ ] **Step 4: Live smoke checklist (user's dev server on localhost:3000 — do not start one)**

- Wardrobe: buy + equip a tie color → preview strings change instantly; hop animation on tap.
- Start a run → in-game strings match; equip a trail → particles only while moving; die → cosmetics hidden with the bag.
- Score screen → top-5 rows enlarged, avatars visible.
- Reload page → loadout persists; with dev worker running, `GET /customization/<guid>` shows the synced blob.

- [ ] **Step 5: Update Todo + wrap up**

In `Todo/Todo.md`, replace the cosmetics paragraph (line 12) with:

```markdown
- Cosmetics system — implemented on feature/cosmetics-system (spec: docs/superpowers/specs/2026-07-02-cosmetics-system-design.md). Remaining: PNG art batch (see plan Task 11 workflow), remote migration heap_scores/0002 at merge.
```

```bash
git add Todo/Todo.md
git commit -m "docs: update Todo for cosmetics system"
```

Then follow superpowers:finishing-a-development-branch — user decides on PR/merge. Reminders for the PR description: remote migration `heap_scores/0002` runs via `migrate-d1.yml` on merge; PNG art lands incrementally (items auto-appear as files drop in).

---

## Self-Review Notes

- **Spec coverage:** catalog/defs (T1–2), SaveData v5 + merge (T3), migration (T4), PUT/GET + validation (T5), leaderboard JOIN + shared type (T6), tie color + rainbow (T7–8), in-game renderer + trails + outro-hide (T9), compositor (T10), art pipeline + CC0 workflow + SOURCES.md (T11), sync + offline retry (T12), editor + menu button (T13), enlarged top-5 + avatars both leaderboard surfaces (T14), rollout/verification (T15). Cache-staleness note handled by design in T6 (no code).
- **Type consistency check:** `EquippedLoadout` (shared) used everywhere; `resolveCosmetics`/`ResolvedCosmetics` (T7) consumed in T9/T10/T13; `composeAvatar(scene, loadout, {x,y,scale})` uniform across T13/T14; `cos-<id>` texture convention enforced by T2 test and produced by T11 manifest; `seedLoadout` defined in T6 and used in T6 tests.
- **Known deferred items:** PNG art acquisition is human-in-the-loop (T11 Step 5) — system ships functional without it; per-item px-offset tuning happens as art lands.
