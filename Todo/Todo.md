## FEATURES

- Play Integrity API
Deferred 2026-08-12 — see docs/superpowers/specs/2026-08-12-run-session-tokens-design.md
Integrity only verifies the Play-installed Android build, but web and itch.io are
first-class platforms, so an attacker who fails it just uses the web build and is
indistinguishable from a legitimate web player. It closes APK modification while
leaving the cheapest attack (a single curl to /scores) untouched. Run-session
tokens were built instead — platform-agnostic, and they close the actual hole.
Revisit only if a verified-Android leaderboard tier becomes a product goal.

- The claw elevator.

Language detection?

- admin player ban abilities 
### UI

- ~~Handle GPGS sign-in settling on the main menu~~ DONE — src/systems/gpgsSession.ts
Sign-in now settles once, in LoadingScene, before the menu is reachable, and the
decision is final for the app session: if it hasn't landed by
GPGS_SIGNIN_TIMEOUT_MS (6s) it is never adopted later, so nothing can flip the
effective id mid-run. Gating in LoadingScene rather than on the menu's PLAY
button was the key call — MenuScene.setupDailyDrop() was already firing
fetchDailyStatus() under the GUID on every cold launch, so the score race was
only the narrowest instance of a general orphaning bug.
Follow-ups worth watching:
  - Residual orphans stay orphaned. Players who declined sign-in, or whose
    session hit the 6s ceiling, keep writing under the GUID with no path back.
    There is still no server-side player-id migration, by choice.
  - If the GPGS plugin hangs rather than rejecting when a player has previously
    declined sign-in, those players would pay the full 6s on every launch.
    Verify on-device; if it's real, persist a "declined" flag and skip the wait.

### ENEMIES

### PERF — from load testing (2026-07-26)

### Stretch goals 
-finish todo_inprogress
