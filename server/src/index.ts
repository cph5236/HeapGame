import { createApp } from './app';
import { D1HeapDB } from './db';
import { D1ScoreDB } from './scoreDb';
import { D1RewardCodeDB } from './codeDb';
import { D1FeedbackDB } from './feedbackDb';
import { D1ConfigDB } from './configDb';
import { D1CustomizationDB } from './customizationDb';
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
  RL_SCORES?: RateLimiter;
  RL_PLACE?:  RateLimiter;
  RL_GLOBAL?: RateLimiter;
  RL_CODES?: RateLimiter;
  RL_FEEDBACK?: RateLimiter;
  // Analytics Engine binding — added in Phase 4. If unset, fall back to D1Sink.
  LOGS?: AnalyticsEngineDataset;
  RL_LOG?: RateLimiter;
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
    // hit their domain DB directly.
    const heapDb   = new CachedHeapDB(new D1HeapDB(env.DB_HEAP), env.CACHE, w);
    const scoreDb  = new CachedScoreDB(new D1ScoreDB(env.DB_SCORES), env.CACHE, w);
    const configDb = new CachedConfigDB(new D1ConfigDB(env.DB_HEAP), env.CACHE, w);
    const app = createApp(heapDb, scoreDb, {
      allowedOrigins: env.ALLOWED_ORIGINS,
      adminSecret:    env.ADMIN_SECRET,
      codeDb:         new D1RewardCodeDB(env.DB_REWARDS),
      feedbackDb:     new D1FeedbackDB(env.DB_TELEMETRY),
      configDb,
      customizationDb: new D1CustomizationDB(env.DB_SCORES),
      limiters: {
        scores: env.RL_SCORES,
        place:  env.RL_PLACE,
        global: env.RL_GLOBAL,
        log:    env.RL_LOG,
        codes:  env.RL_CODES,
        feedback: env.RL_FEEDBACK,
      },
      logSink,
    });
    return app.fetch(request);
  },
};
