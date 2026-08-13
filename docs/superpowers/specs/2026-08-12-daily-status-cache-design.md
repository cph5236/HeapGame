# Daily status caching: `stableUntil` + a min-gap countdown can

Date: 2026-08-12
Status: approved, ready for planning
Supersedes: the caching half of PR #146 (branch `claude/todo-bugs-triage-gee0l2`)

## Background

PR #146 set out to stop `MenuScene.setupDailyDrop()` calling `GET /daily/status`
on every menu load. It added `nextEligibleAt` to the status response and cached a
snapshot in `localStorage`, served only while the snapshot says `claimedToday`,
`nextEligibleAt` is in the future, and we are still in the same local day.

Verified working for the claimed-today case. Two gaps remain.

### Gap 1 — the gate answers the wrong question

`nextEligibleAt` means "when may this player claim again". The cache needs "when
does this response stop being true". Those differ, and the difference is the
whole unclaimed half of the state space:

- **Never claimed.** Response is `{0, false, 1, day1Grants}` with no
  `nextEligibleAt` at all. Nothing can change it except a claim. Permanently
  cacheable; currently never cached.
- **Claimed once long ago, grace expired.** `nextEligibleAt` is far in the past
  and `nextClaimDay` has already reset to 1, so nothing further changes. Also
  permanently cacheable; currently re-fetched on *every* menu load, forever.
  This is the heaviest user of the endpoint and the current gate never catches it.

The unclaimed response is in fact *more* static than the claimed one. `locked` vs
`ready` is computed locally from `hasPlayedToday()` in `MenuScene`; the server
plays no part. `claimedToday` cannot flip to true without a claim, which this
device initiates. The only autonomous transition is grace expiry.

### Gap 2 — the min-gap dead-end

`DEFAULT_MIN_GAP_HOURS = 10` creates a window where `claimedToday` is already
false but a claim still 409s. Claim at 23:00, and at 07:00 next morning it is a
new local day (`claimedToday` false) while `nextEligibleAt` is 09:00. The can
renders `ready`, the player taps it, and the claim is rejected.

Nothing surfaces the wait. `nextEligibleAt` on the status response — which
PR #146 added and this design keeps — is exactly the data needed to fix it.

## Part 1 — `stableUntil`

One field replaces the caching gate: **the next instant this response can change
by itself**, or `null` when no such instant exists.

| State | Autonomous transitions ahead | `stableUntil` |
|---|---|---|
| Never claimed (`state === null`) | none | `null` |
| Claimed today | `claimedToday` → false at next local midnight | next local midnight |
| Unclaimed, within grace | `nextClaimDay` → 1 at grace expiry | `lastClaimAt + graceHours` |
| Unclaimed, grace expired | none — already reset to day 1 | `null` |

`nextEligibleAt` is unaffected and stays on the response; it now serves the
countdown in Part 2 rather than the cache. It also keeps its single meaning
across the status response and the 409 body, instead of being overloaded.

### Wire format

```ts
// shared/dailyTypes.ts
stableUntil?: number | null;
```

Three cases, and the distinction is load-bearing:

| Value | Meaning | Client |
|---|---|---|
| `number` | changes at this instant | cache until then |
| `null` | nothing can change it | cache up to the client cap |
| absent (`undefined`) | server predates this field | **do not cache** |

The absent case preserves PR #146's compatibility property: a new client against
today's production server simply never caches, rather than caching forever.
`null` survives JSON; a missing key arrives as `undefined`; the two are
distinguishable without an `in` check.

### Server

`stableUntilFor(state, nowMs, offsetMin, graceHours)` — new pure function in
`shared/dailyDrop.ts`, returning the minimum of the *future* transition instants
above, or `null` when none remain:

- `state === null` → `null`
- `claimedToday` → include next local midnight
- `lastClaimAt + graceHours * HOUR_MS` → include when still in the future

Midnight is included only when `claimedToday`; for an unclaimed response midnight
changes nothing, and including it would force a needless daily re-fetch.

The next-local-midnight arithmetic currently lives inline inside
`nextEligibleAt`. Extract it as `nextLocalMidnight(nowMs, offsetMin)` and have
both call it — no behaviour change.

`GET /daily/status` emits the field via `statusFromState`. `POST /daily/claim`
emits it on success from the state it just wrote:
`stableUntilFor({ lastClaimAt: now, streakDay: decision.day }, now, offset, graceHours)`,
which yields next local midnight.

### Client

`readCachedDailyStatus` guard collapses from three conditions to:

```ts
samePlayer && sameOffset && withinCap && (stableUntil === null || now < stableUntil)
```

The `claimedToday` check and the `localDateKey` same-day check both go away —
midnight is now expressed as a `stableUntil` value rather than a separate rule.
An entry whose `stableUntil` is `undefined` is never usable.

