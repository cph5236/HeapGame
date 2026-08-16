import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HeapDB } from './db';
import type { ScoreDB } from './scoreDb';
import type { BanDB } from './banDb';
import { heapRoutes } from './routes/heap';
import { scoreRoutes } from './routes/scores';
import { logRoutes } from './routes/log';
import { codeRoutes } from './routes/codes';
import { dailyRoutes } from './routes/daily';
import { feedbackRoutes } from './routes/feedback';
import { configRoutes } from './routes/config';
import { customizationRoutes } from './routes/customization';
import { playerRoutes } from './routes/players';
import { authAdminRoutes } from './routes/auth';
import { banRoutes } from './routes/bans';
import { requireAdminSecret } from './middleware/adminAuth';
import { rateLimit, type RateLimiter, setRateLimitSink } from './middleware/rateLimit';
import { parseOriginAllowlist } from './middleware/originAllowlist';
import type { Sink } from './logging/Sink';
import type { RewardCodeDB } from './codeDb';
import type { DailyClaimDB } from './dailyDb';
import type { FeedbackDB } from './feedbackDb';
import type { ConfigDB } from './configDb';
import type { CustomizationDB } from './customizationDb';
import type { PlayerAuthDB } from './playerAuthDb';
import type { ContributionDB } from './contributionDb';
import type { PlayerNameDB } from './playerNameDb';

export interface AppOptions {
  /**
   * Comma-separated origin list, or '*' to allow all (dev only). Entries may use
   * a `https://*.example.com` wildcard to match subdomains — see
   * middleware/originAllowlist.ts.
   */
  allowedOrigins?: string;
  /** When set, mutating heap routes require X-Admin-Secret: <value>. */
  adminSecret?: string;
  /** Staging only — when set, a request presenting a matching X-LoadTest-Secret
   *  header keys the rate limiter on X-LoadTest-Key instead of client IP. */
  loadTestSecret?: string;
  /** Cloudflare Rate Limiting API bindings. Any unset = no limit on that bucket. */
  limiters?: {
    scores?: RateLimiter;
    place?:  RateLimiter;
    global?: RateLimiter;
    log?:    RateLimiter;
    codes?:  RateLimiter;
    feedback?: RateLimiter;
    session?: RateLimiter;
  };
  /** Reward-code D1 access. If unset, /codes is not mounted. */
  codeDb?: RewardCodeDB;
  /** Daily Drop claims (daily_claims in heap_rewards). If unset, /daily is not mounted. */
  dailyDb?: DailyClaimDB;
  /** Feedback D1 access. If unset, /feedback is not mounted. */
  feedbackDb?: FeedbackDB;
  /** Config D1 access. If unset, /config is not mounted. */
  configDb?: ConfigDB;
  /** Player-customization D1 access. If unset, /customization is not mounted. */
  customizationDb?: CustomizationDB;
  /** Player write-auth (player_auth table in heap_scores). If unset, writes are not enforced. */
  playerAuthDb?: PlayerAuthDB;
  /** Placement contribution counters (player_contribution in heap_scores). If unset, placements don't tick. */
  contributionDb?: ContributionDB;
  /** Player-name D1 access (player_name in heap_scores). If unset, /players/:id/name is not mounted and score submit doesn't seed names. */
  playerNameDb?: PlayerNameDB;
  /** Sink for incoming /log entries. If unset, /log is not mounted. */
  logSink?: Sink;
  /** HMAC key for run-session tokens. If unset, /scores/session 404s and
   *  score submits skip session verification entirely (legacy behavior). */
  sessionSecret?: string;
  /** Shadow-ban list (player_ban in heap_scores). If unset, /bans is not mounted
   *  and placements are never silently dropped. */
  banDb?: BanDB;
}

