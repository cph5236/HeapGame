# Item Rarity Tiers — Design (2026-06-04)

Playtester feedback item **#5**: add rarity tiers to salvage pickups so some are
rarer and more exciting to find. This spec covers the design agreed during
brainstorming. One feature branch (`feat/item-rarity-tiers`), one PR.

Source exploration: [Todo_Playtest_Feedback.md](../../../Todo/Todo_Playtest_Feedback.md) §5.

## Goal

Each spawned salvage pickup gets a **rarity tier** that scales both its gameplay
effect and its score bonus, and is **visible before grab** so the player can
choose to detour for a rare one. Rarer items are monotonically more desirable.

## Decisions (locked during brainstorming)

1. **Rarity scales BOTH effects and score** (not one or the other).
2. **Player-favoring scaling** for mixed items: good levers grow, bad levers
   shrink toward neutral — so higher rarity is always better.
3. **Anchor is Rare = 1×** — the current tuned values in `pickupDefs.ts`
   represent the Rare tier. Common/Uncommon are below; Legendary/Mythic above.
4. **Rarity rolled at spawn**, fixed for that pickup, shown via glow + overlay label.

## 1. Rarity model & scaling math

Five tiers, anchored at Rare = 1×:

| Tier      | Multiplier `m` | Spawn weight |
|-----------|----------------|--------------|
| Common    | 0.75×          | 50           |
| Uncommon  | 0.90×          | 28           |
| Rare      | **1.00×**      | 15           |
| Legendary | 1.40×          | 6            |
| Mythic    | 2.00×          | 1            |

(Weights are relative; the roll normalises over their sum.)

### Effect scaling — auto-derived, player-favoring

Each **continuous** effect lever has a known "beneficial direction" relative to
its neutral identity:

| Lever          | Neutral | Beneficial direction |
|----------------|---------|----------------------|
| `speedMult`    | 1       | higher (>1)          |
| `jumpBonus`    | 0       | higher (>0)          |
| `gravityMult`  | 1       | lower (<1, float)    |
| `cooldownMult` | 1       | lower (<1, faster)   |
| `wallSpeedMult`| 1       | lower (<1, slow wall)|

For a lever's signed delta-from-neutral `d`:

- If the lever **helps** the player (`sign(d)` matches beneficial direction):
  `newDelta = d × m`  → rarer = bigger benefit.
- If the lever **hurts**: `newDelta = d × (1 / m)` → rarer = smaller penalty
  (pulled toward neutral). At Mythic the penalty halves; at Common it grows ~1.33×.

The scaled lever value is then `neutral + newDelta`.

**Worked example — Skateboard (+15% spd, −50 jump):**

| Tier      | speedMult        | jumpBonus      |
|-----------|------------------|----------------|
| Common    | 1 + 0.15×0.75 = 1.1125 | −50 × 1/0.75 = −66.7 |
| Rare      | 1.15             | −50            |
| Mythic    | 1 + 0.15×2 = 1.30 | −50 × 1/2 = −25 |

**`extraAirJumps` is excluded** from effect scaling — it is a discrete
capability, not a magnitude (no fractional air-jumps). Balloon stays +1 air-jump
at every tier; only its score scales.

**Safety clamp:** after scaling, clamp levers to sane ranges so extreme
compositions can't produce nonsense (e.g. `speedMult` floored at a small
positive, `gravityMult` floored above 0). Exact bounds set during implementation.

### Score scaling

`scoreBonus(id, rarity) = PICKUP_BONUS[id] × RARITY_SCORE_MULT[rarity]`, where
`RARITY_SCORE_MULT` uses the same `m` column. Applies to negatives too: a Mythic
Engine Block = tiny speed penalty + 2× points (a great find, by design).

## 2. Spawn flow & visuals

Spawn stays a 3-step roll; rarity is an independent axis that does **not**
disturb the per-heap positive/negative mix (migration 0007):

1. Pick polarity (existing, per-heap rates).
2. Pick item id uniformly within that polarity pool (existing).
3. **Roll rarity by the global tier weights** (new).

