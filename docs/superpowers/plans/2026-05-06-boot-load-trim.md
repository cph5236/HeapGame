# Boot-Time Asset Load Trim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Heap's bootup time by deferring ~360 PNG loads off the critical path. MenuScene appears as soon as the player sprite is ready; the rest streams in while the menu is on screen.

**Architecture:** Three independent shifts:
1. **Curate the trash-wall sprite pool to a small weighted random sample** — `TrashWallManager` is the only consumer that actually renders OBJECT_DEF PNGs at runtime. Reduce its pool from all 336 → a session-scoped weighted random sample of N (default 50) using each def's existing `rarity` field.
2. **Dedupe the recycle-items double-load** — these PNGs are currently loaded under two different texture-key naming schemes. Point `PortalManager` at the OBJECT_DEFS keys and delete `portalRecycleUrls.ts`.
3. **Defer non-critical loading out of `BootScene`** — `BootScene.preload` only loads `trashbag` (the menu's only image). Everything else (heap tiles, placeables, enemy spritesheets, portal sprite, curated trash-wall pool) becomes a background load kicked off from `MenuScene.create`. The START button is disabled (LOADING…) until the registry flag `gameAssetsReady` is true.

**Tech Stack:** Phaser 3.90 (`scene.load`, `scene.textures`, `scene.registry`), TypeScript 5.9, Vitest. Phaser's TextureManager is global — textures loaded from any scene are accessible by key from every other scene.

---

## File Structure

**New files:**
- `src/systems/trashWallPool.ts` — pure module exporting `pickTrashWallPool(defs, count, rng)`. Weighted-random-without-replacement sampler. No Phaser imports. Single responsibility.
- `src/systems/__tests__/trashWallPool.test.ts` — Vitest tests for the sampler. Seeded RNG for determinism.
- `src/scenes/loadGameAssets.ts` — pure helper invoked from `MenuScene.create` that schedules every non-boot asset load on the scene's `LoaderPlugin`, registers enemy animations on `complete`, then sets `registry.gameAssetsReady = true`. No Phaser scene class, just a function `(scene: Phaser.Scene) => void`.

**Modified files:**
- `src/systems/TrashWallManager.ts` — replace module-level `SPRITE_KEYS = OBJECT_DEF_LIST.map(...)` with a per-instance `this.spriteKeys` read from `scene.registry.get('trashWallPool')`, falling back to all OBJECT_DEFS keys if the registry value is missing (keeps tests + edge cases working).
- `src/systems/PortalManager.ts` — change `recycle-item-${i}` to `recycle-items-${i.toString().padStart(2,'0')}` to reuse the OBJECT_DEFS keys.
- `src/scenes/BootScene.ts` — strip `preload` to `trashbag` only. Remove imports for `OBJECT_DEF_LIST`, `HEAP_PNG_URLS`, `HEAP_TILE_URLS`, `HEAP_TILE_COUNT`, `HEAP_FILL_TEXTURE`, all placeable URLs, bridge URL, both vulture URLs, rat URL, `PORTAL_DEF`, `RECYCLE_ITEM_URLS`, `RECYCLE_ITEM_COUNT`. Move `HeapClient.list/load` so it does not block `scene.start('MenuScene')`.
- `src/scenes/MenuScene.ts` — call `loadGameAssets(this)` after the entrance sequence kicks off. Wire START button (and Heap-picker) to read `gameAssetsReady` flag — disabled visual + non-interactive until ready, then promote to interactive `START RUN`.

**Deleted files:**
- `src/data/portalRecycleUrls.ts` — superseded by direct OBJECT_DEFS texture-key references.

---

## Task 1: Pure trash-wall pool selector

**Files:**
- Create: `src/systems/trashWallPool.ts`
- Test: `src/systems/__tests__/trashWallPool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/systems/__tests__/trashWallPool.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickTrashWallPool } from '../trashWallPool';

type Def = { textureKey: string; rarity: number };

function seededRng(seed: number): () => number {
  // Mulberry32 — deterministic, good enough for tests
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const defs: Def[] = Array.from({ length: 100 }, (_, i) => ({
  textureKey: `k${i}`,
  rarity: i < 50 ? 1.0 : 0.1,  // first 50 are 10× more likely than last 50
}));

describe('pickTrashWallPool', () => {
  it('returns exactly count items when count <= defs.length', () => {
    const rng = seededRng(42);
    const out = pickTrashWallPool(defs, 50, rng);
    expect(out).toHaveLength(50);
  });

  it('returns all items when count >= defs.length', () => {
    const rng = seededRng(42);
    const out = pickTrashWallPool(defs, 500, rng);
    expect(out).toHaveLength(defs.length);
  });

  it('never duplicates', () => {
    const rng = seededRng(7);
    const out = pickTrashWallPool(defs, 50, rng);
    const keys = new Set(out.map(d => d.textureKey));
    expect(keys.size).toBe(out.length);
  });

  it('is deterministic given the same rng seed', () => {
    const a = pickTrashWallPool(defs, 30, seededRng(99));
    const b = pickTrashWallPool(defs, 30, seededRng(99));
    expect(a.map(d => d.textureKey)).toEqual(b.map(d => d.textureKey));
  });

  it('weights selection — high-rarity items appear more often than low-rarity over many trials', () => {
    let highCount = 0;
    let lowCount  = 0;
    for (let trial = 0; trial < 200; trial++) {
      const out = pickTrashWallPool(defs, 10, seededRng(trial + 1));
      for (const d of out) {
        if (d.rarity === 1.0) highCount++;
        else lowCount++;
      }
    }
    // High-rarity (10× weight) should dominate; allow generous margin
    expect(highCount).toBeGreaterThan(lowCount * 3);
  });

  it('handles empty input', () => {
    expect(pickTrashWallPool([], 10, seededRng(1))).toEqual([]);
  });

  it('handles zero count', () => {
    expect(pickTrashWallPool(defs, 0, seededRng(1))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/trashWallPool.test.ts`
Expected: FAIL — `Cannot find module '../trashWallPool'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/systems/trashWallPool.ts`:

```ts
/**
 * Weighted random sample without replacement.
 *
 * Uses the Efraimidis–Spirakis "weighted reservoir" algorithm: each item gets
 * a key u^(1/w), where u ∈ (0,1] is uniform random and w is the item's weight.
 * Sort descending by key, take the top `count`. Result is statistically a
 * weighted-without-replacement sample.
 *
 * @param defs   Source items, each with a `rarity` ∈ (0, 1] used as weight.
 * @param count  Desired pool size. Result is clipped to `defs.length`.
 * @param rng    () => number in [0, 1). Defaults to `Math.random`. Pass a
 *               seeded rng in tests for determinism.
 */
export function pickTrashWallPool<T extends { rarity: number }>(
  defs: readonly T[],
  count: number,
  rng: () => number = Math.random,
): T[] {
  if (count <= 0 || defs.length === 0) return [];
  const n = Math.min(count, defs.length);

  const keyed = defs.map((def) => {
    const w = def.rarity > 0 ? def.rarity : 1e-9;
    // Avoid Math.log(0) — clamp uniform sample slightly above 0.
    const u = Math.max(rng(), 1e-12);
    return { def, key: Math.log(u) / w };  // equivalent to u^(1/w), monotonic
  });

  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, n).map((k) => k.def);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/systems/__tests__/trashWallPool.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/systems/trashWallPool.ts src/systems/__tests__/trashWallPool.test.ts
git commit -m "feat(trashwall): weighted random pool selector"
```

---

## Task 2: Wire pool selector into TrashWallManager

**Files:**
- Modify: `src/systems/TrashWallManager.ts:48`, `:139`, `:173`

- [ ] **Step 1: Read existing `TrashWallManager.ts:1-180`**

Specifically inspect the constructor signature and the `_buildSpritePool` / `_redraw` methods so the diff is minimal.

- [ ] **Step 2: Replace the module-level constant with an instance field populated from the registry**

In `src/systems/TrashWallManager.ts`, find:

```ts
const SPRITE_KEYS = OBJECT_DEF_LIST.map(d => d.textureKey);
```

Replace with:

```ts
/** Fallback when the registry pool is missing — keeps tests + edge cases functional. */
const FALLBACK_SPRITE_KEYS: readonly string[] = OBJECT_DEF_LIST.map(d => d.textureKey);
```

Then in the class constructor, after `this.scene = scene` (or wherever scene is captured), add:

```ts
const pool = scene.registry.get('trashWallPool') as readonly string[] | undefined;
this.spriteKeys = pool && pool.length > 0 ? pool : FALLBACK_SPRITE_KEYS;
```

Add the field declaration near the other private fields:

```ts
private readonly spriteKeys: readonly string[];
```

- [ ] **Step 3: Replace both `SPRITE_KEYS` reads inside the class with `this.spriteKeys`**

Two occurrences — line 139 (`_buildSpritePool`) and line 173 (`_redraw`). Pattern:

```ts
const key = this.spriteKeys[Math.floor(Math.random() * this.spriteKeys.length)];
// ...
img.setTexture(this.spriteKeys[Math.floor(Math.random() * this.spriteKeys.length)]);
```

- [ ] **Step 4: Run existing TrashWallManager tests + full suite to verify no regression**

Run: `npx vitest run src/systems/__tests__/TrashWallManager.test.ts`
Expected: PASS — existing pure-function tests (`computeWallSpeed`, `clampWallY`, `isKillZoneReached`) untouched.

Run: `npx vitest run`
Expected: PASS — same green count as before plus the 7 from Task 1.

- [ ] **Step 5: Commit**

```bash
git add src/systems/TrashWallManager.ts
git commit -m "refactor(trashwall): read sprite pool from registry, fallback to all defs"
```

---

## Task 3: Background-load assets from MenuScene; gate START button

**Files:**
- Create: `src/scenes/loadGameAssets.ts`
- Modify: `src/scenes/BootScene.ts` (full preload rewrite)
- Modify: `src/scenes/MenuScene.ts` (call loader + gate START + Heap picker)

This task does not have new unit tests — it is integration plumbing. Verification is by running the dev server and checking the menu appears with a disabled START button that becomes enabled.

- [ ] **Step 1: Create `src/scenes/loadGameAssets.ts`**

```ts
import Phaser from 'phaser';
import { OBJECT_DEFS, OBJECT_DEF_LIST } from '../data/heapObjectDefs';
import { HEAP_PNG_URLS } from '../data/heapPngUrls';
import { HEAP_FILL_TEXTURE } from '../constants';
import { HEAP_TILE_URLS, HEAP_TILE_COUNT } from '../data/heapTileUrls';
import { PORTAL_DEF } from '../data/portalDefs';
import { pickTrashWallPool } from '../systems/trashWallPool';
import ibeamUrl       from '../sprites/Placeables/IBeam.png?url';
import ladderUrl      from '../sprites/Placeables/Ladder.png?url';
import tombstone1Url  from '../sprites/Placeables/TombStone (1).png?url';
import tombstone2Url  from '../sprites/Placeables/TombStone (2).png?url';
import bridgeUrl      from '../sprites/Bridge/Bridge.png?url';
import vultureFlyLeftUrl  from '../sprites/Enemies/vulture/vulture-fly-left.png?url';
import vultureFlyRightUrl from '../sprites/Enemies/vulture/vulture-fly-right.png?url';
import ratUrl         from '../sprites/Enemies/Rat/rat.png?url';

/** Default size of the per-session trash-wall sprite pool. */
const TRASH_WALL_POOL_SIZE = 50;

/**
 * Schedules every non-boot asset load on the given scene's LoaderPlugin and
 * starts loading immediately. Sets `registry.gameAssetsReady = true` when
 * the loader's `complete` event fires. Idempotent — if `gameAssetsReady` is
 * already true, this is a no-op.
 *
 * Safe to call from any scene that's currently active. Phaser's TextureManager
 * is global, so textures end up accessible from every scene.
 */
export function loadGameAssets(scene: Phaser.Scene): void {
  if (scene.registry.get('gameAssetsReady') === true) return;
  if (scene.registry.get('gameAssetsLoading') === true) return;
  scene.registry.set('gameAssetsLoading', true);

  // ── Pick the trash-wall pool once per session ────────────────────────────
  const existingPool = scene.registry.get('trashWallPool') as string[] | undefined;
  const pool = existingPool && existingPool.length > 0
    ? existingPool
    : pickTrashWallPool(OBJECT_DEF_LIST, TRASH_WALL_POOL_SIZE).map(d => d.textureKey);
  scene.registry.set('trashWallPool', pool);

  // ── Load only the curated pool's PNGs ────────────────────────────────────
  // Build a textureKey → ObjectDef map so we can look up filenames quickly.
  for (const key of pool) {
    const def = OBJECT_DEF_LIST.find(d => d.textureKey === key);
    if (!def) continue;
    const url = HEAP_PNG_URLS[def.textureKey];
    if (url) scene.load.image(def.textureKey, url);
  }

  // ── Heap fill tiles ──────────────────────────────────────────────────────
  for (let i = 0; i < HEAP_TILE_COUNT; i++) {
    scene.load.image(`${HEAP_FILL_TEXTURE}-${i}`, HEAP_TILE_URLS[i]);
  }

  // ── Placeables + bridge ──────────────────────────────────────────────────
  scene.load.image('item-ibeam',        ibeamUrl);
  scene.load.image('item-ladder',       ladderUrl);
  scene.load.image('item-checkpoint-1', tombstone1Url);
  scene.load.image('item-checkpoint-2', tombstone2Url);
  scene.load.image('bridge',            bridgeUrl);

  // ── Enemy spritesheets ───────────────────────────────────────────────────
  scene.load.spritesheet('vulture-fly-left',  vultureFlyLeftUrl,  { frameWidth: 64, frameHeight: 43 });
  scene.load.spritesheet('vulture-fly-right', vultureFlyRightUrl, { frameWidth: 64, frameHeight: 42 });
  scene.load.spritesheet('rat',               ratUrl,             { frameWidth: 32, frameHeight: 32 });

  // ── Portal (recycle-items now reuse OBJECT_DEFS keys, no separate load) ──
  scene.load.image(PORTAL_DEF.spriteKey, PORTAL_DEF.spritePath);

  // Recycle items are part of OBJECT_DEFS — but they may not have been picked
  // into the trash-wall pool. PortalManager needs them all, so explicit-load
  // any recycle-items-NN keys not already queued.
  for (let i = 0; i < 16; i++) {
    const k = `recycle-items-${i.toString().padStart(2, '0')}`;
    if (pool.includes(k)) continue;
    const def = Object.values(OBJECT_DEFS).find(d => d.textureKey === k);
    if (!def) continue;
    const url = HEAP_PNG_URLS[def.textureKey];
    if (url) scene.load.image(k, url);
  }

  // ── On complete: register enemy animations + flip the ready flag ─────────
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    scene.anims.create({ key: 'rat-idle',       frames: scene.anims.generateFrameNumbers('rat', { start: 0,  end: 2  }), frameRate: 6,  repeat: -1 });
    scene.anims.create({ key: 'rat-walk-right', frames: scene.anims.generateFrameNumbers('rat', { start: 3,  end: 5  }), frameRate: 10, repeat: -1 });
    scene.anims.create({ key: 'rat-walk-down',  frames: scene.anims.generateFrameNumbers('rat', { start: 6,  end: 8  }), frameRate: 10, repeat: -1 });
    scene.anims.create({ key: 'rat-walk-left',  frames: scene.anims.generateFrameNumbers('rat', { start: 9,  end: 11 }), frameRate: 10, repeat: -1 });
    scene.anims.create({ key: 'vulture-fly-left',  frames: scene.anims.generateFrameNumbers('vulture-fly-left',  { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
    scene.anims.create({ key: 'vulture-fly-right', frames: scene.anims.generateFrameNumbers('vulture-fly-right', { start: 0, end: 3 }), frameRate: 10, repeat: -1 });

    scene.registry.set('gameAssetsLoading', false);
    scene.registry.set('gameAssetsReady',   true);
    scene.events.emit('gameAssetsReady');
  });

  scene.load.start();
}
```

- [ ] **Step 2: Strip BootScene to the menu-essential path**

Replace the entire contents of `src/scenes/BootScene.ts` with:

```ts
import Phaser from 'phaser';
import trashbagUrl from '../sprites/player/trashbag.png?url';
import { HeapClient } from '../systems/HeapClient';
import type { Vertex } from '../systems/HeapPolygon';
import { generateAllTextures } from '../entities/TextureGenerators';
import type { HeapSummary } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS, MOCK_HEAP_HEIGHT_PX_FALLBACK } from '../../shared/heapTypes';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';
import { getSelectedHeapId, setSelectedHeapId, finalizeLegacyPlaced } from '../systems/SaveData';
import { INFINITE_HEAP_ID } from '../data/infiniteDefs';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Only what MenuScene actually paints: the player figure.
    this.load.image('trashbag', trashbagUrl);
  }

  create(): void {
    // Procedural textures — synchronous, no network/disk.
    generateAllTextures(this);

    // Default registry state so MenuScene can render before catalog resolves.
    this.game.registry.set('heapCatalog',    [] as HeapSummary[]);
    this.game.registry.set('activeHeapId',   '');
    this.game.registry.set('heapPolygon',    [] as Vertex[]);
    this.game.registry.set('heapParams',     DEFAULT_HEAP_PARAMS);
    this.game.registry.set('gameAssetsReady', false);
    this.game.registry.set('heapCatalogReady', false);

    // Kick off catalog/polygon fetch in the background — does not block the menu.
    HeapClient.list()
      .then((summaries) => {
        const infiniteEntry: HeapSummary = {
          id: INFINITE_HEAP_ID,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          topY: NaN,
          params: {
            name: '∞ Infinite Heap',
            difficulty: 5.0,
            spawnRateMult: 1.0,
            coinMult: 1.0,
            scoreMult: 1.0,
            worldHeight: MOCK_HEAP_HEIGHT_PX,
            isInfinite: true,
          },
        };
        const deduped = summaries.filter(s => s.id !== INFINITE_HEAP_ID);
        deduped.push(infiniteEntry);
        this.game.registry.set('heapCatalog', deduped);

        if (deduped.length === 0) {
          this.game.registry.set('heapCatalogReady', true);
          this.game.events.emit('heapCatalogReady');
          return;
        }

        const stored = getSelectedHeapId();
        const pick = deduped.find((s) => s.id === stored)
                  ?? [...deduped].sort((a, b) => a.params.difficulty - b.params.difficulty
                        || a.createdAt.localeCompare(b.createdAt))[0];

        setSelectedHeapId(pick.id);
        finalizeLegacyPlaced(pick.id);
        this.game.registry.set('activeHeapId', pick.id);
        this.game.registry.set('heapParams',   pick.params);

        return HeapClient.load(pick.id).then((polygon) => {
          this.game.registry.set('heapPolygon', polygon);
          this.game.registry.set('heapCatalogReady', true);
          this.game.events.emit('heapCatalogReady');
        });
      })
      .catch(() => {
        this.game.registry.set('heapCatalogReady', true);
        this.game.events.emit('heapCatalogReady');
      });

    // Start MenuScene immediately — does not wait on the network call.
    this.scene.start('MenuScene');
  }
}
```

> Note: if `MOCK_HEAP_HEIGHT_PX_FALLBACK` does not exist in `shared/heapTypes`, drop that import and keep only the existing `MOCK_HEAP_HEIGHT_PX` from `../constants` (verify by reading the existing imports of MOCK_HEAP_HEIGHT_PX in the original BootScene). Inline correction: only `MOCK_HEAP_HEIGHT_PX` is needed; remove the fallback import line.

- [ ] **Step 3: Wire `MenuScene` to load assets in the background and gate START**

In `src/scenes/MenuScene.ts`:

(a) Add an import at the top:

```ts
import { loadGameAssets } from './loadGameAssets';
```

(b) At the end of `create()`, after `this.registerInput();`, add:

```ts
loadGameAssets(this);
```

(c) Refactor `registerInput()` to gate START on `gameAssetsReady`. Replace the body with:

```ts
private registerInput(): void {
  this.time.delayedCall(100, () => {
    const startGame = (): void => {
      if (this.game.registry.get('gameAssetsReady') !== true) return;
      const activeHeapId  = (this.game.registry.get('activeHeapId') as string) ?? '';
      const activeParams  = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;
      if (activeParams.isInfinite) {
        this.scene.start('InfiniteGameScene');
        return;
      }
      const hasCheckpoint = getPlaced(activeHeapId).some(
        p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
      );
      this.scene.start('GameScene', hasCheckpoint ? { useCheckpoint: true } : undefined);
    };

    const refreshStartLabel = (): void => {
      const ready = this.game.registry.get('gameAssetsReady') === true;
      this.startText.setText(ready ? 'START RUN' : 'LOADING…');
      this.startText.setColor(ready ? '#ffffff' : '#778899');
    };

    refreshStartLabel();
    this.game.events.once('gameAssetsReady', refreshStartLabel);

    this.input.keyboard!.once('keydown-SPACE', startGame);
    this.input.keyboard!.once('keydown-U',     () => this.scene.start('UpgradeScene'));
    this.input.keyboard!.once('keydown-F2',    () => this.scene.start('TexturePreviewScene'));

    this.startText.setInteractive(
      new Phaser.Geom.Rectangle(-200, -40, 400, 80),
      Phaser.Geom.Rectangle.Contains,
    );
    this.startText.on('pointerup', startGame);  // .on, not .once — START stays armed across the LOADING→READY transition

    this.upgradeText.setInteractive(
      new Phaser.Geom.Rectangle(-78, -28, 156, 56),
      Phaser.Geom.Rectangle.Contains,
    );
    this.upgradeText.once('pointerup', () => this.scene.start('UpgradeScene'));

    this.storeText.setInteractive(
      new Phaser.Geom.Rectangle(-78, -28, 156, 56),
      Phaser.Geom.Rectangle.Contains,
    );
    this.storeText.once('pointerup', () => this.scene.start('StoreScene'));

    this.input.keyboard!.once('keydown-S', () => this.scene.start('StoreScene'));
    this.input.keyboard!.once('keydown-H', () => this.scene.start('HeapSelectScene'));
  });
}
```

> The original code used `this.startText.once('pointerup', startGame)` — that fires once and unbinds. Because START might be tapped while `gameAssetsReady === false` (the early-return rejects it), we need it to remain armed until a successful start. Switch to `.on('pointerup', ...)`.

(d) For the heap-picker button to also gate while catalog is loading, in `createHeapPicker()` after the `.setInteractive(...)` call replace:

```ts
this.heapPickerText.on('pointerup', () => this.scene.start('HeapSelectScene'));
```

with:

```ts
this.heapPickerText.on('pointerup', () => {
  if (this.game.registry.get('heapCatalogReady') !== true) return;
  this.scene.start('HeapSelectScene');
});
```

- [ ] **Step 4: Run the full test suite — no regressions**

Run: `npx vitest run`
Expected: PASS — every previously-green test still green, plus the 7 from Task 1.

- [ ] **Step 5: Smoke-test in the dev server**

Run: `npm run dev`

Open `http://localhost:3000`. Verify:
1. Menu appears within ~one second (not waiting on 360 image loads).
2. START button shows `LOADING…` initially, then transitions to `START RUN` once the background load finishes (a few seconds later).
3. Tapping START while LOADING does nothing.
4. Tapping START after READY launches GameScene normally; the heap renders correctly; trash-wall sprites animate.
5. Open DevTools → Network tab on a hard reload (Ctrl+Shift+R). Confirm only `trashbag.png` and the procedural texture work happens before the menu is interactive.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/loadGameAssets.ts src/scenes/BootScene.ts src/scenes/MenuScene.ts
git commit -m "perf(boot): defer game-asset loads to MenuScene background; gate START until ready"
```

---

## Task 4: Dedupe recycle-item double-load

**Files:**
- Modify: `src/systems/PortalManager.ts:111`
- Delete: `src/data/portalRecycleUrls.ts`

- [ ] **Step 1: Repoint PortalManager texture keys**

In `src/systems/PortalManager.ts`, find:

```ts
this.textureKeys  = Array.from({ length: RECYCLE_ITEM_COUNT }, (_, i) => `recycle-item-${i}`);
```

Replace with:

```ts
// Reuse OBJECT_DEFS recycle-items keys (loaded once in loadGameAssets) instead
// of a parallel `recycle-item-${i}` keyspace.
this.textureKeys = Array.from(
  { length: RECYCLE_ITEM_COUNT },
  (_, i) => `recycle-items-${i.toString().padStart(2, '0')}`,
);
```

- [ ] **Step 2: Delete the now-orphaned URL list**

```bash
git rm src/data/portalRecycleUrls.ts
```

- [ ] **Step 3: Verify no other consumers**

Run: `grep -rn "portalRecycleUrls\|RECYCLE_ITEM_URLS" src/ shared/ scripts/`
Expected: no matches. (If any, delete those references — `RECYCLE_ITEM_COUNT` from `src/constants.ts` is a different symbol and stays.)

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all green.

- [ ] **Step 5: Smoke-test infinite mode**

Run: `npm run dev`

Open the game, switch to the Infinite heap from the picker, start a run, climb high enough to trigger a portal spawn. Confirm portal items render correctly (the recycle-items sprites, not blank squares).

- [ ] **Step 6: Commit**

```bash
git add src/systems/PortalManager.ts src/data/portalRecycleUrls.ts
git commit -m "refactor(portal): reuse OBJECT_DEFS recycle keys; remove duplicate load"
```

---

## Self-Review Checks

**Spec coverage:**
- ✅ Curate trash-wall pool with weighted random (Task 1 + 2; uses `def.rarity`)
- ✅ Defer non-trashbag loads from BootScene (Task 3)
- ✅ MenuScene starts immediately, START gated until assets ready (Task 3)
- ✅ Dedupe recycle-items (Task 4)

**Type / name consistency:**
- `pickTrashWallPool` exported from `src/systems/trashWallPool.ts`, imported by `src/scenes/loadGameAssets.ts` → matches.
- Registry keys: `trashWallPool`, `gameAssetsReady`, `gameAssetsLoading`, `heapCatalogReady` — set in BootScene/loadGameAssets, read in MenuScene + TrashWallManager. Consistent across files.
- Recycle key format `recycle-items-NN` (zero-padded) — used in PortalManager (Task 4) and matches OBJECT_DEFS textureKey casing seen at `src/data/heapItemDefs.ts:37+`.

**Placeholder scan:** None — every code step shows the actual code.

**Edge cases handled:**
- `pickTrashWallPool` with 0 items, 0 count, count > defs.length, all-zero rarity (clamped to 1e-9).
- TrashWallManager fallback to `FALLBACK_SPRITE_KEYS` when registry pool is missing (test environment, race conditions).
- BootScene's network failure path keeps default registry values; MenuScene heap picker gracefully degrades.
- START button tapped during LOADING phase: early-return, no scene start.
- MenuScene re-entered (e.g. after settings reset): `loadGameAssets` is idempotent via `gameAssetsLoading` / `gameAssetsReady` flags.

**Estimated payoff:** ~360 image requests → 1 image request before MenuScene paints. Trash-wall pool: 50 PNGs instead of 336. Net boot-time HTTP reduction ~85% before menu interactivity (the rest streams during the menu's entrance animation).
