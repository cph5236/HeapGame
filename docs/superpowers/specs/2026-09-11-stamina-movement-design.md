# Stamina Movement System — Design

**Date:** 2026-09-11 (revised 2026-09-12 after design review)
**Branch:** `feature/stamina-movement`
**Status:** approved, ready for implementation planning

## Problem

Heap's air abilities are four independent resources with four unrelated refill
rules: air jumps are a counter that refills *instantly and completely* on ground
contact, wall jump is a 2s cooldown that a different wall side bypasses outright,
dash is an 800ms cooldown zeroed on landing, and dive is free and unlimited.

Two consequences follow. First, nothing competes: a player who owns everything
uses everything every airtime, so there is no decision to make in the air.
Second, two of the abilities — `dash` (600) and `wall_jump` (450) — are paywalls
on *understanding how to play*, not on power.

The redesign replaces the air-jump counter with a shared **stamina** pool modelled
on Deadlock, and moves dash, wall jump and dive to default-unlocked so the upgrade
tree sells power rather than access.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Resource shape | One shared pool, base **3**, hard cap 8 | ≥2 is required for spending to be a choice; 3 is Deadlock's modal value and affords *dash → air jump → wall jump* in one airtime |
| Cost per ability | Flat 1 for air jump / dash / wall jump; 0 for jump, dive, wall slide | Uniform integer costs keep the HUD free of fractional segments; the interesting variation lives in the limiters instead |
| Second gate | Each ability keeps its own limiter (per-airtime cap, cooldown) | Precedent: Deadlock's air dash is *also* double-gated (1 bar **and** one per airborne period) |
| Air-jump limiter | Per-airtime cap, N = 1 + `air_jump` level. **Grants no stamina** | Keeps the two upgrade paths orthogonal: `air_jump` buys *permission*, `max_stamina` buys *budget* |
| Grounded regen | 200ms per bar — fast, not instant | Turns ground contact into a *duration*: a 2-frame bunny-hop banks ~0.15 bars, a half-second pause on a ledge tops you up. This is the skill gradient the instant refill has none of |
| Airborne regen | 3000ms per bar, flat | Explicitly tune-in-playtest. Yields ~4 wall jumps from a full pool before forced recovery |
| Wall-jump base cooldown | **2000ms → 3000ms**, upgradeable to 1500ms | A deliberate nerf, not a restatement of current behaviour. Wall jump gains a stamina cost but keeps the different-side bypass, so the cooldown is what stops flat-face spam |
| Accumulator model | Stamina is a **float**, not per-bar timers | Partial progress is never lost, the regen function stays pure and testable, and the HUD's partial-fill segment is honest rather than decorative |
| Refund timing | **Post-merge reconciliation**, never inside `migrateGame` | A refund applied during migration lands before the cloud merge and gets double-credited by the `Math.max` balance rule. See *Migration* |
| Stale-client defence | Raise `min_version` at release | No client-side marker survives an old client's merge. The existing version gate removes the window rather than defending against it. See *Migration* |
| Announcement | In-build content, gated on `seenAnnouncements` | Copy that ships with the build cannot fail to load or render blank; `ConfigClient` remains available if editable copy is ever wanted |

### Accepted consequences

- **A maxed `air_jump` needs a stamina upgrade to be fully spendable.** `air_jump`
  has maxLevel 3, giving N = 4 air jumps per airtime, but base stamina is 3 — so
  the fourth jump requires at least one `max_stamina` level. The cap buys
  *permission*, not *budget*, and the two upgrade paths are deliberately
  orthogonal. **Decision: accept.** Maxing `air_jump` is a corner case, the
  synergy is legible once both paths exist in the tree, and raising base stamina
  to cover it would loosen the pool for every player to fix an edge case. No
  partial refund is warranted — the upgrade still delivers the air jumps it sold,
  and a player who buys the stamina to match gets exactly what the shop described.
