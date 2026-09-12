# Stamina Movement System — Design

**Date:** 2026-09-11
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
| Resource shape | One shared pool, base 3, hard cap 8 | ≥2 is required for spending to be a choice; 3 is Deadlock's modal value and affords *dash → air jump → wall jump* in one airtime |
| Cost per ability | Flat 1 for air jump / dash / wall jump; 0 for jump, dive, wall slide | Uniform integer costs keep the HUD free of fractional segments; the interesting variation lives in the limiters instead |
| Second gate | Each ability keeps its own limiter (per-airtime cap, cooldown) | Precedent: Deadlock's air dash is *also* double-gated (1 bar **and** one per airborne period) |
| Air-jump limiter | Per-airtime cap, N = 1 + `air_jump` level | Preserves the literal promise the shop made, so `air_jump` needs no refund and no migration |
| Grounded regen | 200ms per bar — fast, not instant | Turns ground contact into a *duration*: a 2-frame bunny-hop banks ~0.15 bars, a half-second pause on a ledge tops you up. This is the skill gradient the instant refill has none of |
| Airborne regen | 3000ms per bar, flat | Chosen to be tuned in playtest. Yields ~4 wall jumps from a full pool before forced recovery |
| Accumulator model | Stamina is a **float**, not per-bar timers | Partial progress is never lost, the regen function stays pure and testable, and the HUD's partial-fill segment is honest rather than decorative |
| Refund idempotency | Explicit persisted flag, **not** schema version | An old client can downgrade the version stamp on an already-refunded save. See *Migration* |
| Announcement | In-build content, gated on `seenAnnouncements` | Copy that ships with the build cannot fail to load or render blank; `ConfigClient` remains available if editable copy is ever wanted |

Accepted consequences, confirmed with the product owner:

- **Running dry is harsher than today.** At 0 stamina the player has only dive and
  wall slide — both free. Today, exhausting air jumps still leaves dash and wall
  jump as bailouts. Slide → land → refill is the intended recovery loop, and it is
  the single thing most in need of live smoke testing.
- **Stamina rarely binds within one airtime.** A full jump is ~1.5s of airtime, in
  which a player realistically spends 2 of 3 bars. The pinch is designed to arrive
  when *chaining airtimes without touching ground* — chimney-climbing, dash-jump
  traversal — which is the expert play. Grounded regen is the release valve.
- **Difficulty deflates and scores inflate.** Every player now starts with dash,
  wall jump and dive. Existing heaps get materially easier and ascent gets faster.
  Not exploitable — the server recomputes score from inputs — but the tuning curve
  shifts and heap balance likely wants a follow-up pass.

## Mechanics

| Ability | Stamina | Limiter | Limiter resets on |
|---|---|---|---|
| Jump | 0 | grounded / coyote | — |
| Air jump | 1 | **N per airtime**, N = 1 + `air_jump` level | ground, ladder, stomp |
| Dash | 1 | cooldown (existing 800ms) | ground touch |
| Wall jump | 1 | **same-wall** cooldown, 3000ms → 1500ms by upgrade | different wall side, ground |
| Dive | 0 | none | — |
| Wall slide | 0 | none | — |

**The different-wall bypass survives unchanged.** The clause at
[`Player.ts:587`](../../../src/entities/Player.ts) —
`wallJumpCooldown === 0 || currentWallSide !== lastWallJumpSide` — is what makes
chimney-climbing possible. Stamina is the global limiter; the cooldown remains a
same-wall anti-spam rule only. Raising the base cooldown 2s → 3s *and* charging a
bar *and* applying it to alternating walls would kill the technique outright.

**Stomp refunds both** a bar and the air-jump cap. `refundAirJump()` in
`GameScene` currently restores the counter; refunding only the bar would leave the
cap spent and silently break stomp-chaining, which is the most expressive movement
in the game today.

**Ladders regen at the grounded rate**, matching their existing treatment as
grounded for jump-charge purposes.

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
cap** — it resets on ground, ladder and stomp today and simply gains a stamina
check beside it.

- One new field `private stamina: number`, plus `staminaCurrent` / `staminaMax`
  HUD getters.
- `updateStamina(ctx, delta)` inserted after `handleLandingResets` in the
  `runUpdate` helper order, so a bar completing this frame is spendable this frame.
- `effectiveMaxAirJumps` gains a sibling `effectiveMaxStamina` folding the carry
  and buff layers.
- Gaining +1 max stamina mid-run grants +1 current, mirroring how gaining an air
  jump currently refills the counter.

**A comment must be rewritten, not preserved.** [`Player.ts:269`](../../../src/entities/Player.ts)
justifies trying wall jump before air jump *"because it costs no air jump."* That
reason ceases to be true. The priority is still correct — wall jump adds
horizontal push and spares the air-jump cap — but the stated justification becomes
"same cost, preserves the cap." Leaving a false comment in this file is how the
next reader is misled.

### `src/ui/AbilityTray.ts` + `hudLogic.ts`

The tray sizes its column by counting *owned* abilities; with everything unlocked
that is always 4 rows, too tall for phone portrait. Restructure to **2 rows**:

1. Segmented stamina bar (up to 8 segments, partial fill on the regenerating one)
2. Three glyphs side-by-side — cloud / wall / dash — each lit or dim

The cloud glyph demotes from a pip row to a lit/dim icon, exactly how the
wall-jump icon already behaves. **This is the fix for the design's one UX trap:**
with two independent gates a player can sit at full stamina and still be unable to
air jump (cap spent). A full bar plus a dead button reads as a bug unless a
separate affordance answers "what is available" while the bar answers "what can I
afford."

