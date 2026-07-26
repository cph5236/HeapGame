## FEATURES

- Play Integrity API
Integration not started
Call the Integrity API at important moments in your app to check that it's your app binary, installed by Google Play, running on a genuine Android device. Your app's backend server can decide what to do next to prevent abuse, unauthorized access, and attacks. 

- The claw elevator.

Language detection?

Improve Admin UI - add drop down to switch ENVS + add envs

### UI

### ENEMIES
-   Jumper cables - spawn on walls and extend in and out slightly, if player touches them, player stunned loses controls

### PERF — from load testing (2026-07-26)

- **`/place` containment check scans the whole polygon, most of which can't matter.**
  `POST /heaps/:id/place` builds `[...baseVertices, ...liveZone]` and ray-casts
  `isPointInside` over all of it, up to 5x in the CAS retry loop, plus a
  `JSON.parse` of the live zone per attempt. Free tier caps CPU at 10ms/request.

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

- **CAS contention exhausts its retry budget under load.** First staging run:
  15 VUs placing on one heap gave 18 accepted / 7 conflicts — **28%** of resolved
  attempts 409'd after all 5 retries. Fine for current traffic, but the retry
  count is the binding constraint if a heap ever gets popular.

- **Read latency is coupled to placement rate.** `heap-get` p90 was 152ms but p95
  was 513ms — bimodal, because each accepted placement invalidates the cache and
  forces the next reader through to D1. More placement activity means slower
  reads for everyone.

### Stretch goals 
-finish todo_inprogress