export function createApp(heapDb: HeapDB, scoreDb: ScoreDB, opts: AppOptions = {}): Hono {
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

  // Rate limiting — global circuit breaker on all heap/score traffic
  const lim = opts.limiters ?? {};
  if (lim.global) {
    const globalMw = rateLimit(lim.global, 'global', opts.loadTestSecret);
    app.use('/heaps',    globalMw);
    app.use('/heaps/*',  globalMw);
    app.use('/scores',   globalMw);
    app.use('/scores/*', globalMw);
  }

  // Per-route limiters (mounted as POST handlers; fall through on success)
  app.post('/scores',          rateLimit(lim.scores, 'scores-submit', opts.loadTestSecret));
  app.post('/scores/session',  rateLimit(lim.session, 'scores-session', opts.loadTestSecret));
  app.post('/heaps/:id/place', rateLimit(lim.place,  'place-block',   opts.loadTestSecret));
  app.post('/log',             rateLimit(lim.log,    'log',           opts.loadTestSecret));

  // Admin gate on mutating heap routes
  const adminGate = requireAdminSecret(opts.adminSecret);
  app.post  ('/heaps',                  adminGate);
  app.put   ('/heaps/:id/reset',        adminGate);
  app.put   ('/heaps/:id/params',       adminGate);
  app.put   ('/heaps/:id/enemy-params', adminGate);
  app.get   ('/heaps/:id/bands',        adminGate);
  app.put   ('/heaps/:id/bands',        adminGate);
  app.delete('/heaps/:id',              adminGate);
  app.get   ('/scores/admin/:heapId',   adminGate);

  app.route('/heaps',  heapRoutes(heapDb, () => opts.logSink, opts.playerAuthDb, opts.contributionDb));
  app.route('/scores', scoreRoutes(scoreDb, heapDb, () => opts.logSink, opts.playerAuthDb, opts.playerNameDb, opts.sessionSecret));

  if (opts.codeDb) {
    // Player redeem endpoint — rate-limited, no admin gate.
    app.post('/codes/redeem', rateLimit(lim.codes, 'codes-redeem', opts.loadTestSecret));
    // Admin mint + list — behind the admin gate.
    app.post('/codes', adminGate);
    app.get ('/codes', adminGate);
    app.route('/codes', codeRoutes(opts.codeDb, () => opts.logSink, opts.playerAuthDb));
  }

  if (opts.dailyDb) {
    // Player claim endpoint — rate-limited, no admin gate.
    app.post('/daily/claim', rateLimit(lim.codes, 'daily-claim', opts.loadTestSecret));
    app.route('/daily', dailyRoutes(opts.dailyDb, opts.configDb, () => opts.logSink, opts.playerAuthDb));
  }

  if (opts.feedbackDb) {
    // Public submit — rate-limited, no admin gate.
    app.post('/feedback', rateLimit(lim.feedback, 'feedback', opts.loadTestSecret));
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

  if (opts.customizationDb) {
    // Player loadout writes share the scores rate-limit bucket — they're debounced client-side.
    app.put('/customization/:playerId', rateLimit(lim.scores, 'customization-put', opts.loadTestSecret));
    app.route('/customization', customizationRoutes(opts.customizationDb, () => opts.logSink, opts.playerAuthDb));
  }

  if (opts.playerAuthDb) {
    // Admin rescue: unclaim a player_auth row.
    app.delete('/auth/:playerId', adminGate);
    app.route('/auth', authAdminRoutes(opts.playerAuthDb));
  }

  if (opts.playerNameDb) {
    // Player rename writes share the scores rate-limit bucket — same pattern as customization.
    app.put('/players/:playerId/name', rateLimit(lim.scores, 'players-rename', opts.loadTestSecret));
    app.route('/players', playerRoutes(opts.playerNameDb, () => opts.logSink, opts.playerAuthDb));
  }

  if (opts.banDb) {
    // Admin shadow-ban surface — entirely behind the admin gate.
    app.get   ('/bans',           adminGate);
    app.get   ('/bans/:playerId', adminGate);
    app.put   ('/bans/:playerId', adminGate);
    app.delete('/bans/:playerId', adminGate);
    app.route('/bans', banRoutes(opts.banDb, scoreDb, opts.playerNameDb));
  }

  if (opts.logSink) {
    app.route('/', logRoutes(() => opts.logSink!));
  }

  return app;
}
