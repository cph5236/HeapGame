import { createApp } from './app';
import { D1HeapDB } from './db';
import { D1ScoreDB } from './scoreDb';
import { D1RewardCodeDB } from './codeDb';
import { D1DailyClaimDB } from './dailyDb';
import { D1FeedbackDB } from './feedbackDb';
import { D1ConfigDB } from './configDb';
import { D1CustomizationDB } from './customizationDb';
import { D1PlayerAuthDB } from './playerAuthDb';
import { D1ContributionDB } from './contributionDb';
import { D1PlayerNameDB } from './playerNameDb';
import { CachedHeapDB } from './cache/CachedHeapDB';
import { CachedScoreDB } from './cache/CachedScoreDB';
import { CachedConfigDB } from './cache/CachedConfigDB';
import { D1Sink } from './logging/D1Sink';
import { AnalyticsEngineSink } from './logging/AnalyticsEngineSink';
import type { RateLimiter } from './middleware/rateLimit';

export interface Env {
  // Domain-sharded D1 databases (see wrangler.toml).
  DB_HEAP: D1Database;       // heap_core:      heap, heap_base, heap_parameters
  DB_SCORES: D1Database;     // heap_scores:    score
  DB_REWARDS: D1Database;    // heap_rewards:   reward_codes, code_redemptions
  DB_TELEMETRY: D1Database;  // heap_telemetry: logs, feedback
  // Edge read cache (cache-aside / write-through over the heap + score repos).
  CACHE: KVNamespace;
  ALLOWED_ORIGINS?: string;
  ADMIN_SECRET?: string;
  /** Staging only — enables the synthetic rate-limit key. Never set in production. */
  LOADTEST_SECRET?: string;
  RL_SCORES?: RateLimiter;
  RL_PLACE?:  RateLimiter;
  RL_GLOBAL?: RateLimiter;
  RL_CODES?: RateLimiter;
  RL_FEEDBACK?: RateLimiter;
  // Analytics Engine binding — added in Phase 4. If unset, fall back to D1Sink.
  LOGS?: AnalyticsEngineDataset;
  RL_LOG?: RateLimiter;
  /** HMAC key for run-session tokens. Set via `wrangler secret put SESSION_SECRET`. */
  SESSION_SECRET?: string;
  RL_SESSION?: RateLimiter;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const w = (p: Promise<unknown>) => ctx.waitUntil(p);
    // Telemetry stays D1-direct (high-write, never cached); falls back to the
    // telemetry DB when the Analytics Engine binding is unset (local dev).
    const logSink = env.LOGS
      ? new AnalyticsEngineSink(env.LOGS)
      : new D1Sink(env.DB_TELEMETRY);
    // Read-heavy repos get a KV cache decorator; transactional + telemetry repos
    // hit their domain DB directly. The same logSink used for route-level
    // telemetry is threaded in so KV outages land in heap_logs, not just
    // console.warn (which only wrangler tail sees live).
    const heapDb   = new CachedHeapDB(new D1HeapDB(env.DB_HEAP), env.CACHE, w, logSink);
    const scoreDb  = new CachedScoreDB(new D1ScoreDB(env.DB_SCORES), env.CACHE, w, logSink);
    const configDb = new CachedConfigDB(new D1ConfigDB(env.DB_HEAP), env.CACHE, w, logSink);
    const app = createApp(heapDb, scoreDb, {
      allowedOrigins: env.ALLOWED_ORIGINS,
      adminSecret:    env.ADMIN_SECRET,
      loadTestSecret: env.LOADTEST_SECRET,
      codeDb:         new D1RewardCodeDB(env.DB_REWARDS),
      dailyDb:        new D1DailyClaimDB(env.DB_REWARDS),
      feedbackDb:     new D1FeedbackDB(env.DB_TELEMETRY),
      configDb,
      customizationDb: new D1CustomizationDB(env.DB_SCORES),
      playerAuthDb:    new D1PlayerAuthDB(env.DB_SCORES),
      contributionDb:  new D1ContributionDB(env.DB_SCORES),
      playerNameDb:    new D1PlayerNameDB(env.DB_SCORES),
      sessionSecret:  env.SESSION_SECRET,
      limiters: {
        scores: env.RL_SCORES,
        place:  env.RL_PLACE,
        global: env.RL_GLOBAL,
        log:    env.RL_LOG,
        codes:  env.RL_CODES,
        feedback: env.RL_FEEDBACK,
        session: env.RL_SESSION,
      },
      logSink,
    });
    return app.fetch(request);
  },
};
