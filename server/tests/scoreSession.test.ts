// server/tests/scoreSession.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import type { OpenSessionResponse } from '../../shared/scoreTypes';
import { signSession } from '../src/runSession';
import type { SubmitScoreResponse } from '../../shared/scoreTypes';

const HEAP_ID = 'heap-test-001';
const PLAYER  = 'player-aaa';
const SECRET  = 'test-session-secret';

function makeApp(opts: { sessionSecret?: string; authDb?: MockPlayerAuthDB } = {}) {
  const heapDb = new MockHeapDB();
  heapDb.seedHeap(HEAP_ID, 1, []);
  return createApp(heapDb, new MockScoreDB(), {
    sessionSecret: opts.sessionSecret,
    playerAuthDb:  opts.authDb,
  });
}

function openSession(
  app: ReturnType<typeof makeApp>,
  body: object,
  token?: string,
) {
  return app.request('/scores/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Player-Token': token } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /scores/session', () => {
  it('issues a token for a valid request', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID });
    expect(res.status).toBe(200);
    const body = await res.json() as OpenSessionResponse;
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(2);
    expect(typeof body.issuedAt).toBe('number');
  });

  it('404s when no session secret is configured', async () => {
    const app = makeApp({});
    const res = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID });
    expect(res.status).toBe(404);
  });

  it('rejects a missing playerId', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { heapId: HEAP_ID });
    expect(res.status).toBe(400);
  });

  it('rejects a missing heapId', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { playerId: PLAYER });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long playerId', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { playerId: 'x'.repeat(200), heapId: HEAP_ID });
    expect(res.status).toBe(400);
  });

  it('403s when the player token does not match a claimed id', async () => {
    const authDb = new MockPlayerAuthDB();
    const app    = makeApp({ sessionSecret: SECRET, authDb });
    // First call claims the id with 'right-token'.
    const first = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID }, 'right-token');
    expect(first.status).toBe(200);
    // A different secret for the same id must be refused.
    const second = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID }, 'wrong-token');
    expect(second.status).toBe(403);
  });
});

const VALID_INPUTS = {
  baseHeightPx: 1000,
  kills: { percher: 0, ghost: 0 },
  elapsedMs: 60_000,
  isFailure: true,
};

