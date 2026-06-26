# Crash Reports — from production logs
**Last updated:** 2026-06-26

Triaged from the `heap_logs` Analytics Engine dataset via the `fetch-logs` Action.
Each entry lists its source session(s) + event time (UTC) as the audit trail.

## [P1] Error: PlayerOutro: play() called while already playing

- **occurrences:** 2  ·  **players affected:** 2  ·  **sessions:** 2
- **first seen:** 2026-06-25 02:47:17 UTC  ·  **last seen:** 2026-06-25 14:55:56 UTC
- **platform:** android (2)  ·  **app version:** 0.2.10
- **message:** `Uncaught Error: PlayerOutro: play() called while already playing`
- **sources:**
  - session `8c9b9ae9-…-f1a746e2856d` (user `5b024b4e…`) @ 2026-06-25 14:55:56 — via `rn.onKill` → `rn.update` → `Cm.update`
  - session `ccbca646-…-7c77930c277b` (user `b490e96e…`) @ 2026-06-25 02:47:17 — via `initialize.callback` (timer/event)
- **top frame:** `_s.play (assets/index-BKk3wW3h.js:8:30871)`
- **assessment:** `PlayerOutro.play()` throws explicitly when re-entered while the
  outro is already playing — so the death/kill path is firing `play()` more than
  once. Two distinct entry paths reach it (an `onKill` update tick and a deferred
  callback), suggesting a missing "already playing / already-dead" guard rather
  than one specific caller. Crash on the death sequence, ≥2 players on current
  version → **P1**.

## [P2] TypeError: Cannot read properties of null (reading 'drawImage')

- **occurrences:** 1  ·  **players affected:** 1  ·  **sessions:** 1
- **first seen:** 2026-06-25 02:39:46 UTC  ·  **last seen:** 2026-06-25 02:39:46 UTC
- **platform:** android (1)  ·  **app version:** 0.2.10
- **message:** `Cannot read properties of null (reading 'drawImage')`
- **sources:** session `ccbca646-…-7c77930c277b` (user `b490e96e…`) @ 2026-06-25 02:39:46
- **top frame:** `updateUVs (assets/phaser-Czz4FBZH.js:5337:2993)` ← `setCutPosition`
  ← `setSize` ← `updateText` ← `setColor` ← `P1.refreshYouStats (index-BKk3wW3h.js:8:11507)`
- **assessment:** A Phaser `Text` object's texture/canvas is null when
  `refreshYouStats()` updates it (`setColor` → `updateText` → `updateUVs` on a
  destroyed or not-yet-initialized text frame). Single reporter so far → **P2**,
  but watch for recurrence. Note: same user/session hit the P1 above ~8 min later
  — the two may be related to the same end-of-run teardown.
