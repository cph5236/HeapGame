# Daily Drop — daily reward system

**Date:** 2026-07-16
**Status:** Approved design, pre-implementation
**Brainstorm artifact:** https://claude.ai/code/artifact/6ea8b8cd-66bd-4e2d-a6b4-ed9babe7441a

## Purpose

Give players a concrete reason to return every day. The reward fires after the
**first completed run of the day** (any run counts, however short) — never on
app-open — so it rewards playing, not launching. Rewards are coins and items
only, granted server-side through the existing reward plumbing.

## Player-facing design (decided)

### Reveal: trash-can pop
- After the first run of the day, a trash can appears on the menu, wiggling.
- Tap → lid pops open, coins/item burst out, reward chip shows amount + streak day.
- **Day 7:** same can, golden VFX (no wheel, no pick-a-bin).

### Entry points: icon + popup, both
- **Menu can icon** (small button, bottom corner of MenuScene):
  - *Locked* (no run yet today): visible; tapping previews the streak track and
    today's reward ("Finish a run to open").
  - *Ready* (run done, unclaimed): badge + wiggle; tapping opens the claim overlay.
  - *Claimed:* icon **disappears entirely** until the next eligible day — it must
    not linger visually once it has no job.
- **Auto-popup:** fires **once** when the player lands back on MenuScene after
  the first run of the day. **Dismissible** (close button / tap outside). If
  dismissed without claiming, the can icon stays as the claim path.
- **Offline:** no claim possible; icon shows an offline state. No local grants —
  server-authoritative only.

### Streak: repeating 7-day track
| Day | Reward | Item pool |
|-----|--------|-----------|
| 1 | 50 coins | — |
| 2 | 75 coins | — |
| 3 | 1 common item | `ladder` · `ibeam` · `checkpoint` (random) |
| 4 | 100 coins | — |
| 5 | 1 utility item | `shield` · `pogo` · `stall` · `adrenaline` (random) |
| 6 | 150 coins | — |
| 7 | **300 coins + `revive`** (guaranteed) | — |

Track wraps 7 → 1. All amounts and pools are **remote-config** defaults
(tunable without a release); the table above is the hardcoded fallback.

### Streak break + repair
- Streak survives if the new claim happens within **36 hours** of the previous
  claim (remote-config `daily_streak_grace_hours`, default 36).
- Past 36h the streak is *broken*: on the next claim the player is offered
  **streak repair via one rewarded ad** — watch the ad, streak continues as if
  no day was missed. Decline → reset to day 1.
- Repair is only offered on the **first claim after the break** (no retroactive
  repairs later).
- Ad verification matches the existing rewarded-2× flow's trust level
  (client-reported completion); no SSV in v1.

## What counts as "a day"

Different **local calendar day** for the player, with server guardrails —
pure-UTC days would make an East-coast 10 pm claim block the next afternoon's
claim, which feels wrong.

- Client sends its UTC offset in minutes with the claim; server clamps it to
  the valid range (−720 … +840).
- **Eligible** when the local calendar date (server `now` + claimed offset)
  differs from the local date of the last claim **and** at least
  `daily_min_gap_hours` (remote-config, default **10 h**) have elapsed since
  the last claim.
- The min-gap guardrail is what stops timezone-hopping from minting extra
  claims: no matter what offsets a client reports, it caps claims at ~2 per
  24 h, and honest players are never near it (a 10 pm → next-day-3 pm rhythm is
  a 17 h gap). Known edge: a legit 11:55 pm → 12:05 am claim pair is blocked
  until the gap passes — acceptable.
- Server stores the offset used at each claim alongside the timestamp for
  debuggability.

## Architecture

### Server (Cloudflare Worker, Hono + D1)
- **New route `POST /daily/claim`** — auth-gated with `X-Player-Token` (TOFU
  secret, same as scores/codes), keyed on the effective player id.
  - Request: `{ playerGuid, utcOffsetMin, resolution?: 'repair' | 'reset' }`
  - Success response: `{ rewards: RewardPayload[], streakDay, nextRewardPreview }`
    — an **array** because day 7 grants coins *and* an item.
  - Broken-streak response: `{ kind: 'streakBroken', repairableDay }` — no
    reward granted yet. Client shows the repair prompt, then re-calls with
    `resolution: 'repair'` (after the ad completes) to continue the streak, or
    `resolution: 'reset'` (player declined) to claim day 1. A `resolution` sent
    when the streak isn't broken is ignored.
  - Not-eligible response: `{ kind: 'notEligible', nextEligibleAt }`.
