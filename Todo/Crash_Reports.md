# Crash Reports — from production logs
**Last updated:** 2026-07-10

Triaged from the `heap_logs` Analytics Engine dataset via the `fetch-logs` Action.
Each entry lists its source session(s) + event time (UTC) as the audit trail.

## [P3] HTTP 500 burst across multiple worker endpoints — 2026-07-03 backend incident

- **occurrences:** 4  ·  **players affected:** 2  ·  **sessions:** 2
- **first seen:** 2026-07-03 16:47:49  ·  **last seen:** 2026-07-03 18:13:33
- **platform:** web (2), android (2)  ·  **app version:** 0.2.14 (4)
- **message:** `Internal Server Error` (status 500)
- **endpoints:** `/heaps`, `/config`, `/heaps/{guid}/enemy-params` — all 500ing
  within the same seconds
- **sample:** session `cad64a19-f0ca-4044-9203-5c345df2a9f3` @ 2026-07-03 18:13:33
- **assessment:** Two unrelated players hit 500s across *several unrelated*
  endpoints simultaneously in two short windows on one day (16:47 and 18:13). A
  single buggy handler wouldn't take down `/config`, `/heaps`, and `/enemy-params`
  at once — this reads as a **transient worker/D1 incident** (bad deploy or DB
  hiccup) rather than a code path. Filed as low so it can be cross-checked against
  worker deploy history for 2026-07-03; no action if that window is explained.

---

## Resolved

### [P2] TypeError: Cannot read properties of null (reading 'drawImage') — Phaser updateUVs / canvas texture → fix in PR #98

- **occurrences:** 8  ·  **players affected:** 1  ·  **sessions:** 3
- **first seen:** 2026-07-02 17:12:28  ·  **last seen:** 2026-07-03 22:26:25
- **platform:** android (8)  ·  **app version:** 0.2.14 (8)
- **message:** `Cannot read properties of null (reading 'drawImage')`
- **top frame:** `initialize.updateUVs (phaser-*.js:5337)` → `setCutPosition` → `drawImage`
- **sample:** session `f72cefa8-7b8a-47f7-b8ac-b21fcda125fe` @ 2026-07-03 22:26:25
- **root cause:** `InfiniteGameScene` never called `cullChunks` (the finite
  `GameScene` does), so every baked 500px band's canvas texture stayed resident.
  Over a long climb they accumulated until memory exhaustion GC'd a texture source
  out from under a still-referenced `Image` → Phaser drew a `null` source. Not a
  device context-loss issue as originally guessed — a missing-cull leak.
- **fix:** [PR #98](https://github.com/cph5236/HeapGame/pull/98) — per-frame chunk
  culling in Infinite mode (+ grounded-gated bake for the associated lag). Verified
  live: culling drove `liveChunks` from an unbounded climb to a ~51 plateau.
- **status:** fixed on branch `fix/infinite-chunk-culling`, ready to merge (device
  playtest confirmed; temp diagnostic logging stripped).

### Discarded as noise this run
- **`fetch failed` — NetworkError when attempting to fetch resource** (4 occ, 1
  player, web, 0.2.11/0.2.15). Client-side `NetworkError` on `/heaps` — transient
  connectivity for a single user; not actionable.

### Closed, no action — 2026-07-10 follow-up
- **`ReferenceError: getCustomizeHintSeen is not defined`** (1 occ, 1 player, web,
  0.2.14, first/last seen 2026-07-07 01:19:19, session
  `539be2ed-6cbf-48f3-9ca0-633e453d016f`). Original assessment guessed a PWA
  service-worker chunk-hash split-brain between `MenuScene` and `SaveData`.
  Investigated further: **the project has no service worker/PWA plugin at all**,
  and `vite.config.ts` only splits `phaser` into its own chunk — `MenuScene` and
  `SaveData` are always compiled into the same JS file, so the two modules can't
  desync from each other within one build. The site deploys to **GitHub Pages**
  (Fastly CDN), which offers no custom cache-control headers to tune. The
  remaining plausible cause is a brief edge-cache propagation race at the exact
  deploy boundary — outside app-code control, not reproducible, single
  occurrence. Decision: no fix, no action. Re-open if this signature recurs.
