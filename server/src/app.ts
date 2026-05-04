import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HeapDB } from './db';
import type { ScoreDB } from './scoreDb';
import { heapRoutes } from './routes/heap';
import { scoreRoutes } from './routes/scores';
import { requireAdminSecret } from './middleware/adminAuth';

export interface AppOptions {
  /** Comma-separated origin list, or '*' to allow all (dev only). */
  allowedOrigins?: string;
  /** When set, mutating heap routes require X-Admin-Secret: <value>. */
  adminSecret?: string;
}

export function createApp(heapDb: HeapDB, scoreDb: ScoreDB, opts: AppOptions = {}): Hono {
  const app = new Hono();

  const raw = (opts.allowedOrigins ?? '*').trim();
  const allowAll = raw === '*';
  const list = allowAll
    ? []
    : raw.split(',').map((s) => s.trim()).filter(Boolean);

  app.use('*', cors({
    origin: (origin) => {
      if (allowAll) return origin ?? '*';
      if (!origin) return null;
      return list.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Admin-Secret'],
  }));

  const adminGate = requireAdminSecret(opts.adminSecret);
  app.post  ('/heaps',                  adminGate);
  app.put   ('/heaps/:id/reset',        adminGate);
  app.put   ('/heaps/:id/enemy-params', adminGate);
  app.delete('/heaps/:id',              adminGate);

  app.route('/heaps',  heapRoutes(heapDb));
  app.route('/scores', scoreRoutes(scoreDb));
  return app;
}
