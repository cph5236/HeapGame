import { createApp } from './app';
import { D1HeapDB } from './db';
import { D1ScoreDB } from './scoreDb';
import { D1Sink } from './logging/D1Sink';
import { AnalyticsEngineSink } from './logging/AnalyticsEngineSink';
import type { RateLimiter } from './middleware/rateLimit';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  ADMIN_SECRET?: string;
  RL_SCORES?: RateLimiter;
  RL_PLACE?:  RateLimiter;
  RL_GLOBAL?: RateLimiter;
  // Analytics Engine binding — added in Phase 4. If unset, fall back to D1Sink.
  LOGS?: AnalyticsEngineDataset;
  RL_LOG?: RateLimiter;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const logSink = env.LOGS
      ? new AnalyticsEngineSink(env.LOGS)
      : new D1Sink(env.DB);
    const app = createApp(new D1HeapDB(env.DB), new D1ScoreDB(env.DB), {
      allowedOrigins: env.ALLOWED_ORIGINS,
      adminSecret:    env.ADMIN_SECRET,
      limiters: {
        scores: env.RL_SCORES,
        place:  env.RL_PLACE,
        global: env.RL_GLOBAL,
        log:    env.RL_LOG,
      },
      logSink,
    });
    return app.fetch(request);
  },
};
