import { createApp } from './app';
import { D1HeapDB } from './db';
import { D1ScoreDB } from './scoreDb';
import type { RateLimiter } from './middleware/rateLimit';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  ADMIN_SECRET?: string;
  RL_SCORES?: RateLimiter;
  RL_PLACE?:  RateLimiter;
  RL_GLOBAL?: RateLimiter;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp(new D1HeapDB(env.DB), new D1ScoreDB(env.DB), {
      allowedOrigins: env.ALLOWED_ORIGINS,
      adminSecret:    env.ADMIN_SECRET,
      limiters: {
        scores: env.RL_SCORES,
        place:  env.RL_PLACE,
        global: env.RL_GLOBAL,
      },
    });
    return app.fetch(request);
  },
};
