# Bug Reports — from player feedback
**Last updated:** 2026-07-11

## [P3] Launch lag — a few seconds of stutter on startup

- **ids:** 8  ·  **players affected:** 1
- **platform:** android  ·  **app version:** 0.2.12
- **what they said:** "Upon launching there's a subtle few seconds lag. I suspect
  the package loading in background might causing it"
- **assessment:** Startup performance — a few seconds of jank right after launch,
  player guesses background asset/package loading. Annoyance, not a blocker → P3.
  Worth profiling boot / deferring non-critical asset loads off the first frames.

## [P3] "Jump height 4 error" (vague)

- **ids:** 2  ·  **players affected:** 1
- **platform:** android  ·  **app version:** 0.2.9
- **what they said:** "Jump height 4 error"
- **assessment:** Cryptic — most likely refers to a jump-height salvage/upgrade at
  level 4 producing an error, but the message is too terse to act on directly.
  Kept as a low-priority breadcrumb; needs the reporter's session or a repeat report
  to promote. P3.

## Resolved

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
