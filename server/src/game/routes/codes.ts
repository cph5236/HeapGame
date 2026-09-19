// server/src/routes/codes.ts

import { Hono } from 'hono';
import type { RewardCodeDB, NormalizedUpdateCode } from '../codeDb';
import type { Sink } from '../../platform/logging/Sink';
import { captureServer } from '../../platform/logging/captureServerEvent';
import { isItemId } from '../../../../shared/itemIds';
import type { CreateCodeRequest, RedeemCodeRequest, UpdateCodeRequest } from '../../../../shared/codeTypes';
import type { PlayerAuthDB } from '../../platform/playerAuthDb';
import { enforcePlayerAuth } from '../../platform/playerAuth';

const MAX_CODE_LEN = 32;
const MAX_GUID_LEN = 64;

function normalizeCode(s: string): string {
  return s.trim().toUpperCase();
}

// Shared between mint (POST /) and update (PATCH /:code) so a future rule
// change can't apply to one and silently drift from the other.
function isValidRewardAmount(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) > 0;
}
function isValidMaxRedemptions(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0;
}
function isValidExpiresAt(v: unknown): v is string | null {
  return v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
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
    if (!isValidRewardAmount(rewardAmount)) return c.json({ error: 'invalid rewardAmount' }, 400);
    if (!isValidMaxRedemptions(maxRedemptions)) return c.json({ error: 'invalid maxRedemptions' }, 400);

    let rewardId: string | null = null;
    if (rewardType === 'item') {
      rewardId = typeof body.rewardId === 'string' ? body.rewardId : '';
      if (!isItemId(rewardId)) return c.json({ error: 'invalid rewardId' }, 400);
    }
    if (!isValidExpiresAt(expiresAt)) return c.json({ error: 'invalid expiresAt' }, 400);

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

  // ── Admin: update a code's amount/cap/expiry (adminGate applied in app.ts) ─
  app.patch('/:code', async (c) => {
    const code = normalizeCode(c.req.param('code'));
    if (!code || code.length > MAX_CODE_LEN) return c.json({ error: 'invalid code' }, 400);
    let body: UpdateCodeRequest;
    try {
      body = await c.req.json<UpdateCodeRequest>();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }

    const patch: NormalizedUpdateCode = {};
    if (body.rewardAmount !== undefined) {
      if (!isValidRewardAmount(body.rewardAmount)) return c.json({ error: 'invalid rewardAmount' }, 400);
      patch.rewardAmount = body.rewardAmount;
    }
    if (body.maxRedemptions !== undefined) {
      if (!isValidMaxRedemptions(body.maxRedemptions)) return c.json({ error: 'invalid maxRedemptions' }, 400);
      patch.maxRedemptions = body.maxRedemptions;
    }
    if (body.expiresAt !== undefined) {
      if (!isValidExpiresAt(body.expiresAt)) return c.json({ error: 'invalid expiresAt' }, 400);
      patch.expiresAt = body.expiresAt;
    }

    // The table has CHECK(max_redemptions = 0 OR redeemed_count <= max_redemptions);
    // updateCode maps a violation to 'maxRedemptionsBelowRedeemed' at write time
    // rather than this route pre-checking it — a pre-check read is racy against
    // a redemption landing in between, and the write's own catch isn't.
    const outcome = await codeDb.updateCode(code, patch);
    switch (outcome) {
      case 'notFound':
        return c.json({ error: 'code not found' }, 404);
      case 'maxRedemptionsBelowRedeemed':
        return c.json({ error: 'maxRedemptions cannot be less than the already-redeemed count' }, 400);
      case 'ok':
        return c.json({ ok: true, code });
    }
  });

  // ── Admin: delete a code (adminGate applied in app.ts) ────────────────────
  app.delete('/:code', async (c) => {
    const code = normalizeCode(c.req.param('code'));
    if (!code || code.length > MAX_CODE_LEN) return c.json({ error: 'invalid code' }, 400);
    const ok = await codeDb.deleteCode(code);
    if (!ok) return c.json({ error: 'code not found' }, 404);
    return c.json({ ok: true });
  });

  return app;
}