Rarity weights are **global** for now; per-heap rarity bias is a clean future
extension layered on 0007 and is out of scope here.

**Visuals:**

- Item **core** keeps its own `def.color`.
- **Glow** is driven by rarity: tier-colored halo with intensity/size scaling
  (Common = dim/small → Mythic = bright/large pulsing). Drives the existing
  `GLOW_TEX_KEY` halo tint + scale in `PickupManager`.
- **Proximity overlay** gains a tier label (e.g. `RARE`) rendered in the tier
  color, above the item name.
- Tier color ramp: Common grey → Uncommon green → Rare blue → Legendary purple
  → Mythic gold.

## 3. Scoring & server (anti-cheat)

- Carried-items payload to the server changes from `salvageItemIds: string[]` to
  `salvageItems: { id: string; rarity: Rarity }[]`.
- Server `computeSalvageBonus` sums `PICKUP_BONUS[id] × RARITY_SCORE_MULT[rarity]`,
  **validates** each `rarity` is a known tier (reject otherwise), and keeps the
  **existing count cap** (`maxSalvageItems`).
- Worst-case forgery is bounded to 2× per item — acceptable, because *which*
  items were grabbed is already client-trusted today; rarity only widens that
  trusted band by the capped multiplier.
- `RARITY_SCORE_MULT` and the `Rarity` type live in `shared/pickupScores.ts` so
  client and server agree on one source of truth.

## 4. Components & boundaries

- **`src/data/pickupDefs.ts`** — `Rarity` type (re-exported from shared),
  `RARITY_DEFS` table (`mult`, `spawnWeight`, `color`, `label`),
  `applyRarity(effect, rarity): PickupEffect` (pure). `aggregateModifiers` and the
  carry types now operate on `{ def, rarity }` so stacked effects use scaled values.
- **`shared/pickupScores.ts`** — `Rarity` type, `RARITY_SCORE_MULT`, updated
  `computeSalvageBonus` signature, the `salvageItems` payload element type.
- **`src/systems/PickupHelpers.ts`** — `pickRarity(rand, weights): Rarity` (pure,
  weighted selection). Unit-tested for distribution.
- **`src/systems/PickupManager.ts`** — roll + store rarity per spawned pickup,
  rarity-driven glow + overlay label, send `{ id, rarity }` list to the server,
  apply scaled effects on grab.
- **`server/src/routes/scores.ts`** — accept + validate the `salvageItems`
  payload; reject unknown tiers; preserve count cap.
- **GameScene** (caller) — build the `{ id, rarity }` list it submits.

### Data flow

spawn → `pickRarity` → `SpawnedPickup{ def, rarity }` (glow + label by tier) →
grab → carried `{ def, rarity }` → `applyRarity` feeds `aggregateModifiers`
(live effects) → on summit, submit `salvageItems[]` → server recomputes bonus
from `PICKUP_BONUS × RARITY_SCORE_MULT`, capped by count.

## 5. Testing

- `pickRarity` — weighted distribution lands within tolerance over many rolls;
  deterministic given a seeded `rand`.
- `applyRarity` — good levers scale up, bad levers toward neutral; `extraAirJumps`
  unchanged across tiers; clamp holds at extremes; Rare == identity.
- `aggregateModifiers` — stacked mixed-rarity carry composes scaled values.
- `computeSalvageBonus` (shared) — applies rarity multiplier; unknown id → 0.
- Server `scores.ts` — valid payload scores correctly; unknown rarity rejected;
  over-cap count rejected (existing behavior preserved with new payload shape).

## Out of scope

- Per-heap rarity bias (future, layers on migration 0007).
- New items / store changes (that is feedback item #8).
- Changing which items are positive/negative or their base tuning.

## Open implementation details (decided during build, not blockers)

- Exact safety-clamp bounds per lever.
- Whether to keep a back-compat path for the old `salvageItemIds` payload
  (likely not needed — beta, client and server ship together).
