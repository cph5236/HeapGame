import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HeapDB } from './db';
import { heapRoutes } from './routes/heap';

export function createApp(db: HeapDB): Hono {
  const app = new Hono();
  app.use('*', cors());
  app.route('/heaps', heapRoutes(db));
  return app;
}
