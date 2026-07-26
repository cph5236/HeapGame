// Confirms the rate limiter still protects production behaviour: requests
// sent WITHOUT the load-test headers all share one IP bucket and must start
// returning 429 once RL_GLOBAL (300/min) is exhausted.
//
// Cheap by design — a few dozen requests, not a load profile.
//
// No `budget` parameter, unlike journey() and placement(). That's
// deliberate, not an oversight: this scenario's own executor config already
// caps it at a fixed, tiny iteration count (main.js: 1 VU x 20 iterations),
// so there's nothing for a per-run budget to gate here. More importantly,
// `budget` in this harness specifically tracks the account-wide production
// quota that load-test-keyed traffic (journey/placement) draws down —
// limiter's requests are intentionally the opposite of that traffic (no
// load-test key at all, see below), so folding them into the same counter
// would conflate "quota this harness is deliberately spending" with "quota
// this probe is deliberately NOT trying to spend." Confirmed against the
// design plan's main.js draft (docs/superpowers/plans/2026-07-24-load-testing.md),
// which already wires `limiter(fixtures[0])` with no budget argument.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL } from '../lib/config.js';

export const limiterBlocks = new Counter('limiter_blocks');

export function limiter(fixtures) {
  // Deliberately NOT calling loadTestHeaders() / importing it from
  // config.js. Every other scenario sends X-LoadTest-Secret +
  // X-LoadTest-Key so the Worker's rate limiter buckets each VU as its own
  // synthetic client (see config.js) — that's what lets journey/placement
  // run at load-test volume without tripping the limiter meant for real
  // per-IP traffic. This scenario exists specifically to check that the
  // *unmodified* production limiter still works, so it must look exactly
  // like un-keyed real traffic: same shared bucket, no bypass. Do not "fix"
  // this by adding loadTestHeaders() here — that would defeat the scenario.
  const res = http.get(`${BASE_URL}/heaps/${fixtures.smallHeapId}`, {
    tags: { name: 'limiter-probe' },
  });
  if (res.status === 429) limiterBlocks.add(1);
  check(res, { 'limiter probe answered': (r) => r.status === 200 || r.status === 429 });
}
