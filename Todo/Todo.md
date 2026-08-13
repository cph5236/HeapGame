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

- Handle GPGS sign-in settling on the main menu
Sign-in is fired fire-and-forget from BootScene, so it can resolve at any point —
including after a run has already started. `getEffectivePlayerId()` is
`getGpgsPlayerId() ?? getPlayerGuid()`, so a late sign-in flips the player's
effective id mid-run. The run-session token is bound to the id read at run start
(see docs/superpowers/specs/2026-08-12-run-session-tokens-design.md), so the
submit then fails server-side as `session-mismatch` and the score is silently
lost with a 400. Android-only; known and accepted as of PR #148, commented in
src/systems/RunSession.ts.
Two candidate fixes:
  a) Show a "signing in…" loader where the username sits on the main menu and
     block PLAY until sign-in settles. Guarantees a stable id before any run,
     but adds a startup gate on a network call — needs a timeout/fallback so a
     slow or failed sign-in can't strand the player on the menu.
  b) Freeze the effective id for the session: whatever it is when the run starts
     is what the run uses, and a late sign-in only takes effect from the next
     run. No UI work, no startup gate, but that run's score lands under the GUID
     rather than the player's GPGS profile.
Worth deciding alongside any other work that depends on identity stability.

### ENEMIES

### PERF — from load testing (2026-07-26)

### Stretch goals 
-finish todo_inprogress