- **New route `GET /daily/status`** (auth-gated) — returns streak day, claimed
  today, next reward preview; drives the icon states and locked preview.
- **Storage:** new table in the **`heap_rewards`** D1 (migration `0002`, via
  the `adding-d1-migrations` skill):
  `daily_claims(player_id TEXT PRIMARY KEY, last_claim_at INTEGER, last_claim_offset_min INTEGER, streak_day INTEGER, total_claims INTEGER)`
  — one row per player, upserted on claim.
- **DB repo** follows the existing pattern: D1 + Mock (+ Cached if useful)
  variants.
- **Remote config keys** (existing config system): `daily_rewards` (7-entry
  JSON table), `daily_streak_grace_hours` (36), `daily_min_gap_hours` (10).
- Optional best-effort cross-check: a score submission exists for the current
  local day before honoring the claim. Nice-to-have, not a v1 gate (client
  already gates on run completion, and day/gap rules bound the damage).

### Shared (`shared/`)
- `shared/dailyDrop.ts` — pure logic, unit-tested, used by both sides:
  - local-date derivation from timestamp + offset (with clamping),
  - eligibility check (different local day + min gap),
  - streak advance / break / repair transitions,
  - reward-table lookup with pool RNG hook.
- Types in `shared/dailyTypes.ts` (`DailyClaimRequest`, `DailyClaimResponse`,
  reusing `RewardPayload` from `shared/codeTypes.ts`).

### Client (`src/`)
- **Extract `applyReward(payload)`** out of `CodeClient.ts` into a shared
  client helper — daily claims and code redemptions apply rewards through the
  identical `addBalance` / `addItem` path.
- **`DailyDropClient`** (`src/systems/`) — `fetchStatus()` + `claim()`,
  modeled on `CodeClient` (fetchWithLog, authHeaders, offline handling).
- **MenuScene additions:**
  - Can icon button with the three states above (state machine as pure logic in
    `src/ui/` alongside `hudLogic.ts`, so it's unit-testable).
  - Claim overlay: can sprite, lid tween, coin particle burst, reward chip,
    streak strip (7 chips), day-7 golden VFX variant.
  - Auto-popup trigger: on MenuScene create, if returning from a run and status
    says *ready* and not yet auto-shown today → open overlay once.
  - Repair prompt variant: "Streak broken — watch an ad to keep Day N" with
    decline → day 1 claim.
- **"First run" gate:** client-side — any run completion (death, success, or
  quit-to-menu from a started run) marks today as played (in-memory +
  SaveData meta), enabling the claim path.

## Error handling
- Offline / fetch failure → icon offline state, overlay shows "come back
  online"; claim never granted locally.
- 401/403 → `logIfAuthRejected` like other authed calls.
- Double-claim race (two devices) → D1 upsert is conditional on
  `last_claim_at`; loser gets `notEligible`.
- Unknown item id in config table → server falls back to coins for that day
  (never returns an invalid `rewardId`).

## Testing
- `shared/dailyDrop` unit tests: date derivation across offsets (incl. the
  east-coast 10 pm / 3 pm case), DST-agnostic offset handling, min-gap
  guardrail, streak advance/grace/break/repair, table wrap 7→1.
- Server route tests (Vitest, mock DB): eligibility matrix, broken-streak →
  repair flow, day-7 dual reward, auth rejection, offset clamping.
- Client: icon state-machine tests; overlay logic tests where pure.
- Manual: scene-preview for overlay layout; live smoke test of the full
  first-run → popup → claim loop before merge.

## Out of scope (v2 parking lot)
- Watch-ad-to-**double** the daily reward.
- Can cosmetic upgrades with lifetime streak (dented → clean → golden dumpster)
  — `total_claims` column already anticipates this.
- Long-streak cosmetic exclusives (28-day).
- Off-peak claim bonus synergy.
- Rewarded-ad SSV (server-side ad verification).
