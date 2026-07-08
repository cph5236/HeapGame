# Crash Reports — from production logs
**Last updated:** 2026-07-07

Triaged from the `heap_logs` Analytics Engine dataset via the `fetch-logs` Action.
Each entry lists its source session(s) + event time (UTC) as the audit trail.

## [P2] TypeError: Cannot read properties of null (reading 'drawImage') — Phaser updateUVs / canvas texture

- **occurrences:** 8  ·  **players affected:** 1  ·  **sessions:** 3
- **first seen:** 2026-07-02 17:12:28  ·  **last seen:** 2026-07-03 22:26:25
- **platform:** android (8)  ·  **app version:** 0.2.14 (8)
- **message:** `Cannot read properties of null (reading 'drawImage')`
- **top frame:** `initialize.updateUVs (phaser-*.js:5337)` → `setCutPosition` → `drawImage`
- **sample:** session `f72cefa8-7b8a-47f7-b8ac-b21fcda125fe` @ 2026-07-03 22:26:25
- **assessment:** Phaser is drawing a frame whose backing canvas/texture source is
  `null`. The game leans heavily on canvas2d `CanvasTexture` sources
  (`HeapChunkRenderer`), so this is most likely a canvas texture that was destroyed
  or failed to allocate (WebGL/canvas context loss on this Android device) while a
  sprite still references it. Single player but persistent — recurs 8× across 3
  sessions → hard, reproducible on that device. Guard canvas-texture source before
  draw / handle context-loss re-creation. P2 (single-player reach caps it below P1).

## [P3] ReferenceError: getCustomizeHintSeen is not defined — deploy-boundary stale chunk

- **occurrences:** 1  ·  **players affected:** 1  ·  **sessions:** 1
- **first seen:** 2026-07-07 01:19:19  ·  **last seen:** 2026-07-07 01:19:19
- **platform:** web (1)  ·  **app version:** 0.2.14 (1)
- **message:** `ReferenceError: getCustomizeHintSeen is not defined`
- **sample:** session `539be2ed-6cbf-48f3-9ca0-633e453d016f` @ 2026-07-07 01:19:19
- **assessment:** `getCustomizeHintSeen` was introduced in commit `d423f91` ("Add
  hint text to main menu"), which shipped in **0.2.15** — it does not exist in
  0.2.14. The crash came from a client reporting **0.2.14** ~4h after that commit
  landed (committed 2026-07-06 21:35), so this is a **PWA stale-chunk split-brain**:
  a new `MenuScene` chunk that calls the function was served against a cached
  `SaveData` chunk that never exported it. The symbol is present in current code
  (0.2.16) so this exact instance is resolved, but the underlying cache-versioning
  gap **recurs on every release** and can brick the menu for players mid-update.
  P3 — worth confirming the service-worker / chunk-hash cache-busting strategy.

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

### Discarded as noise this run
- **`fetch failed` — NetworkError when attempting to fetch resource** (4 occ, 1
  player, web, 0.2.11/0.2.15). Client-side `NetworkError` on `/heaps` — transient
  connectivity for a single user; not actionable.
