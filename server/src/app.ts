import type { Hono } from 'hono';
import type { HeapDB } from './game/db';
import type { ScoreDB } from './game/scoreDb';
import type { BanDB } from './platform/banDb';
import { heapRoutes } from './game/routes/heap';
import { scoreRoutes } from './game/routes/scores';
import { codeRoutes } from './game/routes/codes';
import { dailyRoutes } from './game/routes/daily';
import { customizationRoutes } from './game/routes/customization';
import { banRoutes } from './platform/routes/bans';
import { createPlatformApp, type PlatformOptions } from './platform/app';
import type { RewardCodeDB } from './game/codeDb';
import type { DailyClaimDB } from './game/dailyDb';
import type { CustomizationDB } from './game/customizationDb';
import type { ContributionDB } from './game/contributionDb';

/** Platform options plus this game's own. Everything game-specific is declared
 *  here; `PlatformOptions` is what a different game would keep. */
export interface AppOptions extends PlatformOptions {
  /** Reward-code D1 access. If unset, /codes is not mounted. */
  codeDb?: RewardCodeDB;
  /** Daily Drop claims (daily_claims in heap_rewards). If unset, /daily is not mounted. */
  dailyDb?: DailyClaimDB;
  /** Player-customization D1 access. If unset, /customization is not mounted. */
  customizationDb?: CustomizationDB;
  /** Placement contribution counters (player_contribution in heap_scores). If unset, placements don't tick. */
  contributionDb?: ContributionDB;
  /** HMAC key for run-session tokens. If unset, /scores/session 404s and
   *  score submits skip session verification entirely (legacy behavior). */
  sessionSecret?: string;
  /** Shadow-ban list (player_ban in heap_scores). If unset, /bans is not mounted
   *  and placements are never silently dropped. */
  banDb?: BanDB;
}

/**
 * Heap's worker: the platform app with this game's routes mounted onto it.
 * Route paths and middleware order are unchanged from before the platform/game
 * split — only where the code lives has moved.
 */
export function createApp(heapDb: HeapDB, scoreDb: ScoreDB, opts: AppOptions = {}): Hono {
  const { app, adminGate, limit } = createPlatformApp(opts);

  // Rate limiting — global circuit breaker on all heap/score traffic
  const lim = opts.limiters ?? {};
  if (lim.global) {
    const globalMw = limit('global', 'global');
    app.use('/heaps',    globalMw);
    app.use('/heaps/*',  globalMw);
    app.use('/scores',   globalMw);
    app.use('/scores/*', globalMw);
  }

  // Per-route limiters (mounted as POST handlers; fall through on success)
  app.post('/scores',          limit('scores', 'scores-submit'));
  app.post('/scores/session',  limit('session', 'scores-session'));
  app.post('/heaps/:id/place', limit('place', 'place-block'));

  // Admin gate on mutating heap routes
  app.post  ('/heaps',                  adminGate);
  app.put   ('/heaps/:id/reset',        adminGate);
  app.put   ('/heaps/:id/params',       adminGate);
  app.put   ('/heaps/:id/enemy-params', adminGate);
  app.get   ('/heaps/:id/bands',        adminGate);
  app.put   ('/heaps/:id/bands',        adminGate);
  app.delete('/heaps/:id',              adminGate);
  app.get   ('/scores/admin/:heapId',   adminGate);

  app.route('/heaps',  heapRoutes(heapDb, () => opts.logSink, opts.playerAuthDb, opts.contributionDb, opts.banDb));
  app.route('/scores', scoreRoutes(scoreDb, heapDb, () => opts.logSink, opts.playerAuthDb, opts.playerNameDb, opts.sessionSecret, opts.banDb));

  if (opts.codeDb) {
    // Player redeem endpoint — rate-limited, no admin gate.
    app.post('/codes/redeem', limit('codes', 'codes-redeem'));
    // Admin mint + list — behind the admin gate.
    app.post('/codes', adminGate);
    app.get ('/codes', adminGate);
    app.route('/codes', codeRoutes(opts.codeDb, () => opts.logSink, opts.playerAuthDb));
  }

  if (opts.dailyDb) {
    // Player claim endpoint — rate-limited, no admin gate.
    app.post('/daily/claim', limit('codes', 'daily-claim'));
    app.route('/daily', dailyRoutes(opts.dailyDb, opts.configDb, () => opts.logSink, opts.playerAuthDb));
  }

  if (opts.customizationDb) {
    // Player loadout writes share the scores rate-limit bucket — they're debounced client-side.
    app.put('/customization/:playerId', limit('scores', 'customization-put'));
    app.route('/customization', customizationRoutes(opts.customizationDb, () => opts.logSink, opts.playerAuthDb));
  }

  // Shadow bans are a platform concern, but banRoutes purges scores on ban and so
  // depends on ScoreDB. It stays mounted here until that dependency is inverted;
  // the file itself already lives under platform/.
  if (opts.banDb) {
    // Admin shadow-ban surface — entirely behind the admin gate.
    app.get   ('/bans',           adminGate);
    app.get   ('/bans/:playerId', adminGate);
    app.put   ('/bans/:playerId', adminGate);
    app.delete('/bans/:playerId', adminGate);
    app.route('/bans', banRoutes(opts.banDb, scoreDb, opts.playerNameDb));
  }

  return app;
}