- **Running dry is harsher than today.** At 0 stamina the player has only dive and
  wall slide — both free. Today, exhausting air jumps still leaves dash and wall
  jump as bailouts. Slide → land → refill is the intended recovery loop, and it is
  the single thing most in need of live smoke testing.
- **Stamina rarely binds within one airtime.** A full jump is ~1.5s of airtime, in
  which a player realistically spends 2 of 3 bars. The pinch is designed to arrive
  when *chaining airtimes without touching ground* — chimney-climbing, dash-jump
  traversal — which is the expert play. Grounded regen is the release valve.
- **Difficulty deflates.** Every player now starts with dash, wall jump and dive.
  Existing heaps get materially easier and ascent gets faster. Heap balance likely
  wants a follow-up pass.
- **Leaderboards will mix two movement systems, permanently.** `paceBonus` in
  `shared/buildRunScore.ts:59` scales with height over elapsed time, so universally
  faster ascent raises scores for everyone. Pre- and post-update rows coexist in
  `heap_scores` forever. Not exploitable — the server recomputes from inputs — but
  the boards are no longer comparing like with like. **Decision: accept and do not
  reset.** Heap's boards are per-heap and already churn; a reset costs more player
  goodwill than the inconsistency costs. Revisit only if the top of a board becomes
  visibly unreachable for new players.

## Mechanics

| Ability | Stamina | Limiter | Limiter resets on |
|---|---|---|---|
| Jump | 0 | grounded / coyote | — |
| Air jump | 1 | **N per airtime**, N = 1 + `air_jump` level | ground, ladder, stomp |
| Dash | 1 | cooldown (existing 800ms) | ground touch |
| Wall jump | 1 | **same-wall** cooldown, 3000ms → 1500ms by upgrade | different wall side, ground |
| Dive | 0 | none | — |
| Wall slide | 0 | none | — |

**The different-wall bypass is retained.** The clause at
[`Player.ts:587`](../../../src/entities/Player.ts) —
`wallJumpCooldown === 0 || currentWallSide !== lastWallJumpSide` — is what makes
chimney-climbing possible, and it stays. But chimneying is no longer unlimited:
stamina now caps an alternating-wall chain at roughly four jumps from full, which
is the intended change. The cooldown governs same-wall repetition only.

**Stomp refunds both** a bar and the air-jump cap. Refunding only the bar would
leave the cap spent and silently break stomp-chaining, which is the most
expressive movement in the game today. There are **four** `refundAirJump()` call
sites, all of which need the same treatment:
`GameScene.ts:848`, `TutorialScene.ts:362`, `InfiniteGameScene.ts:731`, and
`InfiniteGameScene.ts:599` — the last being debug noclip, which calls it every
frame to fake infinite flight and must refill stamina too or noclip stops working.

**Ladders regen at the grounded rate, applied inline.** `handleLadder()` returns
`true` and `runUpdate` early-returns at `Player.ts:257`, *before* the normal
`updateStamina()` call site. Ladder regen must therefore be applied inside
`handleLadder()` alongside the existing `airJumpsRemaining` / `wallJumpCooldown`
resets at `Player.ts:339-341`, or a player parked on a ladder regenerates nothing.

**Frozen and control-disabled states do not regen.** The `!this.controlsEnabled`
early-return at `Player.ts:258` sits ahead of the stamina update. This is
intentional — outro and cutscene states should not tick the pool.

**Placement mode gates dash.** `tryWallJump` and `tryGroundOrAirJump` both check
`!this.placementMode` (`Player.ts:546,578`); `updateDash` at line 509 does not, so
today a player can dash while positioning an item. Under stamina that drains the
pool during placement. Add the `placementMode` gate to `updateDash` to match.

