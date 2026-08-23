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

- Score/Seed integrety - Every run uses a seed to spawn the enemies the server could run that seed back and they should get the same amount of pickups and enemies. this would clamp the Score possible for that run to the maximum that could possibly be achieved. 

## Marketing 

-Localized Store Listings 

1. Your hook is the marketing, and you're not using it. Heap is a community-built pile — everyone who plays adds to the same heap. That's genuinely novel and inherently postable: "3,000 people have thrown trash on this pile and it's now 40km tall." That's a screenshot, a weekly tweet, a Reddit title, and a store-listing line. Right now it's a mechanic, not a story. This is the single biggest unexploited asset you have.

2. Communities where the players already are. r/AndroidGaming, r/playmygame, r/WebGames, r/IndieGaming. One post that lands does 1k–10k visits — more than your $300 buys. Needs a good 10-second clip, not a text post. Free, repeatable, and your web build means zero-friction trial.


### UI


### ENEMIES

### PERF — from load testing (2026-07-26)

### Stretch goals 
-finish todo_inprogress