function submit(app: ReturnType<typeof makeApp>, body: object) {
  return app.request('/scores', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

describe('POST /scores session enforcement', () => {
  it('rejects a submit with no session token', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await submit(app, { heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS });
    expect(res.status).toBe(400);
  });

  it('accepts a submit with a valid token', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    const token = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 90_000);
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS, sessionToken: token,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
  });

  it('rejects a token signed with a different key', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    const token = await signSession('other-secret', PLAYER, HEAP_ID, Date.now());
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS, sessionToken: token,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a token bound to a different heap', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    const token = await signSession(SECRET, PLAYER, 'heap-other', Date.now());
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS, sessionToken: token,
    });
    expect(res.status).toBe(400);
  });

  it('collapses the inflated-elapsedMs attack', async () => {
    // baseHeightPx 40_000 clears the height cap (maxClimbPx = worldHeight
    // 50_000 - top_y 0 + HEIGHT_GRACE_PX 200 = 50_200), so the only thing
    // that can reject this submission is the climb-rate cap. A 10s-old
    // token clamps to verifiedElapsedMs = 10_000 + GRACE_MS(5_000) = 15_000,
    // which permits only 400 * 15_000 / 1000 = 6_000px — far below 40_000.
    const attackInputs = { ...VALID_INPUTS, baseHeightPx: 40_000, elapsedMs: 99_999_999 };

    const app   = makeApp({ sessionSecret: SECRET });
    const token = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 10_000);
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, sessionToken: token, inputs: attackInputs,
    });
    expect(res.status).toBe(400);

    // Positive control: the identical body against an app with no session
    // secret configured must be accepted. This proves the 400 above is
    // caused by session-clamped climb-rate enforcement specifically, and
    // not by some other validator (e.g. the height cap) rejecting it too.
    const controlApp = makeApp({});
    const controlRes = await submit(controlApp, {
      heapId: HEAP_ID, playerId: PLAYER, inputs: attackInputs,
    });
    expect(controlRes.status).toBe(200);
  });

  it('still admits an honest run whose token arrived late', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    // Token 7 minutes old, run honestly reported as 10 minutes.
    const token = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 7 * 60_000);
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, sessionToken: token,
      inputs: { ...VALID_INPUTS, baseHeightPx: 20_000, elapsedMs: 10 * 60_000 },
    });
    expect(res.status).toBe(200);
  });

  it('does not let the clamp inflate the pace bonus', async () => {
    // THE regression test for this feature's single most important invariant:
    // verifiedElapsedMs gates the caps ONLY. Pace is height/seconds, so feeding
    // the clamped value into buildRunScore would RAISE the score when it bit.
    //
    // The two arms are chosen so the clamp BITES in one and not the other —
    // otherwise the test passes under the buggy implementation too:
    //   arm A: 10s-old token  -> verified = 10_000 + GRACE(5_000) = 15_000  (bites)
    //   arm B: 200s-old token -> verified = min(100_000, 205_000)  = 100_000 (no bite)
    // Correct impl scores pace floor(1000/100 * 10) = 100 in BOTH arms.
    // Buggy impl scores floor(1000/15 * 10) = 666 in arm A. Scores must match.
    // Both arms clear the climb cap: 1000*1000 <= 400*15_000.
    const inputs = { ...VALID_INPUTS, baseHeightPx: 1000, elapsedMs: 100_000, isFailure: false };

    const appClamped   = makeApp({ sessionSecret: SECRET });
    const clampedToken = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 10_000);
    const clampedRes   = await submit(appClamped, {
      heapId: HEAP_ID, playerId: PLAYER, inputs, sessionToken: clampedToken,
    });

    const appUnclamped   = makeApp({ sessionSecret: SECRET });
    const unclampedToken = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 200_000);
    const unclampedRes   = await submit(appUnclamped, {
      heapId: HEAP_ID, playerId: PLAYER, inputs, sessionToken: unclampedToken,
    });

    expect(clampedRes.status).toBe(200);
    expect(unclampedRes.status).toBe(200);
    const clampedBody   = await clampedRes.json() as SubmitScoreResponse;
    const unclampedBody = await unclampedRes.json() as SubmitScoreResponse;
    expect(clampedBody.context.player!.score).toBe(unclampedBody.context.player!.score);
  });

  it('is inert when no session secret is configured', async () => {
    const app = makeApp({});
    const res = await submit(app, { heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS });
    expect(res.status).toBe(200);
  });
});

// ── Where the late-token tradeoff actually bites ──────────────────────────────
//
// The clamp cannot distinguish "climbed fast" from "acquired the token late",
// so a badly-delayed token tightens the caps against an honest run. The spec
// accepts this; these two tests pin WHERE the boundary sits rather than leaving
// it to be discovered in production. The existing late-token test uses a wide
// safety margin, which is why it never exercises the failing side.
describe('POST /scores late-token boundary', () => {
  // An honest 5-minute run climbing 30_000px.
  const honestRun = { ...VALID_INPUTS, baseHeightPx: 30_000, elapsedMs: 300_000 };

  it('accepts an honest run whose token was acquired promptly', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    // Token issued at run start -> verified window ~300s -> cap permits 120_000px.
    const token = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 300_000);
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, inputs: honestRun, sessionToken: token,
    });
    expect(res.status).toBe(200);
  });

  it('rejects the same honest run when the token arrived 20s before submit', async () => {
    // ACCEPTED COST, not a bug: the player was offline for nearly the whole run,
    // so the server can only vouch for 20s + GRACE = 25s, and 400 y/s permits
    // just 10_000px against the 30_000px actually climbed.
    const app   = makeApp({ sessionSecret: SECRET });
    const token = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 20_000);
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, inputs: honestRun, sessionToken: token,
    });
    expect(res.status).toBe(400);
  });
});