**At exactly 0 stamina the jump press must not be swallowed silently.** Both jump
paths return false, so `consumeJumpBufferOnFire` never runs and `jumpBufferTimer`
keeps decaying — potentially firing a stale jump on a later landing. Clear the
buffer on a stamina-blocked press and emit a distinct failure cue (a short "empty"
sound plus a stamina-bar flash). This is the design's riskiest feel change and it
currently has no feedback at all.

## Architecture

### `src/systems/stamina.ts` (new, pure)

No Phaser import, unit-tested in isolation — following `wallSlide.ts` /
`buffMath.ts` / `hudLogic.ts`.

```ts
regenStamina(current: number, max: number, deltaMs: number,
             grounded: boolean, airRegenMs: number): number
canSpend(current: number, cost: number): boolean
spend(current: number, cost: number): number
```

Constants in `constants.ts`: `BASE_STAMINA = 3`, `MAX_STAMINA_CAP = 8`,
`STAMINA_REGEN_GROUND_MS = 200`, `STAMINA_REGEN_AIR_MS = 3000`.

### `Player.ts`

Smaller than it appears, because **`airJumpsRemaining` already is the per-airtime
cap** — it resets on ground (`Player.ts:427`), ladder (`339`) and stomp (`767`)
today, and simply gains a stamina check beside it.

- One new field `private stamina: number`, plus `staminaCurrent` / `staminaMax`
  HUD getters.
- `updateStamina(ctx, delta)` inserted **after `handleLandingResets`** in the
  `runUpdate` helper order. Verified correct: `computeGroundContext()` has already
  run so `grounded` is fresh, and a bar completing this frame is spendable by
  `tryWallJump` / `tryGroundOrAirJump` further down the same frame.
- `effectiveMaxAirJumps` gains a sibling `effectiveMaxStamina` folding the carry
  and buff layers.
- **Clamp on every modifier change.** `setCarryModifiers` / `setBuffModifiers`
  (`Player.ts:783,797`) must apply `stamina = Math.min(stamina, effectiveMaxStamina)`.
  Carry modifiers *decrease* when salvage is dropped or delivered; without the
  clamp the player holds bars above their cap and the HUD renders more filled
  segments than exist. `airJumpsRemaining` has the same latent bug today but
  self-heals on the next landing — a float pool with 3s airborne regen will not.
- **Gaining max stamina grants +1 current, not a full refill.** Note that the
  existing air-jump code at those same lines does `airJumpsRemaining =
  effectiveMaxAirJumps` — a *full* refill. Do not copy that; a full refill on
  picking up a Balloon mid-chimney would be a free escape.

**A comment must be rewritten, not preserved.** [`Player.ts:269`](../../../src/entities/Player.ts)
justifies trying wall jump before air jump *"because it costs no air jump."* That
reason ceases to be true. The priority is still correct — wall jump adds
horizontal push and spares the air-jump cap — but the stated justification becomes
"same cost, preserves the cap." Leaving a false comment in this file is how the
next reader is misled.

### HUD — `AbilityTray.ts`, `hudLogic.ts`, `mountJoystick.ts`

The tray sizes its column by counting *owned* abilities; with everything unlocked
that is always 4 rows, too tall for phone portrait. Restructure to **2 rows**:

1. Segmented stamina bar — **construct all 8 segments at `MAX_STAMINA_CAP` and
   hide the surplus**, rather than rebuilding on every max change. (Today's pip row
   sizes from `player.maxAirJumpsCount` at `AbilityTray.ts:24`, which is the *base*
   and not `effectiveMaxAirJumps` — so a Balloon's extra charge already has no pip.
   Building at the cap fixes that class of bug.)
2. Three glyphs side-by-side — cloud / wall / dash.

The cloud and wall glyphs are lit/dim. **The dash glyph keeps a continuous fill**
rather than becoming a binary toggle: `AbilityTray.ts:81-85` renders real cooldown
progress today, and "how long until dash?" is a timing decision players make
constantly. A binary glyph would answer only "not yet."

