# Runbook — load-test staging Worker

The staging Worker (`heap-server-staging`) exists so load tests never touch
production data. It is a full second deployment: its own D1 shards, KV
namespace, and Analytics Engine dataset.

> **Cloudflare free-tier daily quotas are ACCOUNT-WIDE, not per-Worker.**
> A run against staging still spends production's budget: 100,000 Workers
> requests/day, 100,000 KV reads, 1,000 KV writes, 1,000 KV deletes.
> See `loadtest/README.md` for the per-run budget.

## Resources

Provisioned 2026-07-25. IDs are recorded in `server/wrangler.toml`'s
`[env.staging]` block.

| Resource | Name |
|---|---|
| Worker | `heap-server-staging` |
| D1 | `heap_core_staging` |
| D1 | `heap_scores_staging` |
| D1 | `heap_rewards_staging` |
| D1 | `heap_telemetry_staging` |
| KV | `CACHE_STAGING` |
| Analytics Engine | `heap_logs_staging` |

The Analytics Engine dataset is deliberately separate from production's
`heap_logs`, so load-test noise never reaches the `triaging-crash-logs`
workflow.

Rate-limit `namespace_id`s are 2001–2006, so staging never shares counters with
production's 1001–1006.

**D1 database count:** the free plan allows 10 per account. With the 4
production shards plus these 4, the account is at 8. The old pre-sharding `heap`
database was retired to make room.

## Secrets

Both are required before the first deploy.

```bash
cd server
npx wrangler secret put ADMIN_SECRET    --env staging
npx wrangler secret put LOADTEST_SECRET --env staging
```

**`ADMIN_SECRET` is not optional.** `requireAdminSecret` is a no-op when the
secret is unset (`server/src/middleware/adminAuth.ts:10`), so deploying without
it leaves heap create/reset/delete, reward-code minting and config editing
ungated on a public URL.

**`LOADTEST_SECRET`** enables the synthetic per-request rate-limit key in
`server/src/middleware/rateLimit.ts`. Without it the limiter keys on
`cf-connecting-ip`, and k6 running from one machine is throttled to ~5 req/s by
`RL_GLOBAL`. It must **never** be set on the production Worker — its absence is
what makes that branch unreachable there.

Keep both values in your local `.env`; `loadtest/scripts/*.ts` read them from
the environment.

## Deploy

```bash
cd server
npx wrangler deploy --env staging
```

## Migrations

Applied per database. `migrations_dir` in `[env.staging]` points at the same
migration files production uses, so schemas stay identical.

```bash
cd server
for db in heap_core heap_scores heap_rewards heap_telemetry; do
  npx wrangler d1 migrations apply "${db}_staging" --remote --env staging
done
```

## Verify

Replace `<url>` with the deployed Worker URL and `<secret>` with
`LOADTEST_SECRET`.

**1. Bindings are wired.** A 500 here means a binding is missing; an empty array
is the correct response before seeding.

```bash
curl -s "<url>/heaps"
```

**2. The admin gate is closed.** Must return 401, not 200.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "<url>/heaps"
```

**3. The synthetic rate-limit key works.** 40 rapid requests each with a
distinct key must all return 200 — they land in separate buckets.

```bash
for i in $(seq 1 40); do
  curl -s -o /dev/null -w '%{http_code} ' \
    -H "X-LoadTest-Secret: <secret>" -H "X-LoadTest-Key: vu-$i" \
    "<url>/heaps"
done; echo
```

**4. The limiter still protects un-keyed traffic.** The same 40 requests
*without* the headers share one IP bucket and should start returning 429 once
`RL_GLOBAL` (300/min) is exhausted. This confirms production's protection is
intact.

## Seed and reset

Seeding is a one-off that costs roughly 400 placements against the daily budget
(plus an equal number of state reads). It creates a small heap fixture, a large
pre-grown one, and a pool of 200 reusable player identities.

`BASE_URL`, `ADMIN_SECRET` and `LOADTEST_SECRET` are read from the repo-root
`.env`, so no prefixing is needed:

```bash
npm run loadtest:seed
npm run loadtest:reset   # between runs
```

**`LOADTEST_SECRET` makes seeding roughly 100x faster.** When it is set, each
seed request presents a unique `X-LoadTest-Key` and lands in its own rate-limit
bucket, so the growth loop runs unpaced. Without it the loop must sleep 2200ms
between placements to stay under `RL_PLACE` (30/min) and `RL_GLOBAL` (300/min),
taking ~15 minutes for the default 400 placements. Override with
`PLACE_DELAY_MS` to pace it deliberately.

Both scripts refuse to run against a URL that does not look like staging or
localhost.

### What seeding produces

`loadtest/fixtures.json` — **gitignored**, because it contains generated player
secrets:

```json
{
  "smallHeapId": "<uuid>",
  "largeHeapId": "<uuid>",
  "identities": [{ "playerId": "<uuid>", "playerSecret": "<uuid>" }]
}
```

The 200 identities are generated locally as UUID pairs — no server call. They
become real server-side rows lazily, the first time a scenario writes as one:
the TOFU claim in `server/src/playerAuth.ts` binds that `playerSecret` to that
`playerId` on first write, and every later write must present the same token.

**Reuse them across runs; don't regenerate casually.** That is what keeps score
submissions cheap. A fresh identity's first score is always a personal best, so
it invalidates the leaderboard cache and spends a KV delete from the 1,000/day
account-wide bucket. A returning identity only invalidates when it actually
beats its stored best. `npm run loadtest:reset` deliberately leaves
`fixtures.json` alone for this reason — it resets the heaps, not the players.

If you do lose the file, re-running the seed mints new identities; the old rows
stay in `player_auth` on staging, harmless but orphaned.

## Watch a run

```bash
cd server && npx wrangler tail --env staging
```

CPU time per request is the number to watch: the free tier caps it at 10 ms, and
the leading hypothesis is that placement CPU scales with polygon size. Compare
`PLACE_FIXTURE=large` against the default `small`.

Server-side warnings also land in `heap_logs_staging`: `place:rejected`,
`rate_limit:hit`, and `cache:kv-failed` (emitted when a KV operation fails and
the cache falls back to D1 — the signal that a quota bucket is exhausted or a
binding is broken).

## Teardown

If staging is ever retired, delete the Worker, the 4 D1 databases and the KV
namespace — otherwise they keep counting against the account's 10-database
limit.