`airJumpPipStates` is replaced by `staminaSegments(current, max): number[]`
returning a 0..1 fill per segment — same pure-function-with-tests pattern, so the
partial fill is verifiable without a browser.

### Modifier layers

`extraAirJumps` → `extraStamina` across `pickupDefs.ts`, `buffMath.ts`,
`BuffManager.ts` and `Player.ts`. The Balloon pickup's +1 air jump becomes +1 max
stamina. The existing rule that this field is **never rarity-scaled** because it is
a discrete capability still holds, so that comment stays valid. `cooldownMult`
continues to apply, now to both the dash and wall-jump cooldowns.

## Upgrade tree

| | |
|---|---|
| **Removed, refunded at purchase price** | `wall_jump` 450, `dash` 600, `dive` 500 — **1,550 max** |
| **Unchanged** | `air_jump` *(now the per-airtime cap — same promise, no refund)*, `jump_boost`, `money_mult`, `stomp_gold`, `peak_hunter`, `mountain_climber`, `enemy_radar` |
| **New** | `max_stamina` (+1 bar, 3 → 6), `stamina_regen` (airborne 3000 → ~1800ms), `dash_power` (dash distance/speed), `wall_jump_cd` (3000 → 1500ms, 10 levels) |

Net 10 → 11 entries; `UpgradeScene` already scrolls, so no layout work. Costs and
level counts ship stubbed with `// designer:` comments, matching how
`mountain_climber` is written today.

`PlayerConfig` drops the `wallJump` / `dash` / `dive` booleans (now always true)
and gains `baseStamina`, `staminaRegenAirMs`, `wallJumpCooldownMs`, `dashPower`.
`TutorialScene`'s `{ ...playerConfig, dash: true, dive: true, wallJump: true }`
override at line 124 becomes unnecessary and is deleted.

## Migration — schema 5 → 6

Three new save fields, each following the one-time-flag pattern already
established at `game.ts:513`:

| Field | Merge rule |
|---|---|
| `movementRefundApplied: boolean` | `\|\|` |
| `movementRefundAmount: number` | `max` |
| `seenAnnouncements: string[]` | union |

`migrateGame` gains a refund step that runs **on any incoming version when the
flag is absent**: sum `wall_jump`, `dash` and `dive` at purchase price, add to
balance, delete the keys, set the flag, record the amount.

### Why the flag and not the schema version

Refund-on-migrate looks safe because `mergeGame` takes `Math.max` on balance, so
two updated devices cannot stack. This sequence defeats that:

1. Device A updates → migrates v5→v6 → refunds 1,550, deletes the keys. Save is v6.
2. Device B is still on the **old build**. It merges with cloud: balance takes the
   max (1,550 richer ✓), but the upgrades union resurrects `dash: 1` from B's own
   local save. B's old code writes the result back stamped `CURRENT_SCHEMA = 5`.
3. Device B updates → sees a v5 save carrying `dash: 1` → **refunds again**.

The root cause is that an old client can *downgrade* the version stamp on a save
that has already been refunded, so the version is not a durable idempotency key.
An explicit flag merged with `||` fires the refund at most once per save lineage
regardless of the stamp or which key resurrects.

`freshGame()` sets `movementRefundApplied: true` and seeds `seenAnnouncements`
with the movement entry, so a new install never sees a refund it did not earn or a
"what changed" modal about a system it never experienced.

## Announcement

A small reusable `AnnouncementModal` keyed by id, gated on `seenAnnouncements`,
seeded with exactly one entry (`movement-v0.4`). Barely more code than a one-off
and reusable next release. Shown from `MenuScene` once boot settles.

Content is three beats:

1. **What changed** — one shared stamina pool replaces air-jump charges
2. **What you gained** — dash, wall jump and dive are unlocked for everyone
3. **What you got back** — the refund, showing *this player's* actual number

Beat 3 is why the migration records `movementRefundAmount` rather than the copy
hardcoding a figure: the payout is per-player.

The union merge on `seenAnnouncements` matters for the same reason as the refund
flag — without it the modal re-nags on every launch on a second device, which is
the precise bug the `game.ts:513` comment records being fixed once already.

## Testing

| Area | Coverage |
|---|---|
| `stamina.ts` | Regen at both rates, float accumulation across frames, clamping at 0 and max, spend/canSpend edges |
| `hudLogic.ts` | `staminaSegments` — partial fills, max > segments, zero |
| `Player.ts` | Each ability gated by stamina; air jump blocked at cap-spent with full bar; wall-jump different-side bypass still fires; stomp restores both bar and cap; 0-stamina leaves dive and wall slide working |
| Migration | Refund maths per upgrade combination; **the stale-client resurrect sequence above**, named explicitly; fresh saves neither refunded nor nagged; merge rules for all three new fields |
| Announcement | Fires once, suppressed on fresh saves, does not re-nag after a cloud merge |

The migration tests matter most: that path pays out real currency to a live
player base, and `Math.max` does not catch the case that breaks it.

## Sequencing note

`feature/scrap-currency-rename` (commit `e7955db`, UI strings only) is unmerged
and touches `upgradeDefs.ts`, `UpgradeScene.ts` and `MenuScene.ts` — all three
also touched here. **Merge the rename first.** Rebasing a rename onto a
restructure is considerably worse than the reverse, and the announcement copy
should say "Scrap" consistently.

## Out of scope

- Heap difficulty rebalance following the mobility increase (flagged above)
- Fractional stamina costs (Deadlock's 0.5 successive wall jump) — all costs are
  integers here, which is what keeps the pip HUD viable
- Regen penalties on specific actions (Deadlock's −25% after a wall jump)
- Remote-config-driven announcement copy
