// Stateless run-session tokens: a server-attested timestamp binding a score
// submission's claimed elapsedMs to real wall-clock time.
// See docs/superpowers/specs/2026-08-12-run-session-tokens-design.md

/** Covers the issue round-trip so honest clients are never clamped by latency. */
export const GRACE_MS = 5_000;
/** A token older than this is dead — hygiene against indefinite hoarding. */
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
/** Hard ceiling on creditable run length; this is what defeats token farming. */
export const MAX_RUN_MS = 60 * 60 * 1000;

/**
 * Upper bound on an accepted token string, so callers can reject an oversized
 * one before paying for base64-decoding and an HMAC verify over it.
 *
 * Worst case for a real token is ~259 chars: the payload JSON holds two ids of
 * at most MAX_ID_LEN (64) plus a 13-digit timestamp — about 161 bytes, 215 as
 * base64url — then a dot and a 43-char signature. 512 leaves generous headroom
 * while staying far below anything that costs measurable CPU.
 */
export const MAX_SESSION_TOKEN_LEN = 512;

export type SessionFailure =
  | 'no-session'
  | 'bad-session-sig'
  | 'session-mismatch'
  | 'session-expired';

export type VerifyResult =
  | { ok: true;  issuedAt: number }
  | { ok: false; reason: SessionFailure };

/** Wire payload. Short keys keep the token small; JSON avoids delimiter injection. */
interface Payload { p: string; h: string; i: number }

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin    = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out    = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Derived keys cached per secret. The key depends only on the secret, and both
 * signing and verification sit on hot paths — every session open and every
 * score submit would otherwise pay an `importKey` round-trip.
 *
 * Keyed BY the secret, deliberately: a single module-scoped key would let a
 * token signed under one secret verify under another, which would defeat the
 * signature check during a secret rotation (and silently break the
 * "rejects a token signed with a different key" guarantee).
 *
 * The Promise is cached rather than the resolved key so concurrent callers
 * share one import instead of racing to create duplicates.
 */
const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) return cached;

  const pending = crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  ).catch((err) => {
    // Never leave a rejected promise cached — it would poison every later call.
    keyCache.delete(secret);
    throw err;
  });

  keyCache.set(secret, pending);
  return pending;
}

export async function signSession(
  secret: string,
  playerId: string,
  heapId: string,
  issuedAt: number,
): Promise<string> {
  const payload: Payload = { p: playerId, h: heapId, i: issuedAt };
  const encoded = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const key     = await importKey(secret);
  const sig     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

export async function verifySession(
  secret: string,
  token: string | undefined,
  playerId: string,
  heapId: string,
  now: number,
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: 'no-session' };

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'bad-session-sig' };
  }
  const [encoded, sig] = parts;

  let sigBytes: Uint8Array;
  try {
    sigBytes = bytesFromB64url(sig);
  } catch {
    return { ok: false, reason: 'bad-session-sig' };
  }

  // subtle.verify compares in constant time — never compare signatures with ===.
  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC', key, sigBytes, new TextEncoder().encode(encoded),
  );
  if (!valid) return { ok: false, reason: 'bad-session-sig' };

  let payload: Payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(encoded))) as Payload;
  } catch {
    return { ok: false, reason: 'bad-session-sig' };
  }
  if (typeof payload?.i !== 'number' || !Number.isFinite(payload.i)) {
    return { ok: false, reason: 'bad-session-sig' };
  }
  if (payload.p !== playerId || payload.h !== heapId) {
    return { ok: false, reason: 'session-mismatch' };
  }
  if (now - payload.i > MAX_SESSION_MS) {
    return { ok: false, reason: 'session-expired' };
  }
  return { ok: true, issuedAt: payload.i };
}

/**
 * Elapsed time the server is willing to vouch for. Gates the plausibility caps
 * ONLY — never the score, because pace is inversely proportional to elapsed time
 * and clamping it into buildRunScore would inflate scores.
 *
 * Floored at 1 so the rate caps can never divide by zero on a future-dated or
 * same-instant token. A non-finite claim (NaN/Infinity/-Infinity) is treated
 * as 0 before clamping, so it also floors to 1 rather than propagating NaN —
 * `Math.min`/`Math.max` pass NaN through unconditionally, which would fail a
 * downstream `if (rate > CAP) reject` check open instead of closed.
 */
export function clampElapsedMs(claimedMs: number, issuedAt: number, now: number): number {
  const safeClaim = Number.isFinite(claimedMs) ? claimedMs : 0;
  const window    = (now - issuedAt) + GRACE_MS;
  return Math.max(1, Math.min(safeClaim, window, MAX_RUN_MS));
}
