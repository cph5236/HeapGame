import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAdminSecret } from './middleware/adminAuth';
import { rateLimit, type RateLimiter, setRateLimitSink } from './middleware/rateLimit';
import { parseOriginAllowlist } from './middleware/originAllowlist';
import { logRoutes } from './routes/log';
import { feedbackRoutes } from './routes/feedback';
import { configRoutes } from './routes/config';
import { playerRoutes } from './routes/players';
import { authAdminRoutes } from './routes/auth';
import type { Sink } from './logging/Sink';
import type { FeedbackDB } from './feedbackDb';
import type { ConfigDB } from './configDb';
import type { PlayerAuthDB } from './playerAuthDb';
import type { PlayerNameDB } from './playerNameDb';

/** Rate-limit buckets. Any unset binding means no limit on that bucket. */
export interface Limiters {
  scores?: RateLimiter;
  place?:  RateLimiter;
  global?: RateLimiter;
  log?:    RateLimiter;
  codes?:  RateLimiter;
  feedback?: RateLimiter;
  session?: RateLimiter;
}

/** The half of the app config that belongs to the platform. A game built on this
 *  shell keeps every field here and extends it with its own. */
export interface PlatformOptions {
  /**
   * Comma-separated origin list, or '*' to allow all (dev only). Entries may use
   * a `https://*.example.com` wildcard to match subdomains — see
   * middleware/originAllowlist.ts.
   */
  allowedOrigins?: string;
  /** When set, mutating admin routes require X-Admin-Secret: <value>. */
  adminSecret?: string;
  /** Staging only — when set, a request presenting a matching X-LoadTest-Secret
   *  header keys the rate limiter on X-LoadTest-Key instead of client IP. */
  loadTestSecret?: string;
  /** Cloudflare Rate Limiting API bindings. Any unset = no limit on that bucket. */
  limiters?: Limiters;
  /** Feedback D1 access. If unset, /feedback is not mounted. */
  feedbackDb?: FeedbackDB;
  /** Config D1 access. If unset, /config is not mounted. */
  configDb?: ConfigDB;
  /** Player write-auth. If unset, writes are not enforced. */
  playerAuthDb?: PlayerAuthDB;
  /** Player-name D1 access. If unset, /players/:id/name is not mounted. */
  playerNameDb?: PlayerNameDB;
  /** Sink for incoming /log entries. If unset, /log is not mounted. */
  logSink?: Sink;
}

/** What createPlatformApp hands back so a game can mount its own routes with the
 *  same admin gate and rate-limit buckets. */
export interface PlatformApp {
  app: Hono;
  /** Admin-secret gate, already bound to the configured secret. */
  adminGate: ReturnType<typeof requireAdminSecret>;
  /** Build a rate-limit middleware on one of the configured buckets. */
  limit: (bucket: keyof Limiters, name: string) => ReturnType<typeof rateLimit>;
}

/**
 * The platform half of the worker: CORS, rate limiting, the admin gate, and the
 * routes that carry no game concepts — logging, feedback, remote config, player
 * identity and write-auth. A game mounts its own routes onto the returned app.
 */
export function createPlatformApp(opts: PlatformOptions = {}): PlatformApp {
  const app = new Hono();

  // Wire in rate limit sink if available
  if (opts.logSink) {
    setRateLimitSink(() => opts.logSink);
  }

  const allowlist = parseOriginAllowlist(opts.allowedOrigins);

  app.use('*', cors({
    origin: (origin) => {
      if (allowlist.allowAll) return origin ?? '*';
      if (!origin) return null;
      return allowlist.allows(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Admin-Secret', 'X-Player-Token', 'X-LoadTest-Secret', 'X-LoadTest-Key'],
  }));

  const lim = opts.limiters ?? {};
  const limit = (bucket: keyof Limiters, name: string) =>
    rateLimit(lim[bucket], name, opts.loadTestSecret);
  const adminGate = requireAdminSecret(opts.adminSecret);

  app.post('/log', limit('log', 'log'));

  if (opts.feedbackDb) {
    // Public submit — rate-limited, no admin gate.
    app.post('/feedback', limit('feedback', 'feedback'));
    // Admin read — behind the admin gate.
    app.get('/feedback', adminGate);
    app.route('/feedback', feedbackRoutes(opts.feedbackDb));
  }

  if (opts.configDb) {
    // Public read — no admin gate.
    // Admin write/delete — behind the admin gate.
    app.put('/config/:key', adminGate);
    app.delete('/config/:key', adminGate);
    app.route('/config', configRoutes(opts.configDb));
  }

  if (opts.playerAuthDb) {
    // Admin rescue: unclaim a player_auth row.
    app.delete('/auth/:playerId', adminGate);
    app.route('/auth', authAdminRoutes(opts.playerAuthDb));
  }

  if (opts.playerNameDb) {
    // Player rename writes share the scores rate-limit bucket — same pattern as customization.
    app.put('/players/:playerId/name', limit('scores', 'players-rename'));
    app.route('/players', playerRoutes(opts.playerNameDb, () => opts.logSink, opts.playerAuthDb));
  }

  if (opts.logSink) {
    app.route('/', logRoutes(() => opts.logSink!));
  }

  return { app, adminGate, limit };
}
