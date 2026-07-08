// Player write-auth: trust-on-first-use secret verification.
// See docs/superpowers/specs/2026-07-07-player-write-auth-design.md

import type { Context } from 'hono';
import type { PlayerAuthDB } from './playerAuthDb';
import type { Sink } from './logging/Sink';
import { captureServer } from './logging/captureServerEvent';

export const PLAYER_TOKEN_HEADER = 'X-Player-Token';

export type AuthOutcome =
  | 'claimed'
  | 'verified'
  | 'legacy'
  | 'rejected-mismatch'
  | 'rejected-tokenless-claimed';

/** SHA-256 hex digest. Raw secrets are never stored — only this hash. */
export async function hashSecret(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyOrClaim(
  db: PlayerAuthDB,
  playerId: string,
  token: string | undefined,
  now: string,
): Promise<AuthOutcome> {
  const stored = await db.getSecretHash(playerId);
  if (!token) return stored === null ? 'legacy' : 'rejected-tokenless-claimed';

  const hash = await hashSecret(token);
  if (stored === null) {
    await db.insert(playerId, hash, now);
    // A concurrent first-write for the same unclaimed id may have landed between
    // the read above and this INSERT OR IGNORE. Re-read: if the stored hash is
    // not ours, the other token won the claim — reject rather than falsely
    // reporting success to a client whose secret was never actually stored.
    const after = await db.getSecretHash(playerId);
    return after === hash ? 'claimed' : 'rejected-mismatch';
  }
  return stored === hash ? 'verified' : 'rejected-mismatch';
}

/**
 * Route-level gate. Returns a generic 403 Response when the write must be
 * rejected, or null when it may proceed. When `db` is undefined (tests, or
 * feature not wired) behavior is legacy: always allow.
 */
export async function enforcePlayerAuth(
  c: Context,
  db: PlayerAuthDB | undefined,
  playerId: string,
  getSink: () => Sink | undefined,
  route: string,
): Promise<Response | null> {
  if (!db) return null;

  const token = c.req.header(PLAYER_TOKEN_HEADER) || undefined;
  const outcome = await verifyOrClaim(db, playerId, token, new Date().toISOString());

  const sink = getSink();
  if (outcome === 'claimed' && sink) {
    await captureServer(sink, 'event', 'auth:claimed', { playerId, route });
  }
  if (outcome === 'rejected-mismatch' || outcome === 'rejected-tokenless-claimed') {
    const reason = outcome === 'rejected-mismatch' ? 'mismatch' : 'tokenless-claimed';
    console.warn(`[auth] reject: ${reason} playerId=${playerId} route=${route}`);
    if (sink) {
      await captureServer(sink, 'warn', 'auth:rejected', { playerId, route, reason });
    }
    return c.json({ error: 'forbidden' }, 403);
  }
  return null;
}
