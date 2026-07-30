## FEATURES

- Play Integrity API
Integration not started
Call the Integrity API at important moments in your app to check that it's your app binary, installed by Google Play, running on a genuine Android device. Your app's backend server can decide what to do next to prevent abuse, unauthorized access, and attacks. 

- The claw elevator.

Language detection?

~~Improve Admin UI - env dropdown, per-env admin secrets, eye toggle~~ — done 2026-07-28, Tailwind restyle in the same pass.

~~Heap silhouette rendered in the Admin UI — 20px bands as horizontal bars, x min/max editable, base points editable, versioned writes~~ — done 2026-07-29, see `docs/superpowers/specs/2026-07-29-admin-band-editor-design.md`.

### UI

### ENEMIES

### PERF — from load testing (2026-07-26)

Results: https://claude.ai/code/artifact/4579f8b6-423e-4a45-95d6-e522d3fd5518
Raw run summaries in `loadtest/results/`. Re-measure with:
`npm run loadtest -- -e PLACE_FIXTURE=<small|large> -e PLACEMENT_ITERATIONS=200 -e PLACEMENT_VUS=1 -e PLACE_RATE=0 -e SESSIONS=50`

**CONFIRMED: placement CPU scales with heap size, and 684 vertices already
breaches the free-tier 10ms cap.** Two isolation runs, 200 placements each,
CPU read per-minute off the Cloudflare dashboard:

| CPU | small (238 vertices) | large (684 vertices) |
|-----|----------------------|----------------------|
| P50 | ~2.8 ms              | ~3.6 ms              |
| P90 | ~3.8 ms              | ~6.0 ms              |
| P99 | ~5.6 ms              | **~10.3 ms**         |

On the large fixture P99 read 10.1 / 10.9 / 10.0 ms across three consecutive
minutes — at or over the cap every minute, not an occasional spike. Cloudflare
tolerates infrequent overruns; sustained ones become Error 1102. Heaps only
grow, and freezing redistributes vertices between base and live zone rather
than discarding any.

Latency could never have shown this: a placement is 400-900ms dominated by
network and D1, so a 5ms CPU delta is invisible. Only per-window CPU resolved it.

- **`/place` containment check scans the whole polygon, most of which can't matter.**
  `POST /heaps/:id/place` builds `[...baseVertices, ...liveZone]` and ray-casts
  `isPointInside` over all of it, up to 5x in the CAS retry loop, plus a
  `JSON.parse` of the live zone per attempt. This is the prime suspect for the
  CPU above.

  Measured on staging (TestHeap1): base y-range `[48648, 50000]` sits *entirely
  below* the valid placement band `[47115, 48648]`, touching only at the
  boundary. So the base's own edges never straddle a placement's y and
  contribute nothing geometrically — 62 of 238 vertices (26%) are pure loop cost.
  On the large fixture it's 314 of 684 (46%).

  **But you can't just drop the base.** Sampling 20,000 points in the valid band,
  live-zone-only containment disagrees with base+live on **7.9%** of them. Ray
  casting needs a closed ring, and the junction edges joining the base array to
  the live-zone array *do* straddle the band — so removing the base changes the
  ring topology and therefore the answer, even though the base's own edges are
  irrelevant.

  Possible fixes, roughly in order of effort:
  - Replace ray-casting with a scanline/height-field test — "is y below the
    surface at x?" `verticesToScanlines` already exists in
    `shared/heapPolygon/polygon.ts:161` and the client already thinks this way
    (`getSurfaceYAtX`). Topology-independent, so the base falls out naturally,
    and it's O(log n) or O(1) with an index instead of O(n).
  - Cache a precomputed "upper base" slice alongside the base snapshot, so the
    ring stays closed but stops growing without bound.
  - At minimum, hoist the `JSON.parse(live_zone)` out of the CAS retry loop.

  Worth measuring before building: run `npm run loadtest -- -e PLACE_FIXTURE=large`
  against `-e PLACE_FIXTURE=small` and compare `place-contention` p95 plus CPU
  time in `wrangler tail --env staging`. 238 vs 684 vertices is a ~2.9x spread.

- **Batch or threshold the heap cache invalidation on placement.** Every accepted
  placement busts `cache:heap:{id}` and `cache:heap:list`, so the next reader
  falls through to D1. That's what makes `heap-get` bimodal: p50 97ms (cache hit)
  vs p95 513ms (miss → D1), a 5x tail, and it degrades reads for *every* player
  whenever *any* player is placing.

  Idea to explore: don't invalidate on every placement. Invalidate only when the
  cached copy is more than X vertices behind, or when the live zone crosses a
  size threshold — otherwise let the 60s TTL expire naturally. Players would see
  a heap up to 60s stale, which we've already accepted as tolerable for a
  non-live-service game (see the KV-exhaustion discussion).

  Watch out for: `version` is part of the cached row, and the client uses it to
  decide whether to refetch (`{ changed: false }`). A stale cached version means
  clients think they're current and skip the fetch, so staleness could persist
  past the TTL from the client's point of view. Needs thinking through, and
  possibly a separate always-fresh version endpoint.

  This also directly reduces KV delete spend, which is the tightest quota
  (1,000/day, account-wide, shared with prod).

- **[HANDED OFF] Delta API + bounded polygon growth.** Brief written up at
  `docs/superpowers/2026-07-26-heap-delta-api-handoff.md`, ready for
  brainstorming → spec → plan. Supersedes the two items below, which are kept
  for context. Root cause identified: the base polygon is append-only
  (`newBaseVertices = [...existingBase, ...frozen]`) and never shrinks, so a
  cheaper containment scan only delays hitting the CPU cap rather than
  preventing it. Bounding growth via simplification at rollup is the primary
  goal; the delta API is secondary but shares the same restructuring.

- **Make `GET /heaps/:id` return a delta, not the whole polygon.** Peak-load
  egress went 8.1MB → 15MB between two runs purely because the heap grew. The
  endpoint returns the entire live zone, once per session, to every player — so
  it scales with heap size against the whole player base, not just the ~1% who
  place blocks. It already version-gates with `{ changed: false }`; what's
  missing is a "vertices since version N" response for the changed case.

  Larger refactor: touches the client's cache/reconstruction path
  (`HeapClient`, `HeapPolygonLoader`) as well as the server, and needs a story
  for clients that are many versions behind or have a stale `baseId`. Worth its
  own spec before any code. Would also cut the `JSON.parse` cost that likely
  explains much of the +40ms placement latency on the large fixture.

- **CAS contention exhausts its retry budget under load.** 15 VUs placing on one
  heap gave 28% of resolved attempts returning 409 after all 5 retries (36% on
  the large fixture). The database isn't struggling — the retry count is the
  binding constraint, and it's coupled to the containment-check cost above:
  a slower scan holds the read-to-write window open longer, so more placements
  lose the race. Fixing the scan should reduce conflicts for free.

  Structural alternative if it stays a problem: the live zone is a single JSON
  blob, so two concurrent placements inherently conflict. Storing vertices as
  rows would make concurrent placements independent INSERTs with no CAS at all —
  but that's a schema change with wide blast radius.

### Stretch goals 
-finish todo_inprogress