**`mountJoystick.ts` is the primary dash UI on mobile** and the original spec
missed it entirely — it reads `player.hasDash` at lines 58, 61, 62, 65 and 83 to
build and gate the on-screen dash button. With dash always unlocked the button is
always shown, but it needs a **stamina affordance of its own** (dim the button at
0 stamina), or mobile players get a live-looking button that does nothing.

`airJumpPipStates` is replaced by `staminaSegments(current, max): number[]`
returning a 0..1 fill per segment — same pure-function-with-tests pattern, so the
partial fill is verifiable without a browser.

### Modifier layers

`extraAirJumps` → `extraStamina` across `pickupDefs.ts`, `buffMath.ts`,
`BuffManager.ts` and `Player.ts`. The Balloon pickup's +1 air jump becomes +1 max
stamina. The existing rule that this field is **never rarity-scaled** because it is
a discrete capability still holds, so that comment stays valid. `cooldownMult`
already applies to both the dash (`Player.ts:534`) and wall-jump (`590`) cooldowns
— no work needed there.

Base 3 plus a maxed `max_stamina` (+3) plus two Balloons (+2) reaches exactly
`MAX_STAMINA_CAP`; any further source is clamped, per the clamp rule above.

## Upgrade tree

| | |
|---|---|
| **Removed, refunded at purchase price** | `wall_jump` 450, `dash` 600, `dive` 500 — **1,550 max** |
| **Unchanged** | `air_jump` *(now the per-airtime cap; grants no stamina)*, `jump_boost`, `money_mult`, `stomp_gold`, `peak_hunter`, `mountain_climber`, `enemy_radar` |
| **New** | `max_stamina` (+1 bar, 3 → 6), `stamina_regen` (airborne 3000 → ~1800ms), `dash_power` (dash distance/speed), `wall_jump_cd` (3000 → 1500ms, 10 levels) |

Net 10 → 11 entries; `UpgradeScene` already scrolls, so no layout work. Costs and
level counts ship stubbed with `// designer:` comments, matching how
`mountain_climber` is written today. `ACCENT_COLORS` at `UpgradeScene.ts:16-25`
needs the four new ids added and three removed.

`PlayerConfig` drops the `wallJump` / `dash` / `dive` booleans (now always true)
and gains `baseStamina`, `staminaRegenAirMs`, `wallJumpCooldownMs`, `dashPower`.
`TutorialScene`'s `{ ...playerConfig, dash: true, dive: true, wallJump: true }`
override at line 124 becomes unnecessary and is deleted.

## Migration — schema 5 → 6

### The schema-branch landmine (fix first)

`migrateGame` (`src/systems/save/game.ts:354-441`) branches on
`version === CURRENT_SCHEMA`, `=== 1`, `=== 4`, and lets **everything else** fall
through to a v2→v3 remap branch. The moment `CURRENT_SCHEMA` becomes 6, every v5
save in the wild — i.e. all of them — stops matching the first branch, lands in the
catch-all, and is returned with `beatenHeapIds: []`, `cosmeticsOwned: []`,
`cosmeticsEquipped: {}`, no `hatAdjustments`, no `menuTutorialSeen`, and every
placed item offset by +4,950,000px via `remapPlacedY`.

The code already warns about this at `game.ts:425`:

> *"Before the next CURRENT_SCHEMA bump, narrow this to `version === 2` and give
> the fall-through a no-remap path — otherwise the downgrade case goes live."*

**Required before anything else:** narrow the catch-all to `version === 2`, change
the first branch to `version >= 5`, and give unknown or newer versions a no-remap
passthrough. Existing tests do not catch this — `SaveData.test.ts:750` and
`saveCore.test.ts:39,87,133` seed v5 saves but assert only balance and secret,
which the catch-all also satisfies. Add a regression test that a v5 blob carrying
cosmetics, beaten heaps, hat adjustments and placed items round-trips unchanged.

### Why the refund runs post-merge, not in `migrateGame`

