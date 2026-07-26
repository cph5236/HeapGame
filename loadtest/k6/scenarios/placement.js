// Bounded placement contention: a realistic handful of concurrent placers on
// ONE heap, to drive the CAS retry loop in routes/heap.ts and measure how
// often it exhausts its 5 attempts and returns 409.
//
// Deliberately small. Real players do not all place simultaneously, and each
// successful placement costs KV deletes from a 1,000/day account-wide bucket.
//
// The design brief's original draft of this scenario sent a fixed
// `x: rand(-200,200), y: 0` placement. That's wrong on two counts caught in
// journey.js's own review (task-10-report.md): (1) POST /heaps/:id/place
// validates x against PLACE_X_MIN/PLACE_X_MAX = [120, 840], not a window
// centered on 0, so a negative x always 400s; (2) `y: 0` is above the
// heap's summit (top_y starts north of 0 and only grows), so it always
// fails the `y >= top_y - PLACE_HEIGHT_GRACE_PX` check too. Both would
// silently turn "placement contention" into "placement always 400s" and
// the CAS loop this scenario exists to exercise would never run.
//
// This scenario hammers a single long-lived fixture heap with many
// concurrent VUs by design (that's the "contention" in the name), which
// makes journey.js's live-derivation approach even more necessary here than
// there: topY and the live zone shift every time *any* VU's placement is
// accepted, so a window computed once and reused across iterations/VUs
// would go stale within a couple of accepted placements and start drawing
// 400s instead of exercising the CAS retry loop. Mirrors journey.js's
// pickPlacement() (itself mirroring loadtest/scripts/seed-staging.ts):
// read topY off GET /heaps' summary list and the live zone off GET
// /heaps/:id, both fetched fresh this iteration, then pick (x, y) inside
// the window those two values imply. journey.js doesn't export
// pickPlacement, so the formula is duplicated here rather than imported —
// same shape, kept in sync manually (see server/src/routes/heap.ts
// ~line 403 on for the authoritative checks).

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, loadTestHeaders } from '../lib/config.js';
import { pickIdentity } from '../lib/player.js';
import { buildPlaceBody } from '../lib/payloads.js';

/* global __VU, __ITER, __ENV */

export const casConflicts = new Counter('cas_conflicts');
export const casAccepted  = new Counter('cas_accepted');

/** Which fixture to hammer: 'small' (default) or 'large' to measure how
 *  placement cost scales with polygon size against the 10ms CPU cap. */
const FIXTURE = __ENV.PLACE_FIXTURE || 'small';

// Mirror of server/src/routes/heap.ts's module-local placement-validation
// constants (not exported, not in server/src/constants.ts — see journey.js's
// header comment for the same caveat). Keep in sync if the route changes.
const WORLD_WIDTH           = 960; // mirror of src/constants.ts WORLD_WIDTH
const PLACE_X_MIN           = WORLD_WIDTH * 0.125; // 120
const PLACE_X_MAX           = WORLD_WIDTH * 0.875; // 840
const PLACE_HEIGHT_GRACE_PX = 200;
const HEAP_TOP_ZONE_PX      = 300;

// worldHeight is deliberately not read/enforced here, same as journey.js's
// pickPlacement: the fixture heap is generated near the *bottom* of its
// (huge) worldHeight, so topY + HEAP_TOP_ZONE_PX never gets close to it and
// that check never binds in practice.
function pickPlacement(topY, liveZone) {
  const x = PLACE_X_MIN + Math.random() * (PLACE_X_MAX - PLACE_X_MIN);
  const yLow  = Math.max(0, topY - PLACE_HEIGHT_GRACE_PX);
  const yHigh = liveZone.length > 0
    ? liveZone.reduce((max, v) => (v.y > max ? v.y : max), -Infinity)
    : topY + HEAP_TOP_ZONE_PX;
  const y = yLow + Math.random() * Math.max(0, yHigh - yLow);
  return { x, y };
}

export function placement(fixtures, budget) {
  if (!budget.canPlace()) return;

  const id = pickIdentity(fixtures.identities, __VU, __ITER);
  const heapId = FIXTURE === 'large' ? fixtures.largeHeapId : fixtures.smallHeapId;
  const lt = loadTestHeaders(`vu-${__VU}`);

  // Live window read, same two calls journey.js makes during boot — reused
  // here per-iteration (not once per VU) because this scenario's whole
  // point is many VUs racing placements on the same heap, so the window
  // must be as fresh as possible right before each attempt.
  const listRes = http.get(`${BASE_URL}/heaps`, { headers: lt, tags: { name: 'heaps-list' } });
  budget.recordRequest();
  const heapRes = http.get(`${BASE_URL}/heaps/${heapId}`, { headers: lt, tags: { name: 'heap-get' } });
  budget.recordRequest();

  let topY = null;
  if (listRes.status === 200) {
    try {
      const list = listRes.json();
      const summary = (list.heaps || []).find((h) => h.id === heapId);
      if (summary) topY = summary.topY;
    } catch { /* malformed body — topY stays null */ }
  }
  // Without a live topY there's no safe window to place into — bail rather
  // than guess and draw a guaranteed 400 that would pollute the CAS-conflict
  // metrics this scenario exists to measure.
  if (topY === null) return;

  let liveZone = [];
  if (heapRes.status === 200) {
    try {
      const body = heapRes.json();
      if (body.changed) liveZone = body.liveZone || [];
    } catch { /* malformed body — liveZone stays empty */ }
  }

  const { x, y } = pickPlacement(topY, liveZone);
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'X-Player-Token': id.playerSecret },
    lt,
  );
  const body = buildPlaceBody({ x, y, playerGuid: id.playerId });

  const res = http.post(`${BASE_URL}/heaps/${heapId}/place`, JSON.stringify(body), {
    headers, tags: { name: 'place-contention' },
  });
  // A placement is both a placement (the scarce KV-affecting resource) and
  // an ordinary HTTP request — budget.exceeded() only reads the request
  // counter, so both must be recorded or this scenario's real request
  // volume is invisible to the account-wide quota safety net (same fix
  // journey.js needed in task-10 review; see task-10-report.md).
  budget.recordRequest();
  budget.recordPlacement();

  // /place returns HTTP 200 for both accepted and legitimately-rejected
  // (point already inside the polygon) placements — only the JSON body's
  // `accepted` field distinguishes them, so status alone can't drive
  // casAccepted. 409 is reserved for exhausted CAS retries under
  // contention, which is exactly what this scenario is trying to provoke.
  if (res.status === 409) {
    casConflicts.add(1);
  } else if (res.status === 200) {
    try {
      if (res.json().accepted) casAccepted.add(1);
    } catch { /* malformed body — not counted as accepted */ }
  }
  check(res, {
    'placement not 5xx': (r) => r.status < 500,
    'placement resolved': (r) => r.status === 200 || r.status === 409 || r.status === 400,
  });
}
