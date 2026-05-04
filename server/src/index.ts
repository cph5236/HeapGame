import { createApp } from './app';
import { D1HeapDB } from './db';
import { D1ScoreDB } from './scoreDb';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  ADMIN_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp(new D1HeapDB(env.DB), new D1ScoreDB(env.DB), {
      allowedOrigins: env.ALLOWED_ORIGINS,
    });
    return app.fetch(request);
  },
};