**24h cap.** `readCachedDailyStatus` additionally refuses any entry whose age
(`now - entry.fetchedAt`, already stored) exceeds 24h, regardless of
`stableUntil`. Two jobs: it bounds how long a `null` entry can
serve, and it bounds cross-device staleness (claim on phone → tablet shows a
spent can until tapped, which 409s and clears the entry). Worst case becomes one
request per player per day instead of one per menu load.

`cacheClaimedSnapshot` reads `stableUntil` in place of `nextEligibleAt`, keeping
the existing rule that a response without it clears the cache rather than
writing an unusable entry. Claim-outcome clearing (409 / error / `streakBroken`)
is unchanged.

### Known staleness

`graceHours` and the reward table come from `loadTuning()` remote config. Retuning
the table in the admin UI leaves cached clients showing the old preview until
their entry expires — bounded by the 24h cap. Accepted.

## Part 2 — the `waiting` can

A fourth `DailyIconState`, ordered so it displaces only `ready`:

```ts
export function dailyIconState(status, playedToday, now = Date.now()): DailyIconState {
  if (status === null) return 'offline';
  if (status.claimedToday) return 'hidden';
  if (!playedToday) return 'locked';
  if (typeof status.nextEligibleAt === 'number' && now < status.nextEligibleAt) return 'waiting';
  return 'ready';
}
```

`locked` still wins when the player has not played today: that gate is actionable
("play a run"), the time gate is not, and tapping `locked` opens a preview with
no claim path, so it is not a dead-end. `waiting` replaces only the case that
currently 409s.

The can stays hidden after claiming — the existing "must not linger once it has
no job" decision is unchanged.

`shouldAutoShowPopup` already keys off `state === 'ready'`, so a waiting can does
not auto-open the popup. `openDaily` is reachable only from `ready`. Neither
needs changing.

### Visual

Existing 44×44 can at (36, 96), body in the dim `0x565d70` already used by
`locked`. No `!` badge, no wobble tween. A label below the can at `y ≈ +26`:

| Remaining | Label |
|---|---|
| ≥ 1h | `2h 14m` |
| < 1h | `14m` |
| < 1m | `<1m` |

Tap opens `openDailyLockedPreview(status)` — the existing no-claim-path preview
showing the streak track and today's reward.

### Ticking

`this.time.addEvent({ delay: 15_000, loop: true })` rewrites the label; minute
granularity does not need faster. On crossing zero the event re-runs
`setupDailyDrop()`, which re-reads the **cached** status and re-renders the can as
`ready`.

This composes with Part 1 at no cost: the countdown reads the absolute
`nextEligibleAt`, so a cached snapshot ticks down correctly, and the expiry
transition needs **zero** extra fetches — `dailyIconState` simply recomputes
against a later `now`.

Timer is torn down alongside `dailyCanIcon` in `openDaily`'s claim callback and
on scene shutdown.

### Compatibility

An old server omits `nextEligibleAt`, the `typeof` check fails, and the icon
behaves exactly as it does today.

## Files

| File | Change |
|---|---|
| `shared/dailyDrop.ts` | `stableUntilFor`; extract `nextLocalMidnight` |
| `shared/dailyTypes.ts` | `stableUntil` on status + claim success; `nextEligibleAt` stays |
| `server/src/routes/daily.ts` | emit `stableUntil` on both endpoints |
| `src/systems/dailyStatusCache.ts` | `stableUntil` guard + 24h cap; drop `claimedToday`/same-day rules |
| `src/systems/DailyDropClient.ts` | `cacheClaimedSnapshot` reads `stableUntil` |
| `src/ui/dailyDropLogic.ts` | `'waiting'` state, `now` param |
| `src/scenes/MenuScene.ts` | waiting visual, countdown label, tick timer |

## Testing

- `stableUntilFor` — one case per row of the Part 1 table, plus the
  min-of-transitions case and a configured non-default `graceHours`.
- `dailyStatusCache` — `null` caches; `undefined` never caches; expiry at
  `stableUntil`; the 24h cap overriding `null`; player and offset mismatches.
- `dailyIconState` — the full ordering, including `locked` beating `waiting` when
  unplayed, and an absent `nextEligibleAt` falling back to today's behaviour.
- `daily.test.ts` (server) — `stableUntil` present and correct on `/daily/status`
  for all four states, and on a successful claim.
- `DailyDropClient` — claim seeds from `stableUntil`; a response without it clears.
- Countdown formatting — the three label bands and the zero crossing.

Verification beyond unit tests: `npm run build`, then a live check against a
local worker on this branch (production does not yet serve either field), with
the request count observed across repeated menu loads in each of the four states.

## Out of scope

- A countdown on the claimed-today can — it stays hidden.
- A countdown inside the daily drop overlay.
- Any change to claim eligibility, streak, or grace semantics.
