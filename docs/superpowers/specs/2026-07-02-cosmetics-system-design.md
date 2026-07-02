# Cosmetics System — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstorm complete)
**Todo item:** Todo/Todo.md — "Cosmetics system"

## Summary

A character-customization system for Heap: players view and buy cosmetics with
coins in a new character editor (opened via a player-icon button on the main
menu), equip them across five slots, see them on their bag in-game, and show
them off as mini-avatars on the enlarged top-5 leaderboard rows. Ships
production-ready with 52 items across 5 categories, with a free tier in every
slot.

## Architecture (Approach A — client economy + synced loadout)

Purchases and ownership are **client-authoritative**, exactly like the existing
upgrades and consumables economy: coins (`balance`), owned cosmetics, and the
equipped loadout live in `SaveData` (localStorage + GPGS cloud-save merge).

The server stores **display data only**: the equipped loadout as a JSON blob
keyed by `playerGuid` in a new `player_customization` table in the
**`heap_scores`** D1 database, so the leaderboard endpoint enriches top rows
with a single-DB LEFT JOIN. The server validates that loadout ids are *real*
(exist in the shared catalog, match their slot) but never that they are
*owned* — cosmetic-only cheating is an accepted v1 trade-off.

## Item catalog (52 items, 5 slots)

Single source of truth split in two layers:

- `shared/cosmeticCatalog.ts` — `{ id, slot }` for every item. Imported by the
  worker for loadout validation and by the client.
- `src/data/cosmeticDefs.ts` — client-side registry adding `name`, `price`
  (0 = free), and a per-slot render spec.

| Slot | Count | Kind | Render spec |
|------|-------|------|-------------|
| `tie` | 12 colors | procedural | `{ color: number }` (+ animated hue-cycle flag for Rainbow) |
| `skin` | 8 tints | procedural | `{ tint: number }` |
| `hat` | ~14 | PNG | `{ textureKey, offsetX, offsetY }` |
| `face` | ~10 | PNG | `{ textureKey, offsetX, offsetY }` |
| `trail` | ~8 | procedural particles | emitter params |

**Item list:**

- **Tie** — free: Red (default), Blue, Green, Yellow. Paid (~250): Purple,
  Cyan, Black, Gold, Neon, Pink, Orange; Rainbow (animated, premium ~2000).
- **Skin** — free: Default. Paid (~500): 7 tints biased toward hues that read
  on the dark bag (frosty blue, toxic green, shadow, golden, etc.).
- **Hat** (~500–2500) — traffic cone, bottle cap, tin can, banana peel, party
  hat, crown, top hat, hard hat, propeller cap, wizard hat, cowboy hat, paper
  boat, beanie, fish skeleton.
- **Face** (~500–1000) — googly eyes, sunglasses, 3D glasses, monocle, eye
  patch, mustache, clown nose, heart glasses, ski goggles, sticker scar.
- **Trail** (~750–1500) — buzzing flies, stink lines, bubbles, sparkles, smoke
  puffs, coin glints, embers, rainbow streak.

Every slot also has an implicit "none" option (except tie/skin, which have a
free default). Prices are per-item numbers in the defs file — designer-tunable,
no code logic tied to tiers. Items are cheap to substitute if art-blocked.

## Save data (schema v5)

`RawSave` gains:

```ts
cosmeticsOwned:    string[];                        // free items implicitly owned
cosmeticsEquipped: Partial<Record<CosmeticSlot, string>>;
```

- v4 → v5 migration defaults both to empty (default bag).
- Cloud merge: **union** `cosmeticsOwned` (like upgrades); take the primary
  save's `cosmeticsEquipped`.
- Purchase flow mirrors `purchaseItem`: check price ≤ balance, deduct, add id
  to owned, persist.

## Rendering

### In-game player

New `PlayerCosmetics` class owning visual attachments, mirroring the existing
tie-string `Graphics` lifecycle in `PlayerAnimator`:

- **Hat/Face:** Phaser Images positioned at the def's px offset in bag-local
  space, synced on `POST_UPDATE` (same hook as the strings — no one-frame lag).
  They inherit the sprite's live `scaleX/scaleY/angle` each frame so they
  squash/stretch with the bag; offsets are multiplied by current scale.
- **Tie:** `PlayerAnimator.drawStrings()` reads the equipped tie color instead
  of hardcoded `0xFF0000`; Rainbow cycles hue over time in the same draw call.
- **Skin:** `sprite.setTint(def.tint)` at spawn.
- **Trail:** one particle emitter configured from def params, using tiny
  procedural textures generated once (à la `TextureGenerators.ts`). Follows the
  sprite, emits only while moving; torn down on the `justDied`/`frozen` path
  with the animator.

Performance guardrails: max 2 Images + 1 emitter added; no per-frame allocation;
leaderboard avatars are static.

**Outro:** `PlayerOutro` keeps its dedicated sprite; cosmetics hide during the
outro. **Tutorial:** same Player entity → cosmetics visible.

### Shared avatar compositor

`composeAvatar(scene, loadout, scale)` builds a static container (bag + tint +
hat + face + tie strings drawn once, no trail). Used by:

