# Bug Reports — from player feedback
**Last updated:** 2026-07-07

## [P2] Can't land on top of Hoarders heap — teleported to the side

- **ids:** 5  ·  **players affected:** 1
- **platform:** android  ·  **app version:** 0.2.10
- **what they said:** "Can't land on top of horders heap, immediately get teleported to the side"
- **assessment:** Landing on the summit of the "Hoarders" heap immediately
  depenetrates/teleports the player sideways instead of letting them stand. Smells
  like the flat-top / summit collision family (exposed-summit classification +
  overhang depenetration). Blocks reaching the top of a specific heap → progress
  blocker on that heap. P2; needs repro on Hoarders' top band.

## [P2] Collision "gravity drag" degrades movement feel

- **ids:** 7  ·  **players affected:** 1
- **platform:** android  ·  **app version:** 0.2.12  ·  *(reclassified from suggestion)*
- **what they said:** "that gravity drag caused by collision is working against the
  gameplay. If that gets fixed it would be a smooth experience I think."
- **assessment:** Reports collision-induced drag that fights player movement —
  behavior contradicting the intended "smooth" climb, so filed as a bug not a
  suggestion. Likely the wall/slope sliding + depenetration friction path. One
  qualitative report but names a core-feel defect; P2 pending repro of the drag.

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
