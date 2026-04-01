import { Hono } from 'hono';
import type { HeapDB } from './db';
import { heapRoutes } from './routes/heap';

export function createApp(db: HeapDB): Hono {
  const app = new Hono();
  app.route('/heap', heapRoutes(db));
  return app;
}
