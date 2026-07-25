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
//                  .../place) — so the 30-iteration default below is 90
//                  requests, not 30. iterations=30 is chosen to match the
//                  design spec's placement-scenario budget of 30 placements
//                  (120 from journey + 30 here = the 150 global placement
//                  cap), not to match a request count.
//   - limiter():   1 request/iteration, no budget (see limiter.js header).

import { SharedArray } from 'k6/data';
import { createBudget } from './lib/budget.js';
import { journey } from './scenarios/journey.js';
import { placement } from './scenarios/placement.js';
import { limiter } from './scenarios/limiter.js';

/* global __ENV */

const SESSIONS = Number(__ENV.SESSIONS || 800);
const MAX_PLACEMENTS = Number(__ENV.MAX_PLACEMENTS || 150);

// k6's shared-iterations executor requires iterations >= vus (it hands out at
// least one iteration per VU up front). 50 is the right VU count at the
// default SESSIONS=800, but loadtest:local's SESSIONS=20 would be below that
// and fail to start at all — cap journey's VU count to SESSIONS itself for
// small dry runs rather than hardcoding 50.
const JOURNEY_VUS = Math.min(50, SESSIONS);

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
      vus: 15,
      iterations: 30,
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
    // 409 (CAS conflict) and 429 (rate limited) are expected outcomes, not failures.
    'http_req_failed{expected_response:true}': ['rate<0.01'],
    'http_req_duration{name:heaps-list}':      ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:heap-get}':        ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:scores-context}':  ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:place}':           ['p(95)<1000'],
    'http_req_duration{name:place-contention}':['p(95)<1000'],
  },
};

// Per-VU budget: k6 VUs do not share module state, so divide the global caps by
// the scenario's VU count. This is a redundant safety net, not the primary
// control — the authoritative global bound is each scenario's `iterations`
// above, which is fixed before the run starts. Dividing 10,000 (the run's
// overall request ceiling) by each scenario's own VU count is deliberately
// generous headroom rather than a tight per-scenario slice: journey's real
// steady-state usage is ~135 requests/VU (16 iterations/VU * ~8.4/iteration)
// against a 200/VU cap, and placement's real usage is ~6 requests/VU (2
// iterations/VU * 3/iteration) against a ~667/VU cap. Both caps only exist to
// catch a runaway bug (e.g. an infinite retry loop), not to shape normal
// volume — normal volume is shaped entirely by `iterations` + the scenario
// bodies' own probabilities.
const journeyBudget   = createBudget({ maxRequests: 10_000 / JOURNEY_VUS, maxPlacements: MAX_PLACEMENTS / JOURNEY_VUS });
const placementBudget = createBudget({ maxRequests: 10_000 / 15, maxPlacements: MAX_PLACEMENTS / 15 });

export function journeyScenario()   { journey(fixtures[0], journeyBudget); }
export function placementScenario() { placement(fixtures[0], placementBudget); }
export function limiterScenario()   { limiter(fixtures[0]); }
