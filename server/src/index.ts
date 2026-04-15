import { createApp } from './app';
import { D1HeapDB } from './db';
import { D1ScoreDB } from './scoreDb';

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp(new D1HeapDB(env.DB), new D1ScoreDB(env.DB));
    return app.fetch(request);
  },
};
