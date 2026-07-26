// k6 entrypoint. Scenario volumes use the shared-iterations executor so that
// total request count is known BEFORE the run starts, rather than being
// discovered when a runtime guard trips. Free-tier quotas are account-wide and
// shared with production — see loadtest/README.md.
//
// Real per-iteration request counts (see journey.js / placement.js headers for
// the derivation):
//   - journey():   8 mandatory requests + ~0.35 expected from probabilistic
//                  branches ≈ 8.3-8.5 requests/iteration in steady state,
//                  plus one extra heap-base fetch per VU on its first
//                  iteration only.
//   - placement(): 3 requests/iteration (GET /heaps, GET /heaps/:id, POST
//                  .../place) — so a 30-iteration run is 90 requests, not 30.
//   - limiter():   1 request/iteration, no budget (see limiter.js header).

import http from 'k6/http';
import { SharedArray } from 'k6/data';
import { createBudget } from './lib/budget.js';
import { numEnv } from './lib/config.js';
import { journey } from './scenarios/journey.js';
import { placement } from './scenarios/placement.js';
import { limiter } from './scenarios/limiter.js';

/* global __ENV */

// 409 (CAS conflict under contention) and 429 (rate limited) are designed
// outcomes of this harness, not failures. Declaring them expected is what
// makes the http_req_failed threshold below meaningful — k6 defines
// http_req_failed as the complement of the expected/actual status match, so
// filtering THAT metric by `expected_response:true` (an earlier version of
// this file did) selects exactly the population that can never contain a
// failure: a vacuous threshold that reads 0% and can never fire, even
// through a total 5xx outage. This runs once per VU during that VU's init
// phase (see k6's test-lifecycle docs) and applies to every http.* call made
// from that VU afterwards, including calls made from the imported scenario
// modules — 'k6/http' is the same module instance within one VU's runtime,
// so setting the callback here reaches journey.js/placement.js/limiter.js's
// own http.get/http.post calls without them needing to opt in individually.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409, 429));

const SESSIONS = numEnv(__ENV.SESSIONS, 800);
const MAX_PLACEMENTS = numEnv(__ENV.MAX_PLACEMENTS, 150);

// k6's shared-iterations executor requires iterations >= vus (it hands out at
// least one iteration per VU up front). 50 is the right VU count at the
// default SESSIONS=800, but loadtest:local's SESSIONS=20 would be below that
// and fail to start at all — cap journey's VU count to SESSIONS itself for
// small dry runs rather than hardcoding 50.
const JOURNEY_VUS = Math.min(50, SESSIONS);

// The placement scenario has the same iterations >= vus constraint, and its
// canPlace() gate makes it worse than journey's: placement() returns
// immediately when the budget is exhausted (see placement.js), so a per-VU
// placement cap below 1 doesn't just under-count — it silently no-ops the
// rest of that VU's iterations entirely for the whole run. Scaling both the
// iteration count AND the VU count down with MAX_PLACEMENTS (rather than
// leaving them at fixed 30/15) keeps the per-VU budget (below) at >= 1 no
// matter how small MAX_PLACEMENTS is set for a local dry run.
// Defaults cap at 30/15, which is the realistic-contention shape. Both are
// overridable because measuring CPU per placement needs a different shape:
// a bigger sample (the dashboard aggregates CPU per minute, so 30 placements
// diluted among ~6,800 requests is invisible) and LOW concurrency (at 15 VUs
// the CAS retry loop re-runs the polygon scan several times per request, which
// conflates base cost with retry amplification).
//
//   base cost:        -e PLACEMENT_ITERATIONS=200 -e PLACEMENT_VUS=1
//   under contention: -e PLACEMENT_ITERATIONS=200 -e PLACEMENT_VUS=15
const PLACEMENT_ITERATIONS = Math.max(
  1,
  numEnv(__ENV.PLACEMENT_ITERATIONS, Math.min(30, MAX_PLACEMENTS)),
);
const PLACEMENT_VUS = Math.max(
  1,
  Math.min(numEnv(__ENV.PLACEMENT_VUS, 15), PLACEMENT_ITERATIONS),
);

const fixtures = new SharedArray('fixtures', () => [JSON.parse(open('../fixtures.json'))]);

export const options = {
  scenarios: {
    journey: {
      executor: 'shared-iterations',
      vus: JOURNEY_VUS,
      iterations: SESSIONS,
      maxDuration: '10m',
      exec: 'journeyScenario',
    },
    placement: {
      executor: 'shared-iterations',
      vus: PLACEMENT_VUS,
      iterations: PLACEMENT_ITERATIONS,
      maxDuration: '5m',
      startTime: '30s',
      exec: 'placementScenario',
    },
    limiter: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 20,
      maxDuration: '2m',
      startTime: '10s',
      exec: 'limiterScenario',
    },
  },
  thresholds: {
    // Meaningful now that expected statuses are declared above: this reads
    // the real failure rate (genuine 4xx/5xx), not a metric pre-filtered
    // down to nothing.
    'http_req_failed':                         ['rate<0.01'],
    'http_req_duration{name:heaps-list}':      ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:heap-get}':        ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:scores-context}':  ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:place}':           ['p(95)<1000'],
    'http_req_duration{name:place-contention}':['p(95)<1000'],
  },
};

// Per-VU budget: k6 VUs do not share module state, so divide the global caps
// by the scenario's VU count. This is a redundant safety net, not the
// primary control — the authoritative global bound is each scenario's
// `iterations` above, which is fixed before the run starts. Both divisors
// are wrapped in Math.max(1, Math.ceil(...)): a cap that rounds down to 0
// permanently blocks a VU's canPlace() gate after its very first placement
// (0 is never < a value at or below 0), which is exactly how the placement
// scenario silently ran at roughly half its configured volume before this
// fix — a VU that placed once had placements=1, which was not < its
// fractional per-VU cap, and canPlace() then blocked it for every remaining
// iteration. journey's placement gate is probabilistic rather than a
// blanket early-return, so the same fractional-cap issue there was a
// smaller under-count rather than a rest-of-run no-op, but the guard is
// applied here too so it can't happen at all.
const journeyBudget = createBudget({
  maxRequests:   Math.max(1, Math.ceil(10_000 / JOURNEY_VUS)),
  maxPlacements: Math.max(1, Math.ceil(MAX_PLACEMENTS / JOURNEY_VUS)),
});
// An explicit -e PLACEMENT_ITERATIONS must not be silently throttled by the
// MAX_PLACEMENTS default: asking for 200 iterations is asking for 200
// placements. The executor's `iterations` remains the authoritative bound, so
// taking the larger of the two keeps this a backstop rather than a second,
// conflicting limit that turns the excess into silent no-ops.
const placementBudget = createBudget({
  maxRequests:   Math.max(1, Math.ceil(10_000 / PLACEMENT_VUS)),
  maxPlacements: Math.max(1, Math.ceil(Math.max(MAX_PLACEMENTS, PLACEMENT_ITERATIONS) / PLACEMENT_VUS)),
});

export function journeyScenario()   { journey(fixtures[0], journeyBudget); }
export function placementScenario() { placement(fixtures[0], placementBudget); }
export function limiterScenario()   { limiter(fixtures[0]); }
