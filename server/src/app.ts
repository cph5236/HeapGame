import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HeapDB } from './db';
import type { ScoreDB } from './scoreDb';
import { heapRoutes } from './routes/heap';
import { scoreRoutes } from './routes/scores';
import { logRoutes } from './routes/log';
import { codeRoutes } from './routes/codes';
import { requireAdminSecret } from './middleware/adminAuth';
import { rateLimit, type RateLimiter, setRateLimitSink } from './middleware/rateLimit';
import type { Sink } from './logging/Sink';
import type { RewardCodeDB } from './codeDb';

export interface AppOptions {
  /** Comma-separated origin list, or '*' to allow all (dev only). */
  allowedOrigins?: string;
  /** When set, mutating heap routes require X-Admin-Secret: <value>. */
  adminSecret?: string;
  /** Cloudflare Rate Limiting API bindings. Any unset = no limit on that bucket. */
  limiters?: {
    scores?: RateLimiter;
    place?:  RateLimiter;
    global?: RateLimiter;
    log?:    RateLimiter;
    codes?:  RateLimiter;
  };
  /** Reward-code D1 access. If unset, /codes is not mounted. */
  codeDb?: RewardCodeDB;
  /** Sink for incoming /log entries. If unset, /log is not mounted. */
  logSink?: Sink;
}

export function createApp(heapDb: HeapDB, scoreDb: ScoreDB, opts: AppOptions = {}): Hono {
  const app = new Hono();

  // Wire in rate limit sink if available
  if (opts.logSink) {
    setRateLimitSink(() => opts.logSink);
  }

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

  // Rate limiting — global circuit breaker on all heap/score traffic
  const lim = opts.limiters ?? {};
  if (lim.global) {
    const globalMw = rateLimit(lim.global, 'global');
    app.use('/heaps',    globalMw);
    app.use('/heaps/*',  globalMw);
    app.use('/scores',   globalMw);
    app.use('/scores/*', globalMw);
  }

  // Per-route limiters (mounted as POST handlers; fall through on success)
  app.post('/scores',          rateLimit(lim.scores, 'scores-submit'));
  app.post('/heaps/:id/place', rateLimit(lim.place,  'place-block'));
  app.post('/log',             rateLimit(lim.log,    'log'));

  // Admin gate on mutating heap routes
  const adminGate = requireAdminSecret(opts.adminSecret);
  app.post  ('/heaps',                  adminGate);
  app.put   ('/heaps/:id/reset',        adminGate);
  app.put   ('/heaps/:id/params',       adminGate);
  app.put   ('/heaps/:id/enemy-params', adminGate);
  app.delete('/heaps/:id',              adminGate);

  app.route('/heaps',  heapRoutes(heapDb, () => opts.logSink));
  app.route('/scores', scoreRoutes(scoreDb, heapDb, () => opts.logSink));

  if (opts.codeDb) {
    // Player redeem endpoint — rate-limited, no admin gate.
    app.post('/codes/redeem', rateLimit(lim.codes, 'codes-redeem'));
    // Admin mint + list — behind the admin gate.
    app.post('/codes', adminGate);
    app.get ('/codes', adminGate);
    app.route('/codes', codeRoutes(opts.codeDb, () => opts.logSink));
  }

  if (opts.logSink) {
    app.route('/', logRoutes(() => opts.logSink!));
  }

  return app;
}