1. Character editor live preview (large; idle breathing + animated strings;
   tap → hop using existing launch keyframes; selected trail shown as gentle
   ambient emission).
2. ScoreScene / LeaderboardScene top-5 mini-avatars (~40–48 px tall).
3. The MenuScene editor button (mini avatar of your current loadout).

## Character editor (`CustomizationScene`)

Opened from a player-icon button on MenuScene (joins the existing button
cluster; layout adjusts). Structure follows `StoreScene`:

- **Top half:** live preview on a pedestal.
- **Slot tabs:** Hat · Face · Tie · Skin · Trail (settings-panel tab pattern).
- **Item grid:** "none"/default cell first; swatch circles for procedural
  items, thumbnails for PNG items. Cell states: **equipped** (accent border),
  **owned** (tap to equip), **locked** (price tag → confirm-purchase dialog,
  store pattern; standard "not enough coins" feedback).
- **Coin balance** pinned top-right (StoreScene widget).
- Equip/purchase applies instantly to preview + SaveData; a debounced (~2 s)
  `PUT /customization/:playerId` syncs the equipped loadout, with a final flush
  on scene shutdown.

Not in v1: purchase-undo, item rotation/shop-of-the-day, rarity UI.

## Server & DB

### Migration

`server/migrations/heap_scores/0002_player_customization.sql` (+ update
`server/schema/heap_scores.sql`):

```sql
CREATE TABLE IF NOT EXISTS player_customization (
  player_id  TEXT NOT NULL PRIMARY KEY,
  loadout    TEXT NOT NULL,   -- JSON: {"hat":"hat_cone","tie":"tie_gold",...}
  updated_at TEXT NOT NULL
);
```

### Routes (`server/src/routes/customization.ts`)

- `PUT /customization/:playerId` — upsert. Validation against
  `shared/cosmeticCatalog.ts`: keys must be known slots, ids must exist and
  belong to that slot, unknown keys rejected, malformed/oversized body → 400
  (config-route hardening standard). Stored re-serialized (never raw input).
  Existing write-tier rate limit.
- `GET /customization/:playerId` — returns loadout (debug/admin; client's own
  state lives in its save).

### Leaderboard enrichment

- `getTopScores` gains `LEFT JOIN player_customization` (same DB).
- `LeaderboardEntry` (shared/scoreTypes.ts) gains optional `loadout`.
- Server parses/validates the blob before returning.
- Loadout changes surface on leaderboards after existing KV cache TTL —
  accepted staleness; no new invalidation paths.

### ScoreScene top-5 rows

Ranks 1–5 render ~1.4× taller with a mini-avatar left of the name; ranks 6+
unchanged; missing loadout → default bag avatar. Row-height/layout math goes in
the pure `scoreLayout.ts` helpers (unit-testable).

## Art pipeline (24 PNGs: hats + face)

Sourcing priority:

1. **CC0 packs** — Kenney.nl (CC0) and OpenGameArt CC0 filter; restyle to match
   the trashbag (recolor toward its slightly-desaturated palette, add its dark
   outline). Shortlist per item during implementation.
2. **Authored batch** for trash-specific gaps (banana peel, fish skeleton,
   bottle cap …) using the same workflow that produced `trashbag.png`, from
   exact per-item specs.
3. Art-blocked items ship procedural-fallback or get swapped for an easier
   concept.

Technical spec:

- Source PNGs at the trashbag's resolution ratio (~4.3× logical): hats
  ~120–170 px wide, face items ~60–120 px, transparent RGBA.
- Location: `src/sprites/cosmetics/hats/*.png`, `src/sprites/cosmetics/face/*.png`;
  loaded in `loadGameAssets` (no atlas needed at 24 small images).
- Anchoring convention: hats anchor bottom-center at the bag's top edge; face
  items anchor center in the bag's upper third; per-item `offsetX/offsetY`
  fine-tuned with the `scene-preview` tool.
- **Licensing:** CC0-only; per-file origin recorded in
  `src/sprites/cosmetics/SOURCES.md`.

## Testing

- **Catalog integrity:** unique ids, valid slots, every PNG item's texture key
  resolves, free tier present per slot, prices ≥ 0.
- **SaveData:** v4 → v5 migration; cloud-merge union of owned / primary's
  equipped; purchase deduct/insufficient-funds paths.
- **Server:** PUT validation (bad slot, bad id, wrong-slot id, unknown key,
  oversized/malformed body → 400), upsert semantics, GET, leaderboard JOIN
  enrichment incl. null-loadout rows.
- **Layout:** `scoreLayout` row-height math for enlarged top-5.
- **Client logic:** loadout → render-spec resolution (pure).
- **Visual:** scene-preview screenshots of editor + enlarged top-5 at phone
  size; manual smoke of in-game hat squash/stretch through jump/land.

## Rollout

- One feature branch + PR (`feature/cosmetics-system`).
- Migration applied `--local` during dev; remote via the existing
  `migrate-d1.yml` workflow at merge.
- Offline-safe: failed loadout PUTs are dropped and re-sent on the next equip
  change or next session start.
- Remove the Cosmetics item from `Todo/Todo.md` when shipped.
