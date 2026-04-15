import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HeapDB } from './db';
import type { ScoreDB } from './scoreDb';
import { heapRoutes } from './routes/heap';
import { scoreRoutes } from './routes/scores';

export function createApp(heapDb: HeapDB, scoreDb: ScoreDB): Hono {
  const app = new Hono();
  app.use('*', cors());
  app.route('/heaps',  heapRoutes(heapDb));
  app.route('/scores', scoreRoutes(scoreDb));
  return app;
}
