# Crash Reports — from production logs
**Last updated:** 2026-08-02

Triaged from the `heap_logs` Analytics Engine dataset via the `fetch-logs` Action.
Each entry lists its source session(s) + event time (UTC) as the audit trail.

## [P2] auth:rejected — one player 403-locked out of customization writes

- **occurrences:** 38  ·  **players affected:** 1  ·  **sessions:** 10
- **first seen:** 2026-07-13 14:56:57  ·  **last seen:** 2026-07-15 15:02:21
- **platform:** web (38)  ·  **app version:** 0.2.17 (34), 0.2.18 (4)
- **message:** `auth:rejected` — `{"route":"customization:put","status":403}`
- **sample:** session `a0f3b0d3-a6f7-4c71-b8e5-d69ae54fdf93` @ 2026-07-15 15:02:21
- **assessment:** A single player, retrying across 10 separate sessions over
  three days, rejected every time on the same route. That persistence is the
  signature of the known TOFU `playerSecret` lockout — a SaveData path that
  migrates or merges without carrying `playerSecret` leaves the player unable to
  authenticate against their own record (documented in CLAUDE.md). Reach is one
  player, but for that player it is total and self-healing is impossible from
  the client.
- **status:** no occurrences since 2026-07-15, and both affected versions predate
  the place-auth stack merged that same day (#103/#104/#105) — so this is
  plausibly already fixed. **Not confirmed.** Worth checking whether that
  `user_guid` still 403s before closing; if they do, they need a manual
  server-side secret reset since they cannot recover on their own.

## [P3] fetch failed — background client connectivity noise

- **occurrences:** 14  ·  **players affected:** 5  ·  **sessions:** 8
- **first seen:** 2026-07-08 14:32:23  ·  **last seen:** 2026-07-31 19:10:59
- **platform:** web (11), android (3)  ·  **app version:** spread across 0.2.17–0.2.24
- **message:** `Failed to fetch` / `NetworkError when attempting to fetch resource`
- **endpoints:** `/config` (5), `/heaps` (4), `/heaps/{guid}` (3),
  `/heaps/FFFFFFFF-…/enemy-params` (2 — the Infinite-mode sentinel, expected)
- **sample:** session `ms9bio7p-hwhsgh0o` @ 2026-07-31 19:10:59
- **assessment:** Failure durations are 9–257ms — far too fast to be timeouts, so
  these are clients losing connectivity rather than the worker failing. Spread
  thinly across 5 players, 4 app versions and three weeks: a low background rate,
  not an incident. This recurs the signature discarded on the 2026-07-10 run,
  now at wider reach (5 players vs 1), so it is filed rather than discarded to
  serve as a **baseline** — re-triage if the rate climbs or clusters on one
  endpoint.
- **no action.**

> **CORS tightening check (2026-08-02):** the allowlist came off `*` at
> 16:19 UTC (PR #137). Exactly one error was logged after that deploy — the P1
> velocity crash above — and zero fetch/CORS failures. No fallout.

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
  hiccup) rather than a code path.
- **2026-07-10 follow-up:** raw logs confirm both sessions are real player
  traffic, not test/dev noise — initially suspected the android session's
  `enemy-params` call against `FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF` was a dev
  poking at the API, but that GUID is the standard client-side sentinel every
  real player's client sends for Infinite mode (`BootScene.ts` /
  `infiniteDefs.ts`, shipped 2026-06-24), and the event timestamps (2026-07-03)
  postdate both that feature and the `V0.2.14` release commit (2026-06-29) by
  days — a live, in-window client, not a stale/pre-release build. The android
  session's call order (`/heaps` 500 first, then `enemy-params` 500 ~1s later)
  and the web session's simultaneous `/config` + `/heaps` 500s both point to a
  genuine D1/worker-side fault, not anything sentinel- or client-specific.
  Could not confirm against worker deploy history — worker deploys are manual
  (`wrangler deploy`, no CI record) and no deploy was confirmed for that window.
  **Status: keep as open P3, watch-only.** No code action identified; re-triage
  if this signature recurs or expands to more players.

