// server/src/routes/daily.ts

import { Hono } from 'hono';
import type { DailyClaimDB } from '../dailyDb';
import type { ConfigDB } from '../configDb';
import type { PlayerAuthDB } from '../playerAuthDb';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import { enforcePlayerAuth } from '../playerAuth';
import { isItemId } from '../../../shared/itemIds';
import {
  clampOffsetMin, decideClaim, grantsForDay, grantsToRewards,
  nextEligibleAt, sanitizeRewardTable, statusFromState,
  DEFAULT_GRACE_HOURS, DEFAULT_MIN_GAP_HOURS,
} from '../../../shared/dailyDrop';
import type { DailyClaimRequest } from '../../../shared/dailyTypes';

const MAX_GUID_LEN = 64;

export function dailyRoutes(
  dailyDb: DailyClaimDB,
  configDb: ConfigDB | undefined,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
): Hono {
  const app = new Hono();

  async function loadTuning() {
    const cfg = configDb ? await configDb.getAll() : {};
    const grace = cfg['daily_streak_grace_hours'];
    const gap = cfg['daily_min_gap_hours'];
    return {
      table: sanitizeRewardTable(cfg['daily_rewards']),
      graceHours: typeof grace === 'number' && grace > 0 ? grace : DEFAULT_GRACE_HOURS,
      minGapHours: typeof gap === 'number' && gap > 0 ? gap : DEFAULT_MIN_GAP_HOURS,
    };
  }

  // ── Read-only streak/claim snapshot (drives the menu icon states) ────────
  app.get('/status', async (c) => {
    const guid = (c.req.query('playerGuid') ?? '').trim();
    if (!guid || guid.length > MAX_GUID_LEN) return c.json({ error: 'invalid request' }, 400);
    const offset = clampOffsetMin(Number(c.req.query('utcOffsetMin')));

    const { table, graceHours } = await loadTuning();
    const row = await dailyDb.get(guid);
    const state = row ? { lastClaimAt: row.last_claim_at, streakDay: row.streak_day } : null;
    return c.json(statusFromState(state, Date.now(), offset, graceHours, table), 200);
  });

  // ── Claim today's drop (auth-gated, server-authoritative) ────────────────
  app.post('/claim', async (c) => {
    let body: DailyClaimRequest;
    try {
      body = await c.req.json<DailyClaimRequest>();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }
    const guid = typeof body.playerGuid === 'string' ? body.playerGuid.trim() : '';
    if (!guid || guid.length > MAX_GUID_LEN) return c.json({ error: 'invalid request' }, 400);
    const resolution =
      body.resolution === 'repair' || body.resolution === 'reset' ? body.resolution : undefined;
    const offset = clampOffsetMin(body.utcOffsetMin);

    const authRes = await enforcePlayerAuth(c, authDb, guid, getSink, 'daily:claim');
    if (authRes) return authRes;

    const { table, graceHours, minGapHours } = await loadTuning();
    const now = Date.now();
    const row = await dailyDb.get(guid);
    const state = row ? { lastClaimAt: row.last_claim_at, streakDay: row.streak_day } : null;
    const decision = decideClaim(state, now, offset, resolution, graceHours, minGapHours);

    if (decision.kind === 'notEligible') {
      return c.json({ kind: 'notEligible', nextEligibleAt: decision.nextEligibleAt }, 409);
    }
    if (decision.kind === 'broken') {
      // Informational — nothing granted until the client resolves repair/reset.
      return c.json({ kind: 'streakBroken', repairableDay: decision.repairableDay }, 200);
    }

    const stored = await dailyDb.record(guid, now, offset, decision.day, row ? row.last_claim_at : null);
    if (!stored) {
      // Lost a same-instant race — another device's claim landed first.
      // Re-read the winner's row so nextEligibleAt uses the shared formula
      // (next local midnight vs min gap), matching every other 409 path.
      const fresh = await dailyDb.get(guid);
      return c.json({
        kind: 'notEligible',
        nextEligibleAt: nextEligibleAt(fresh?.last_claim_at ?? now, offset, minGapHours),
      }, 409);
    }

    const rewards = grantsToRewards(grantsForDay(table, decision.day), isItemId);
    const sink = getSink();
    if (sink) {
      await captureServer(sink, 'event', 'daily:claimed',
        { day: decision.day, repaired: resolution === 'repair' });
    }
    return c.json({
      kind: 'ok',
      rewards,
      streakDay: decision.day,
      nextRewardPreview: grantsForDay(table, decision.day + 1),
    }, 200);
  });

  return app;
}
