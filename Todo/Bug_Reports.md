# Bug Reports — from player feedback
**Last updated:** 2026-07-11

## Resolved

### [P3] Launch lag — few seconds of stutter on startup → added a blocking loading screen

- **ids:** 8  ·  **players affected:** 1
- **platform:** android  ·  **app version:** 0.2.12
- **what they said:** "Upon launching there's a subtle few seconds lag. I suspect
  the package loading in background might causing it"
- **root cause:** No blocking loading screen gated `MenuScene`. `BootScene` started
  the menu immediately, and `MenuScene` lazy-loaded its own assets while already
  on-screen, painting against empty registry defaults until loads + the async
  heap-catalog fetch resolved — so the first seconds showed a partially-built menu
  hitching as assets streamed in.
- **fix:** New themed `LoadingScene` inserted between `BootScene` and
  `MenuScene`/`TutorialScene` (`src/scenes/LoadingScene.ts`). It runs `loadGameAssets`
  and blocks the menu until `gameAssetsReady`, so the menu now paints fully-built. The
  network heap-catalog fetch still resolves in the background (offline-safe; the menu
  already refreshes on `heapCatalogReady`), keeping the loader fast (min
  `MENU_LOADING_MIN_MS = 500` so the bar doesn't just flash). Themed to match
  `InfiniteLoadingOverlay` (earthy dirt + gold): the heap piles up as loading
  progresses with the trash-bag hero riding the crest. Reuses the tested
  `preloadProgress`/`preloadComplete` helpers.
- **status:** implemented on branch `claude/next-bug-report-k48fka` ([PR #100](https://github.com/cph5236/HeapGame/pull/100)).
  `npm run build` clean; full client test suite passes (906). Verified live in the
  browser via the dev server at 15% / 50% / 85% (heap grows from the bottom, bar
  readable in front). A dev-only `?dev=LoadingScene&params={"freeze":0.6}` hook was
  added to pose the transient scene for scene-preview. On-device smoke test still
  pending before merge.

### [P3] "Jump height 4 error" → fixed in commit `7fe0453` (level-4 upgrade freeze)

- **ids:** 2  ·  **players affected:** 1
- **platform:** android  ·  **app version:** 0.2.9
- **what they said:** "Jump height 4 error"
- **root cause:** The `jumpBoost` per-level lookup in `SaveData` was
  `[0, 70, 150, 240][jl]` — only 4 entries (indices 0–3). At Jump Height upgrade
  **level 4** the lookup returned `undefined`, which poisoned the jump-velocity math
  (`PLAYER_JUMP_VELOCITY - (undefined + …)` → NaN) and froze heap loading. Matches
  the report's "jump height 4" exactly.
- **fix:** commit [`7fe0453`](https://github.com/cph5236/HeapGame/commit/7fe0453)
  "Fix heap loading freeze when jump power upgrade reaches level 4+" — extended the
  array to all 9 levels (later re-tuned to `[0,25,35,45,55,60,65,70,75]`).
- **status:** fixed. v0.2.8 did not have the fix; it landed 2026-06-20 and shipped in
  **V0.2.10**. The 0.2.9 report falls right in that window; fixed in all current
  builds.

### [P2] Collision "gravity drag" degrades movement feel → won't fix (working as designed)

- **ids:** 7  ·  **players affected:** 1
- **platform:** android  ·  **app version:** 0.2.12  ·  *(reclassified from suggestion)*
- **what they said:** "that gravity drag caused by collision is working against the
  gameplay. If that gets fixed it would be a smooth experience I think."
- **root cause:** Not jump gravity — jumping while touching a wall is not slowed. The
  only collision-contact slowdown is the **wall-slide cap** (`Player.ts:545`,
  `WALL_SLIDE_SPEED = 80`): a *falling* player touching a wall has downward speed
  clamped to 80 px/s. That's what the player felt as "drag." (The floaty apex jump,
  `APEX_GRAVITY_FACTOR`, is unrelated and predates this report — shipped V0.2.6.)
- **resolution:** Won't fix. Wall-slide is a deliberate core-movement component —
  it's what makes wall-jumping and controlled descents work; removing/loosening it
  would break more than it helps. One qualitative report, no repro of an actual
  defect. Reopen only if multiple players report the slide feeling broken (not just
  unfamiliar).

### [P2] Can't land on top of Hoarders heap — teleported to the side → predates fix in PR #80

- **ids:** 5  ·  **players affected:** 1
- **platform:** android  ·  **app version:** 0.2.10
- **what they said:** "Can't land on top of horders heap, immediately get teleported
  to the side"
- **root cause:** Summit/flat-top of the heap was classified as a vertical wall
  (tops disabled → the depenetration overlap ejected the player sideways instead of
  letting them stand). Same exposed-summit collision family described in
  `HeapEdgeCollider.classifyRow`.
- **fix:** [PR #80](https://github.com/cph5236/HeapGame/pull/80) — "Fix flat plateau
  top misclassified as a vertical wall" (commit `5698350`): the topmost row of a band
  whose Y sits strictly below `bandTop` is treated as a standable exposed summit. The
  only collision/polygon change since v0.2.10.
- **status:** fixed. The report is app version **0.2.10**; the fix first shipped in
  **V0.2.13** (2026-06-29), so the report predates it. Re-verified live on the current
  build — player stands on the Hoarders spire top without being ejected (device
  screenshot). Not reopening: no repro on ≥0.2.13, and the collision classifier is
  high-risk to edit without cause.
  - *Note:* PR #80 only rescues the single topmost scanline / flat-top case; a heap
    with steep exposed flanks just under a narrow peak could still expose a thin-cap
    ejection band (reproducible against the pipeline). Left as a latent edge case —
    file a fresh report if it resurfaces on a specific heap.

### [P2] Infinite heap mode is laggy and crashes → fix in PR #98

- **ids:** 6  ·  **players affected:** 1
- **platform:** android  ·  **app version:** 0.2.10
- **what they said:** "Infinite heap laggy and vrashes" [sic]
- **root cause:** Same surface as the crash-log **[P2] `drawImage`-of-null in
  `updateUVs`** (see `Todo/Crash_Reports.md`). `InfiniteGameScene` never culled its
  baked canvas-texture chunks, so they accumulated until memory exhaustion nulled a
  live texture source (crash); the synchronous per-band canvas bake also hitched on
  every jump (lag).
- **fix:** [PR #98](https://github.com/cph5236/HeapGame/pull/98) — per-frame chunk
  culling + grounded-gated canvas bake.
- **status:** fixed on branch `fix/infinite-chunk-culling`, ready to merge (device
  playtest confirmed; temp diagnostic logging stripped).