---

## Resolved

### [P1] TypeError: reading 'velocity' of undefined — PlayerCosmetics.sync → fix in PR #140

- **occurrences:** 4  ·  **players affected:** 4  ·  **sessions:** 4
- **first seen:** 2026-07-15 20:56:48  ·  **last seen:** 2026-08-02 17:13:23
- **platform:** android (3), web (1)  ·  **app version:** 0.2.24 (1), 0.2.19 (1), 0.2.18 (2)
- **message:** `Cannot read properties of undefined (reading 'velocity')` (V8) /
  `undefined is not an object (evaluating 'r.velocity')` (WebKit) — same bug,
  the two engines word it differently, so it only clusters once the wording is
  normalised away
- **top frame:** `PlayerCosmetics.sync` ← Phaser `Systems.step` (POST_UPDATE emit)
- **sample:** session `fbdedcfb-6bf3-4175-b40e-d2277ea1238e` @ 2026-08-02 17:13:23
- **root cause:** a **leaked POST_UPDATE listener**, not merely a missing null
  check. The initial triage assessment ("add `if (!body) return;`") described the
  symptom; the actual chain is:
  1. `PlayerCosmetics`' constructor subscribes `sync` to `POST_UPDATE`, and only
     `destroy()` unsubscribes.
  2. `destroy()` is called from `GameScene.shutdown()` / `InfiniteGameScene`
     `.shutdown()` / `TutorialScene.shutdown()` — but **Phaser never invokes a
     Scene's `shutdown()` method.** It auto-calls only `init`/`preload`/`create`/
     `update`; `shutdown` has to be wired to the SHUTDOWN event by hand, and none
     of the three scenes does. Verified: no reference to a scene's `shutdown`
     method exists anywhere in `node_modules/phaser/src`. Those methods are dead
     code.
  3. `Systems.shutdown()` emits SHUTDOWN but does **not** `removeAllListeners()`
     (only `Systems.destroy()` does), so the listener survives the scene stopping.
  4. Phaser's `DisplayList.shutdown` destroys the scene's children, and
     `GameObject.destroy()` sets `this.body = undefined`
     (`gameobjects/GameObject.js:919`) — note *undefined*, which is exactly the
     wording both engines reported.
  5. On the scene's **next** start the stale listener fires against that
     destroyed sprite → `body.velocity` throws.
- **why it was rare:** the normal death/success paths call `playerCosmetics.hide()`,
  and `sync()` early-returns on the `hidden` flag, so the stale listener is inert.
  It only crashes when the player leaves a run *without* dying — e.g. Pause →
  quit (`PauseScene.ts:153-155`) — and then starts that scene again.
- **fix:** PR #140 — `PlayerCosmetics` and `PlayerAnimator` now own their teardown
  via `scene.events.once(SHUTDOWN, this.destroy, this)`, `destroy()` is idempotent
  and also unhooks the SHUTDOWN handler, and `sync()` keeps a defensive
  `if (!body) return;` for any other body-removal path. `PlayerAnimator.destroy()`
  needed `this.sprite.body?.setSize(...)` — it would otherwise have thrown the
  same way on the SHUTDOWN path. 7 regression tests in
  `src/entities/__tests__/PlayerCosmetics.test.ts` (3 fail against the old code).
- **follow-up (not in PR #140):** the three dead `shutdown()` methods are still
  dead. Everything else in them is currently a no-op too — `AudioManager.stopAll()`
  (masked, because `AudioManager.play()` stops the previous music track itself),
  `playerOutro.destroy()`, the `InputManager` suppression-rect reset, the joystick
  destroy, and `InfiniteGameScene`'s `physics.world.resume()` /
  `loadingOverlay.destroy()`. Wiring them up is a behaviour change (audio would
  now be cut on scene exit) and wants its own PR + smoke test.

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
