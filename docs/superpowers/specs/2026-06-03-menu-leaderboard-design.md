# Leaderboard from the Main Menu — Design

**Date:** 2026-06-03
**Branch:** `feat/menu-leaderboard`
**Playtest item:** #2 from `Todo/Todo_Playtest_Feedback.md` (2026-06-01 feedback) —
"Leaderboards visible from the main menu."

## Problem & framing

The leaderboard is not missing — it is buried. `src/scenes/LeaderboardScene.ts`
is a fully built modal (paging at 50/page, "jump to my score", scroll, retry) and
is already launched as a paused overlay from `HeapSelectScene`
(`scene.launch('LeaderboardScene', {heapId, heapName, playerId})` + `scene.pause()`,
also bound to the `R` key). The only way to reach it today is: Menu → Heap selector
→ tap a heap.

The feedback asks to surface this existing screen **directly from the main menu**.
So this is a small entry-point + one shared-code fix, not a new feature.

## Scope (decided)

The menu entry opens the existing `LeaderboardScene` for the **currently active
heap** (the one shown in the menu's heap picker). Browsing other heaps' boards
stays the job of the heap selector. No all-heaps hub from the menu (YAGNI).

## UI / layout (decided)

Reuse the existing heap-picker row in `MenuScene` rather than adding a new row, so
no vertical space is consumed and the control sits beside the "what am I playing"
picker.

- Split the 320px row ≈85% / ≈15% with an 8px gap: heap-picker bar → ~264px
  (≈82.5% of the row; ≈85% of the non-gap width), keeping its styling, contents,
  and tap target (→ `HeapSelectScene`).
- 8px gap, then a **48×48 square** trophy button (48px ≈ 15% of the row) at the
  right end, styled to match the picker bar (dark fill, `0x8899bb` stroke) with a
  `🏆` glyph centred. (48px square also matches the row's 48px height.)
- Both elements fade in together in the existing entrance tween.
- Both are gated "disabled" (greyed, no-op) until `heapCatalogReady` fires — the
  picker already does this; the trophy follows the same gate.

Total row width and left edge stay aligned with `START RUN` / the `UPGRADES|STORE`
row (still 320px spanning `w/2 − 160` … `w/2 + 160`). The short-screen `layoutShift`
already applied to the picker row applies unchanged.

## Behavior

- Tapping the trophy (when catalog is ready):
  `scene.launch('LeaderboardScene', { heapId, heapName, playerId, returnScene: 'MenuScene' })`
  then `scene.pause()` — the same overlay pattern `HeapSelectScene` uses.
  - `heapId`   = `registry.get('activeHeapId')`
  - `heapName` = `registry.get('heapParams').name`
  - `playerId` = `getPlayerGuid()`
- A keyboard shortcut `L` mirrors the tap (menu already uses single-key shortcuts:
  Space/U/S/H). Add `L: Leaderboard` to the desktop hotkey legend.

## The one shared-code change

`LeaderboardScene.closeModal()` currently hardcodes
`this.scene.resume('HeapSelectScene')`. Generalise it:

- Add an optional `returnScene?: string` to `LeaderboardSceneData`.
- `init()` stores `this.returnScene = data.returnScene ?? 'HeapSelectScene'`
  (default preserves existing `HeapSelectScene` call sites with no change there).
- `closeModal()` resumes `this.returnScene` instead of the literal.
- `MenuScene` passes `returnScene: 'MenuScene'`. `HeapSelectScene` may pass
  `'HeapSelectScene'` explicitly for clarity, but the default already covers it.

## Edge cases

- **Catalog not ready:** trophy disabled (greyed) and no-op, matching the picker.
- **Offline / fetch failure:** handled by the scene's existing "tap to retry".
- **No scores yet for the heap:** the scene's existing loading/empty state shows.
- **Active heap is the infinite heap or otherwise board-less:** opens whatever the
  board returns for that `heapId`; the retry/empty states cover a missing board.
  (No special-casing — infinite-mode boards are out of scope for this change.)

## Components touched

| File | Change |
|------|--------|
| `src/scenes/MenuScene.ts` | Shrink picker bar to ~82%; add 48×48 trophy button + its hit zone, entrance tween, `heapCatalogReady` gate, launch handler, `L` hotkey, legend entry. |
| `src/scenes/LeaderboardScene.ts` | Add `returnScene` to `LeaderboardSceneData`; store in `init()`; resume it in `closeModal()`. |
| `src/scenes/HeapSelectScene.ts` | (Optional) pass `returnScene: 'HeapSelectScene'` explicitly. Behaviour unchanged via default. |

## Testing

- The leaderboard data path is already covered by `ScoreClient` tests; the new
  surface is thin Phaser wiring.
- Verify with `npm run build` (TS) + a `scene-preview` screenshot of the new menu
  row, plus a device tap to confirm launch + return-to-menu.
- Add a focused unit test only if the `returnScene` defaulting merits it
  (it is trivial; likely not worth a test).

## Out of scope

- All-heaps leaderboard hub from the menu.
- Any change to the leaderboard's contents, paging, or data model.
- Infinite-mode leaderboards.
