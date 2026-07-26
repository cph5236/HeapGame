// Per-run budget counters.
//
// k6's shared-iterations executor already bounds total volume before the run
// starts; this is the safety net that stops a misconfigured run from spending
// production's account-wide daily quota. Placements are tracked separately
// because KV deletes (1,000/day) are the tightest resource, not requests.

export function createBudget({ maxRequests, maxPlacements }) {
  let requests = 0;
  let placements = 0;

  return {
    recordRequest() { requests += 1; },
    recordPlacement() { placements += 1; },
    /** Placements are the scarce resource — gate them separately. */
    canPlace() { return placements < maxPlacements; },
    exceeded() { return requests >= maxRequests; },
    snapshot() { return { requests, placements, maxRequests, maxPlacements }; },
  };
}

// Note: k6 VUs do not share module state across VU instances, so this
// counter is per-VU. Task 11 divides the caps by the VU count when
// constructing it, and the authoritative global bound remains the
// executor's `iterations` setting.
