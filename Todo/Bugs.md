## BUGS

# Server

**HIGH — freeze race can permanently lose heap geometry** (found by PR #126 review, 2026-07-28)

`/place` decides a freeze with `checkFreezeBands(await db.getAllBands(id), ...)` and
then writes it with `db.setFreeze(...)` — two unsynchronised D1 round trips, and
`setFreeze` does a blind `UPDATE` with no compare-and-swap. Placement dropped CAS
deliberately (MIN/MAX band widening is conflict-free) but freeze is not: it is a
destructive repoint-and-delete.

Two placements crossing the threshold together both read the same pre-freeze
`row.base_id` and both build a new base from it. Identical frozen sets are harmless
(last writer wins, same geometry). The loss case is *different* frozen sets: the
loser's bands are deleted by its own `DELETE` but survive only in its orphaned base,
which the heap no longer points at. Those bands are gone — not in `heap_band`, not in
the winner's base.

Rare (needs two placements inside one window, and freeze fires only every
FREEZE_BATCH_BANDS=38 new bands) but silent and unrecoverable when it hits.

Fix shape: CAS `setFreeze` on the `freeze_y` read before the check, and skip the new
base if zero rows changed. Wrinkle to design around — the frozen-row `DELETE` shares
the batch with the `UPDATE`, and a batch runs both regardless, so a failed CAS would
still delete. The delete has to key off the heap's actual current freeze line rather
than the one this request computed.

Not exercised by any test: `placeConcurrency.test.ts` and
`commitPlacementAtomicity.test.ts` both note their mocks cannot simulate true
interleaving, and nothing drives two concurrent placements through a freeze.

# COSMETICS
CAT hat is bugged and needs new art

# Mobile

# Scenes
- Main menu calls out to Daily rewards API every time it loads - this can be reduced with a Next claimable timestamp from the server. 

Restore Streak by watching AD fails. 

# Enemies

# Admin

# Gameplay