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


1. Your hook is the marketing, and you're not using it. Heap is a community-built pile — everyone who plays adds to the same heap. That's genuinely novel and inherently postable: "3,000 people have thrown trash on this pile and it's now 40km tall." That's a screenshot, a weekly tweet, a Reddit title, and a store-listing line. Right now it's a mechanic, not a story. This is the single biggest unexploited asset you have.

2. Communities where the players already are. r/AndroidGaming, r/playmygame, r/WebGames, r/IndieGaming. One post that lands does 1k–10k visits — more than your $300 buys. Needs a good 10-second clip, not a text post. Free, repeatable, and your web build means zero-friction trial.

3. Rename in-game currency "coins" -> "Scrap" (UI strings only).
The Play Console launch event ("Grand Opening: Founder's Scrap Drop", see
assets/play-event/README.md) advertises the reward as Scrap, but the game still
says "coins" in StoreScene, UpgradeScene, applyReward and the HUD. Until this is
done the store event and the app disagree. Marketing-only naming was a deliberate
call to ship the event first; the sweep is a UI-string change, not a data change.



4. Referral arrival counter — the receiving end of the share loop.
Shared links already carry `?ref=run` (SHARE_URL in src/systems/shareRun.ts) and
public/play.html forwards it through the browser door, so the marker reaches the
game today. Nothing reads it yet, on purpose.

Only the browser door forwards it — the Android door on that page is a static
Play Store link and never gets `?ref=`. Play Store attribution needs its own
`&referrer=` param, not a generic query string, so this isn't a one-line fix,
and it costs nothing today since nothing reads `ref` yet either way. Revisit
alongside whatever reads the marker: half of arrivals from a shared link are
structurally unattributable until the Android side gets its own mechanism.

The obvious implementation — a `visit:referred` event through RemoteLogger — was
built and then pulled back out of the share PR, because it does not work where it
matters. `RemoteLogger.event()` returns early unless the player has enabled
"Send anonymous gameplay analytics", which is off on every fresh save, and a
first-touch arrival happens on that player's very first boot. The event is
dropped while the one-shot `heap_ref` marker is spent, so the arrival can never
be counted afterwards, even if they opt in minutes later. It would have measured
close to nothing for new installs, which is the entire audience it exists for.

Second problem, unfixed by any gating change: `share:run` is emitted by an
established player who has had time to opt in, `visit:referred` by a brand-new
one who has not. Both pass the same consent gate with very different opt-in
rates, so shares-per-arrival measures opt-in propensity as much as sharing.

Preferred shape: a genuinely anonymous counter — POST `{ ref }` and nothing else,
no userGuid, no userAgent, on its own route rather than the log pipeline. Then it
needs no consent argument, because there is nothing personal in it, and the
settings copy ("Send anonymous gameplay analytics", "Errors are always reported")
stays true as written. Note that copy and PRIVACY_POLICY.md have to move together
if the alternative — exempting the event from the gate — is ever chosen instead.

### UI


### ENEMIES

### PERF — from load testing (2026-07-26)

### Stretch goals 
-finish todo_inprogress
