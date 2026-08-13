// server/tests/runSession.test.ts

import { describe, it, expect } from 'vitest';
import {
  signSession,
  verifySession,
  clampElapsedMs,
  GRACE_MS,
  MAX_RUN_MS,
  MAX_SESSION_MS,
} from '../src/runSession';

const SECRET  = 'test-secret-0123456789abcdef';
const PLAYER  = 'player-aaa';
const HEAP    = 'heap-test-001';
const NOW     = 1_700_000_000_000;

describe('signSession / verifySession', () => {
  it('round-trips a freshly signed token', async () => {
    const token = await signSession(SECRET, PLAYER, HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW + 1000);
    expect(res).toEqual({ ok: true, issuedAt: NOW });
  });

  it('rejects an absent token', async () => {
    const res = await verifySession(SECRET, undefined, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'no-session' });
  });

  it('rejects an empty token', async () => {
    const res = await verifySession(SECRET, '', PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'no-session' });
  });

  it('rejects a token signed with a different key', async () => {
    const token = await signSession('another-secret', PLAYER, HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'bad-session-sig' });
  });

  it('rejects a tampered payload', async () => {
    const token             = await signSession(SECRET, PLAYER, HEAP, NOW);
    const [, sig]           = token.split('.');
    const forgedPayload     = Buffer.from(
      JSON.stringify({ p: PLAYER, h: HEAP, i: NOW - MAX_SESSION_MS }),
      'utf8',
    ).toString('base64url');
    const res = await verifySession(SECRET, `${forgedPayload}.${sig}`, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'bad-session-sig' });
  });

  it('rejects a tampered signature', async () => {
    const token       = await signSession(SECRET, PLAYER, HEAP, NOW);
    const [payload]   = token.split('.');
    const res = await verifySession(SECRET, `${payload}.AAAA`, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'bad-session-sig' });
  });

  it.each([
    ['no separator',   'abcdef'],
    ['empty payload',  '.AAAA'],
    ['empty sig',      'AAAA.'],
    ['too many parts', 'a.b.c'],
    ['not base64url',  '!!!.???'],
  ])('rejects a malformed token (%s)', async (_label, token) => {
    const res = await verifySession(SECRET, token, PLAYER, HEAP, NOW);
    expect(res.ok).toBe(false);
    expect(res).toHaveProperty('reason', 'bad-session-sig');
  });

  it('rejects a token bound to a different player', async () => {
    const token = await signSession(SECRET, 'player-bbb', HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'session-mismatch' });
  });

  it('rejects a token bound to a different heap', async () => {
    const token = await signSession(SECRET, PLAYER, 'heap-other', NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'session-mismatch' });
  });

  it('rejects a token older than MAX_SESSION_MS', async () => {
    const token = await signSession(SECRET, PLAYER, HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW + MAX_SESSION_MS + 1);
    expect(res).toEqual({ ok: false, reason: 'session-expired' });
  });

  it('accepts a token exactly at MAX_SESSION_MS', async () => {
    const token = await signSession(SECRET, PLAYER, HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW + MAX_SESSION_MS);
    expect(res).toEqual({ ok: true, issuedAt: NOW });
  });

  it('does not let a delimiter in playerId shift field boundaries', async () => {
    const sneaky = `x|${HEAP}|${NOW}`;
    const token  = await signSession(SECRET, sneaky, HEAP, NOW);
    // The token is valid only for the literal sneaky id, not for 'x'.
    expect(await verifySession(SECRET, token, sneaky, HEAP, NOW)).toEqual({ ok: true, issuedAt: NOW });
    expect(await verifySession(SECRET, token, 'x', HEAP, NOW)).toEqual({ ok: false, reason: 'session-mismatch' });
  });
});

describe('clampElapsedMs', () => {
  it('returns the claim when it fits inside the verified window', () => {
    // claimed 60s, window 120s + grace
    expect(clampElapsedMs(60_000, NOW - 120_000, NOW)).toBe(60_000);
  });

  it('clamps the attack case to the verified window plus grace', () => {
    // 10s-old token, absurd claim -> 10s + 5s grace
    expect(clampElapsedMs(99_999_999, NOW - 10_000, NOW)).toBe(10_000 + GRACE_MS);
  });

  it('clamps to MAX_RUN_MS for a very old token', () => {
    expect(clampElapsedMs(99_999_999, NOW - MAX_SESSION_MS, NOW)).toBe(MAX_RUN_MS);
  });

  it('leaves a late-token run comfortably passable', () => {
    // token arrived 3 min into a 10 min run -> 7 min window
    const claimed = 10 * 60_000;
    const result  = clampElapsedMs(claimed, NOW - 7 * 60_000, NOW);
    expect(result).toBe(7 * 60_000 + GRACE_MS);
    // A real 10-minute run climbs far less than the cap this permits.
    expect(400 * (result / 1000)).toBeGreaterThan(100_000);
  });

  it('never returns a value below 1, even for a future-dated token', () => {
    // Guards against divide-by-zero in the rate caps.
    expect(clampElapsedMs(60_000, NOW + 999_999, NOW)).toBe(1);
  });
});
