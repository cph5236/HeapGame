// The realistic player session: boot, load a heap, read the leaderboard, play a
// run, submit a score. Endpoint mix and ordering mirror what the game client
// actually does (src/systems/*Client.ts). 8 mandatory requests per iteration
// (4 boot-batch + heap-get + scores-context + score-submit + log), plus ~0.35
// in expectation across the three probabilistic branches (place ~15%,
// customization-put ~10%, daily-claim ~10%), plus one extra heap-base fetch
// on each VU's very first iteration only — ~8.3-8.5 requests/iteration in
// steady state, not 10.
//
// Every request shape below was checked against its route handler in
// server/src/routes/*.ts, not copied from the original design brief — see
// .superpowers/sdd/2026-07-24-load-testing/task-10-report.md for the full
// discrepancy table. The corrections that matter most if you're diffing
// against an older draft of this file:
//   - GET /daily/status and POST /daily/claim key the player on `playerGuid`,
//     not `playerId` (server/src/routes/daily.ts:41,59).
//   - POST /heaps/:id/place needs an (x, y) inside the heap's *current*
//     placement window, which this file reads off two of the boot/heap-load
//     responses rather than guessing constants — see pickPlacement() below
//     and loadtest/scripts/seed-staging.ts, which solves the same problem at
//     heap-creation time.
//   - buildLogBody's `level` must be 'event' (not 'info' — invalid, would be
//     silently normalized away by payloads.js).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { BASE_URL, loadTestHeaders } from '../lib/config.js';
import { pickIdentity } from '../lib/player.js';
import { buildPlaceBody, buildScoreBody, buildLogBody } from '../lib/payloads.js';

/* global __VU, __ITER, __ENV */

export const placeConflicts = new Counter('place_conflicts');
export const placeAccepted   = new Counter('place_accepted');
export const rateLimited     = new Rate('rate_limited');

/** Probability a session places a block. Real players place rarely. */
const PLACE_RATE = Number(__ENV.PLACE_RATE || 0.15);

// Mirrors the placement-validation window in server/src/routes/heap.ts
// (POST /:id/place, ~line 403 on). PLACE_X_MIN/PLACE_X_MAX/
// PLACE_HEIGHT_GRACE_PX/HEAP_TOP_ZONE_PX are module-local consts there (not
// exported, and not in server/src/constants.ts, which only holds
// MAX_ID_LEN) so they're re-derived here — same approach as
// loadtest/scripts/seed-staging.ts. Keep in sync if the route changes.
const WORLD_WIDTH            = 960; // mirror of src/constants.ts WORLD_WIDTH
const PLACE_X_MIN            = WORLD_WIDTH * 0.125; // 120
const PLACE_X_MAX            = WORLD_WIDTH * 0.875; // 840
const PLACE_HEIGHT_GRACE_PX  = 200;
const HEAP_TOP_ZONE_PX       = 300;

// Mirror of server/src/routes/scores.ts's module-local MAX_CLIMB_RATE_Y_PER_S
// (not exported). Used to bound baseHeightPx on the score submit below.
const MAX_CLIMB_RATE_Y_PER_S = 400;

function jsonHeaders(extra) {
  return Object.assign({ 'Content-Type': 'application/json' }, extra || {});
}

function track(res) {
  rateLimited.add(res.status === 429);
  return res;
}

/**
 * Picks a placement inside the heap's currently-legal window.
 *
 * Unlike seed-staging.ts — which creates its heap fresh and so knows topY
 * and the (empty) live zone up front — this scenario runs against a
 * long-lived fixture heap that other VUs are concurrently growing, so both
 * inputs are read live off this iteration's own responses: `topY` from the
 * `GET /heaps` list entry (HeapSummary.topY), `liveZone` from `GET
 * /heaps/:id` (only present when the response is `{ changed: true, ... }`,
 * which it always is here since this scenario never sends `?version=`).
 * The (x, y) formula itself mirrors heap.ts's four placement checks:
 *   x in [PLACE_X_MIN, PLACE_X_MAX]
 *   y in [topY - PLACE_HEIGHT_GRACE_PX, liveZoneBottomY]
 * where liveZoneBottomY is the running max y already placed (or
 * topY + HEAP_TOP_ZONE_PX while the live zone is still empty).
 *
 * @param {number} topY
 * @param {Array<{x: number, y: number}>} liveZone
 * @returns {{x: number, y: number}}
 */
