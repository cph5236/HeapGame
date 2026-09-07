// src/systems/referral.ts
//
// First-touch acquisition marker. A shared link carries `?ref=<source>` (see
// shareRun.ts, which stamps `ref=run`); this records that the visit arrived
// through one, so the share loop can be measured at both ends: `share:run`
// counts messages sent, `visit:referred` counts people who showed up because
// of one.
//
// Deliberately NOT stored in the SaveData blob: this is device-local
// acquisition metadata, not player state, and keeping it out avoids putting a
// migration in the path of a save that has auth rules attached to it.

import type { GameEvent } from '../../shared/logging/events';

/** Query param a shared link carries. */
export const REF_PARAM = 'ref';

/** localStorage key holding the first ref this browser ever arrived with. */
export const REF_STORAGE_KEY = 'heap_ref';

/** Values longer than this are dropped rather than truncated — a long value is
 *  a sign of a crafted url, not of a real campaign name. */
const MAX_REF_LEN = 32;

/** The only shape a marker may take. The value reaches a log payload and is
 *  fully attacker-controllable through a crafted url, so anything outside this
 *  is rejected outright rather than cleaned up and kept. */
const SAFE_REF = /^[a-z0-9_-]+$/;

/** Extracts the acquisition marker from a query string, or null if there isn't
 *  a usable one. Case-folded so `?ref=Run` and `?ref=run` are one source. */
export function parseRef(search: string): string | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get(REF_PARAM);
  } catch {
    return null;
  }
  if (!raw) return null;

  const ref = raw.toLowerCase();
  if (ref.length > MAX_REF_LEN) return null;
  return SAFE_REF.test(ref) ? ref : null;
}

/** First-touch rule: only the visit that introduced this browser to the game
 *  counts. A returning player following another shared link is not a new
 *  acquisition, and counting them again would inflate the loop it measures. */
export function shouldRecordRef(ref: string | null, stored: string | null): boolean {
  return ref !== null && stored === null;
}

/**
 * Records an arrival, if this visit is a first touch through a marked link.
 *
 * `storage` and `emit` are injected so the decision is testable without a
 * browser or a live logger. Storage failures are swallowed: a blocked
 * localStorage (private mode, cookies off) must not take the boot sequence
 * down, and losing the dedupe is a far smaller cost than losing the boot.
 */
export function recordReferral(
  search: string,
  storage: Storage | undefined,
  emit: (event: GameEvent) => void,
): void {
  const ref = parseRef(search);
  if (ref === null) return;

  // No storage, or storage that throws, both leave `stored` null — and a null
  // `stored` is exactly what shouldRecordRef treats as a first touch. So an
  // unusable store degrades to "report it", which is the intended trade: losing
  // the dedupe costs a possible repeat, losing the boot costs everything. A
  // `storageUsable` flag used to guard this line; it could never change the
  // outcome, because every path that set it false also left `stored` null.
  let stored: string | null = null;
  try {
    stored = storage?.getItem(REF_STORAGE_KEY) ?? null;
  } catch {
    /* unreadable — treated as a first touch, see above */
  }

  if (!shouldRecordRef(ref, stored)) return;

  try {
    storage?.setItem(REF_STORAGE_KEY, ref);
  } catch {
    // Unwritable — the arrival is still worth reporting, it just may repeat.
  }

  emit({ type: 'visit:referred', ref });
}