Three save fields, each following the one-time-flag pattern at `game.ts:513`:

| Field | Merge rule |
|---|---|
| `movementRefundApplied: boolean` | `\|\|` |
| `movementRefundAmount: number` | `max` |
| `seenAnnouncements: string[]` | union |

A refund applied inside `migrateGame` is **double-credited**, because migration
runs at `load()` (`core.ts:159`) and the cloud merge runs later
(`bootSequence.ts:84`):

1. Device A updates, refunds 1,550, spends it on `max_stamina`. Cloud balance is
   now back near 0, with the upgrade owned.
2. Device B updates. `migrateGame` sees no local flag → refunds 1,550 locally.
3. B's GPGS merge runs → `balance: Math.max(1550, 0) = 1550`, and the upgrades
   union pulls in A's purchased `max_stamina`.

The player keeps the upgrade *and* the money. This is the hazard already
documented at `cloudSave.ts:33-35` — *"a stale cloud snapshot will refund spent
coins on the next launch while keeping the purchased upgrade/item."*

**Therefore:** the refund is a `reconcileMovementRefund()` step that runs *after*
the merged save is applied — after `applyMergedSave()` in `startIdentitySession`,
and on the no-sign-in path once boot settles. It reads the reconciled upgrade map,
pays once, and **persists unconditionally**. (`load()` only persists when the
stored version differs from `CURRENT_SCHEMA` at `core.ts:161`, so a refund that
relies on that side effect can be recomputed on every launch and never written.)
It then calls `syncSaveToCloud()` immediately, per that file's own guidance, to
close the stale-snapshot window.

Refund prices are **hardcoded historical constants** — `wall_jump: 450`,
`dash: 600`, `dive: 500` — with a comment saying why. Reading them from
`UPGRADE_DEFS` returns 0 once the defs are deleted, silently refunding nothing.
A test pins the total at 1,550.

### Why a persisted flag is not sufficient on its own

The original version of this spec argued that an explicit flag was safe where the
schema version was not. **That reasoning was wrong, and the correction matters.**

`mergeGame` returns a hand-built object literal (`game.ts:499-517`) enumerating
only the fields its build knows about, and `mergeCloudSave` spreads `...local`
first (`core.ts:280-286`) — which preserves fields the *local* save has, not fields
that exist only in the *cloud*. So an old client merging a v6 cloud save drops
`movementRefundApplied` exactly as it drops the version stamp, and the resurrect
sequence proceeds unchanged. The flag is precisely as durable as the mechanism it
replaced.

Three mitigations, applied together:

1. **Raise `min_version` at release** — `shared/versionGate.ts` and
   `src/systems/UpdateGate.ts` already implement a hard floor. Setting it to the
   stamina build removes the stale-client window entirely rather than defending
   against it. This is the primary defence.
2. **Harden `mergeGame` to pass unknown game fields through** — spread
   `secondary` then `primary` before the explicit literal. Fixes the whole class,
   including `seenAnnouncements`, not just this one field.
3. **Keep the flag** for the ordinary single-device repeat-launch case, which it
   handles correctly.

### `freshGame()` must not pre-set the refund flag

The original spec had `freshGame()` set `movementRefundApplied: true` so new
players "never see a refund they did not earn." That conflates *fresh save* with
*new player*, and on Android it is wrong: the standard reinstall path is fresh
install → `freshSave()` → GPGS merge pulls the pre-update cloud save carrying
`wall_jump`/`dash`/`dive`. With the flag pre-set to `true`, the returning player
keeps three dead keys and never sees a Scrap of their 1,550.

Because reconciliation is post-merge and keyed on *the presence of the three
upgrade keys*, a genuinely new save pays out zero on its own — no flag needed.
`freshGame()` still seeds `seenAnnouncements`, since the modal genuinely should not
fire for someone who never used the old system.

## Announcement

