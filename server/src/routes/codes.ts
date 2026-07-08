// server/src/routes/codes.ts

import { Hono } from 'hono';
import type { RewardCodeDB } from '../codeDb';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import { isItemId } from '../../../shared/itemIds';
import type { CreateCodeRequest, RedeemCodeRequest } from '../../../shared/codeTypes';
import type { PlayerAuthDB } from '../playerAuthDb';
import { enforcePlayerAuth } from '../playerAuth';

const MAX_CODE_LEN = 32;
const MAX_GUID_LEN = 64;

function normalizeCode(s: string): string {
  return s.trim().toUpperCase();
}

export function codeRoutes(
  codeDb: RewardCodeDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
): Hono {
  const app = new Hono();

  // ── Player: redeem a code ────────────────────────────────────────────────
  app.post('/redeem', async (c) => {
    let body: RedeemCodeRequest;
    try {
      body = await c.req.json<RedeemCodeRequest>();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }
    const code = typeof body.code === 'string' ? normalizeCode(body.code) : '';
    const guid = typeof body.playerGuid === 'string' ? body.playerGuid.trim() : '';
    if (!code || code.length > MAX_CODE_LEN || !guid || guid.length > MAX_GUID_LEN) {
      return c.json({ error: 'invalid request' }, 400);
    }

    const authRes = await enforcePlayerAuth(c, authDb, guid, getSink, 'codes:redeem');
    if (authRes) return authRes;

    const now = new Date().toISOString();
    const outcome = await codeDb.redeem(code, guid, now);

    if (outcome.kind === 'ok') {
      const sink = getSink();
      if (sink) await captureServer(sink, 'event', 'code:redeemed', { code, type: outcome.reward.rewardType });
      return c.json(outcome.reward, 200);
    }
    switch (outcome.kind) {
      case 'notFound':        return c.json({ error: 'code not found' }, 404);
      case 'expired':         return c.json({ error: 'code expired' }, 410);
      case 'exhausted':       return c.json({ error: 'code fully redeemed' }, 409);
      case 'alreadyRedeemed': return c.json({ error: 'already redeemed' }, 409);
    }
  });

  // ── Admin: mint a code (adminGate applied in app.ts) ─────────────────────
  app.post('/', async (c) => {
    let body: CreateCodeRequest;
    try {
      body = await c.req.json<CreateCodeRequest>();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }

    const code = typeof body.code === 'string' ? normalizeCode(body.code) : '';
    const rewardType = body.rewardType;
    const rewardAmount = body.rewardAmount;
    const maxRedemptions = body.maxRedemptions ?? 0;
    const expiresAt = body.expiresAt ?? null;

    if (!code || code.length > MAX_CODE_LEN) return c.json({ error: 'invalid code' }, 400);
    if (rewardType !== 'coins' && rewardType !== 'item') return c.json({ error: 'invalid rewardType' }, 400);
    if (!Number.isInteger(rewardAmount) || rewardAmount <= 0) return c.json({ error: 'invalid rewardAmount' }, 400);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 0) return c.json({ error: 'invalid maxRedemptions' }, 400);

    let rewardId: string | null = null;
    if (rewardType === 'item') {
      rewardId = typeof body.rewardId === 'string' ? body.rewardId : '';
      if (!isItemId(rewardId)) return c.json({ error: 'invalid rewardId' }, 400);
    }
    if (expiresAt !== null && (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt)))) {
      return c.json({ error: 'invalid expiresAt' }, 400);
    }

    const now = new Date().toISOString();
    const created = await codeDb.createCode(
      { code, rewardType, rewardId, rewardAmount, maxRedemptions, expiresAt },
      now,
    );
    if (!created) return c.json({ error: 'code already exists' }, 409);
    return c.json({ ok: true, code }, 201);
  });

  // ── Admin: list codes (adminGate applied in app.ts) ──────────────────────
  app.get('/', async (c) => {
    const rows = await codeDb.listCodes();
    return c.json({ codes: rows });
  });

  return app;
}