function pickPlacement(topY, liveZone) {
  const x = PLACE_X_MIN + Math.random() * (PLACE_X_MAX - PLACE_X_MIN);
  const yLow  = Math.max(0, topY - PLACE_HEIGHT_GRACE_PX);
  const yHigh = liveZone.length > 0
    ? liveZone.reduce((max, v) => (v.y > max ? v.y : max), -Infinity)
    : topY + HEAP_TOP_ZONE_PX;
  const y = yLow + Math.random() * Math.max(0, yHigh - yLow);
  return { x, y };
}

export function journey(fixtures, budget) {
  const vuKey = `vu-${__VU}`;
  const lt = loadTestHeaders(vuKey);
  const id = pickIdentity(fixtures.identities, __VU, __ITER);
  const heapId = fixtures.smallHeapId;

  // ---- boot ----
  // GET /daily/status and GET /customization/:playerId are both public reads
  // (no enforcePlayerAuth call in their handlers) — no player token needed.
  const boot = http.batch([
    ['GET', `${BASE_URL}/config`, null, { headers: lt, tags: { name: 'config' } }],
    ['GET', `${BASE_URL}/heaps`, null, { headers: lt, tags: { name: 'heaps-list' } }],
    ['GET', `${BASE_URL}/daily/status?playerGuid=${id.playerId}`, null, { headers: lt, tags: { name: 'daily-status' } }],
    ['GET', `${BASE_URL}/customization/${id.playerId}`, null, { headers: lt, tags: { name: 'customization-get' } }],
  ]);
  boot.forEach((r) => { track(r); budget.recordRequest(); });
  check(boot[1], { 'heaps list ok': (r) => r.status === 200 });

  // Current summit (topY) and climbable world height (params.worldHeight)
  // for our heap, off the list response's HeapSummary — needed below both to
  // pick a legal placement window and to bound baseHeightPx on the score
  // submit (scores.ts rejects baseHeightPx > (worldHeight - topY) + grace,
  // and the heap sits near the *bottom* of its worldHeight, so that gap is
  // only ~1-2kpx, not the multi-million-px worldHeight itself). null (not 0)
  // when unavailable, so a failed/odd boot response skips placement rather
  // than sending a placement guaranteed to 400 against a nonsense window;
  // baseHeightPx falls back to a small constant instead (see below) since
  // score-submit is not optional like placement is.
  let topY = null;
  let worldHeight = null;
  if (boot[1].status === 200) {
    try {
      const list = boot[1].json();
      const summary = (list.heaps || []).find((h) => h.id === heapId);
      if (summary) {
        topY = summary.topY;
        worldHeight = summary.params && summary.params.worldHeight;
      }
    } catch { /* malformed body — topY/worldHeight stay null */ }
  }

  // ---- heap load ----
  const heapRes = track(http.get(`${BASE_URL}/heaps/${heapId}`, { headers: lt, tags: { name: 'heap-get' } }));
  budget.recordRequest();
  check(heapRes, { 'heap get ok': (r) => r.status === 200 });

  let liveZone = [];
  if (heapRes.status === 200) {
    try {
      const body = heapRes.json();
      if (body.changed) liveZone = body.liveZone || [];
    } catch { /* malformed body — liveZone stays empty */ }
  }

  // The client caches base vertices in localStorage keyed by baseId, so it
  // fetches them once per VU rather than once per session.
  if (__ITER === 0) {
    track(http.get(`${BASE_URL}/heaps/${heapId}/base`, { headers: lt, tags: { name: 'heap-base' } }));
    budget.recordRequest();
  }

  // ---- leaderboard ----
  // scores.ts's GET /:heapId/context reads the player key off `?playerId=`
  // (unlike /daily/status, which uses `?playerGuid=` — confirmed against
  // scores.ts:333 vs daily.ts:41; two routes, two different query names).
  track(http.get(`${BASE_URL}/scores/${heapId}/context?playerId=${id.playerId}`, {
    headers: lt, tags: { name: 'scores-context' },
  }));
  budget.recordRequest();

  sleep(Math.random() * 2); // think time: the player is climbing

  // ---- placement (rare) ----
  if (Math.random() < PLACE_RATE && budget.canPlace() && topY !== null) {
    const authed = jsonHeaders(Object.assign({ 'X-Player-Token': id.playerSecret }, lt));
    const { x, y } = pickPlacement(topY, liveZone);
    const body = buildPlaceBody({ x, y, playerGuid: id.playerId });
    const res = track(http.post(`${BASE_URL}/heaps/${heapId}/place`, JSON.stringify(body), {
      headers: authed, tags: { name: 'place' },
    }));
    // A placement is both a placement (the scarce KV-affecting resource) and
    // an ordinary HTTP request — budget.exceeded() only reads the request
    // counter, so it must be incremented here too or ~15% of iterations'
    // real requests are invisible to the account-wide quota safety net.
    budget.recordRequest();
    budget.recordPlacement();
    check(res, { 'place not 5xx': (r) => r.status < 500 });
    // /place returns HTTP 200 for both accepted and legitimately-rejected
    // (point already inside the polygon) placements — only the JSON body's
    // `accepted` field distinguishes them, so status alone can't drive this
    // counter. 409 is reserved for exhausted CAS retries under contention.
    if (res.status === 409) {
      placeConflicts.add(1);
    } else if (res.status === 200) {
      try {
        if (res.json().accepted) placeAccepted.add(1);
      } catch { /* malformed body — not counted as accepted */ }
    }
  }

  // ---- end of run ----
  const authed = jsonHeaders(Object.assign({ 'X-Player-Token': id.playerSecret }, lt));

  const elapsedMs = 20_000 + Math.floor(Math.random() * 40_000);

  // scores.ts:208-216 rejects baseHeightPx > (worldHeight - topY) + 200. The
  // heap is generated near the *bottom* of its (huge) worldHeight, so that
  // ceiling is small (empirically ~1400-1700px for a freshly seeded fixture)
  // — sampling uniformly out of a flat [0, 4000) range 400s the majority of
  // submissions. scores.ts:219-226 separately rejects baseHeightPx*1000 >
  // MAX_CLIMB_RATE_Y_PER_S*elapsedMs (an implied climb-rate cap independent
  // of the heap-height check). Bound baseHeightPx by the tighter of the two:
  // the heap's actual current climbable height (read fresh each iteration,
  // same topY/worldHeight as the placement window above — falls back to a
  // small constant safely under the observed floor when either is
  // unreadable, since unlike placement, score-submit runs every iteration
  // and isn't optional) and this iteration's own climb-rate ceiling — the
  // latter guards against a long-running test having grown the fixture heap
  // enough that the heap-height bound alone would stop being safe.
  const maxByHeapHeight = (topY !== null && worldHeight !== null)
    ? Math.max(1, worldHeight - topY)
    : 1000;
  const maxByClimbRate = Math.floor(MAX_CLIMB_RATE_Y_PER_S * elapsedMs / 1000);
  const baseHeightPx = Math.floor(Math.random() * Math.max(1, Math.min(maxByHeapHeight, maxByClimbRate)));

  // Kill-rate cap (MAX_KILLS_PER_S = 1) needs no such clamp: at most 3 kills
  // (2 percher + 1 ghost; jumper omitted) over a minimum 20s window is
  // 0.15/s, comfortably under 1/s regardless of the random draws below.
  const scoreBody = buildScoreBody({
    heapId,
    playerId: id.playerId,
    playerName: `LoadTest ${__VU}`,
    elapsedMs,
    kills: { percher: Math.floor(Math.random() * 3), ghost: Math.floor(Math.random() * 2) },
    baseHeightPx,
    isFailure: Math.random() < 0.7,
  });
  const scoreRes = track(http.post(`${BASE_URL}/scores`, JSON.stringify(scoreBody), {
    headers: authed, tags: { name: 'score-submit' },
  }));
  budget.recordRequest();
  check(scoreRes, { 'score not 5xx': (r) => r.status < 500 });

  track(http.post(`${BASE_URL}/log`, JSON.stringify(buildLogBody({
    level: 'event', event: 'loadtest:session', data: { vu: __VU, iter: __ITER },
  })), { headers: jsonHeaders(lt), tags: { name: 'log' } }));
  budget.recordRequest();

  // ---- occasional writes ----
  if (Math.random() < 0.1) {
    // PUT /customization/:playerId body is `{ loadout }` (confirmed against
    // src/systems/CustomizationClient.ts, the real client caller). An empty
    // loadout (`{}`) does pass validateLoadout (shared/cosmeticCatalog.ts —
    // it just loops zero times over Object.entries({})), but a real
    // equip-write carries actual slot ids, so this uses a small valid
    // loadout to exercise the per-slot catalog lookup instead of a no-op.
    track(http.put(`${BASE_URL}/customization/${id.playerId}`, JSON.stringify({
      loadout: { hat: 'hat_cone', tie: 'tie_red' },
    }), {
      headers: authed, tags: { name: 'customization-put' },
    }));
    budget.recordRequest();
  }
  if (Math.random() < 0.1) {
    // POST /daily/claim body key is `playerGuid` (server/src/routes/daily.ts:59),
    // not `playerId`.
    track(http.post(`${BASE_URL}/daily/claim`, JSON.stringify({ playerGuid: id.playerId }), {
      headers: authed, tags: { name: 'daily-claim' },
    }));
    budget.recordRequest();
  }
}