A small reusable `AnnouncementModal` keyed by id, gated on `seenAnnouncements`,
seeded with one entry (`movement-v0.4`). Shown from `MenuScene` once boot settles
— and **after `reconcileMovementRefund()` has run**, since it reads the amount.

Content is three beats:

1. **What changed** — one shared stamina pool replaces air-jump charges
2. **What you gained** — dash, wall jump and dive are unlocked for everyone
3. **What you got back** — the refund, showing *this player's* actual number

Beat 3 is why reconciliation records `movementRefundAmount` rather than the copy
hardcoding a figure. **When the amount is 0** — a player who owned none of the
three — beat 3 is omitted entirely rather than reading "you got back 0 Scrap."

## Tutorial

Two pieces of work, not one:

- **A stamina teaching step**, placed before the wall-jump and dash steps. Stamina
  is now the game's core resource and the tutorial is the one place designed to
  teach it.
- **Re-verify the existing wall-jump step is still passable.** `tutorialFixture.ts`
  (lines 82, 103, 118) asks a brand-new player to chimney up a tall wall. With 3
  bars, 1 per wall jump and 3s airborne regen, a stamina-naive beginner may now
  stall partway up. This needs live verification, not reasoning — it is a
  first-session drop-off risk.

## Testing

| Area | Coverage |
|---|---|
| `stamina.ts` | Regen at both rates, float accumulation across frames, clamping at 0 and max, spend/canSpend edges |
| `hudLogic.ts` | `staminaSegments` — partial fills, max > segments, zero |
| `Player.ts` | Each ability gated by stamina; air jump blocked at cap-spent with a full bar; wall-jump different-side bypass still fires; stomp restores both bar and cap; 0-stamina leaves dive and wall slide working; jump buffer cleared on a stamina-blocked press; clamp on modifier decrease |
| **Schema branch** | **A v5 save with cosmetics, beaten heaps, hat adjustments and placed items round-trips a v6 load unchanged** |
| Refund | Amount per upgrade combination, total pinned at 1,550; the spend-then-merge sequence pays once; reinstall-then-cloud-restore *does* pay; a genuinely fresh save pays zero; refund persists on the launch it fires |
| Announcement | Fires once, suppressed on fresh saves, suppressed at amount 0, does not re-nag after a cloud merge |

**Existing tests that must be migrated, ~110 assertions:**
`Player.test.ts` (every `config: { maxAirJumps, wallJump, dash, dive, jumpBoost }`
literal becomes invalid once `PlayerConfig` changes shape), `hudLogic.test.ts:3,17-25`
(`airJumpPipStates`), `pickupDefs.test.ts:39-42` and `buffMath.test.ts:7`
(`extraAirJumps`).

The migration tests matter most: that path pays out real currency to a live player
base, and neither `Math.max` nor the existing v5 fixtures catch the cases that
break it.

## Sequencing

1. **Merge `feature/scrap-currency-rename`** (commit `e7955db`, UI strings only).
   It touches `upgradeDefs.ts`, `UpgradeScene.ts` and `MenuScene.ts` — all three
   also touched here. Rebasing a rename onto a restructure is considerably worse
   than the reverse, and the announcement copy should say "Scrap" consistently.
2. **Land the schema-branch fix on its own**, with its regression test, before any
   stamina work. It is a live-save-corruption bug that exists independently of this
   feature and should not be entangled with it.
3. Implement stamina, HUD, upgrades, refund, announcement, tutorial.
4. **Raise `min_version`** as part of the release, not before.

## Out of scope

- Heap difficulty rebalance following the mobility increase (flagged above)
- Leaderboard reset or movement-system score tagging (decided against above)
- Fractional stamina costs (Deadlock's 0.5 successive wall jump) — all costs are
  integers here, which is what keeps the segmented HUD viable
- Regen penalties on specific actions (Deadlock's −25% after a wall jump)
- Remote-config-driven announcement copy
