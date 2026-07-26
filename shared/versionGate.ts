// shared/versionGate.ts
//
// Pure logic for the remote-config minimum-version gate, shared by the worker
// (server/src/routes/config.ts validates writes with it) and the client
// (src/systems/UpdateGate.ts evaluates it at boot).
//
// The gate is a HARD floor, meant to be used rarely — a breaking API change or
// a severe client bug. Routine "a newer build exists" nudging is not this
// mechanism's job; that belongs to Play's in-app update flow, which already
// knows the latest published versionCode without us restating it here.
//
// Every helper fails OPEN: absent, malformed, or unparseable input yields "not
// blocked". A gate that errs toward blocking would lock players out of a
// single-player game over a typo'd config value, which is far worse than a
// stale client slipping through until the next launch.

/** Shape of the 'min_version' config value. */
export interface MinVersionConfig {
  /** Lowest client version allowed to run, as exact `major.minor.patch`. */
  version: string;
  /** Optional player-facing reason, shown on the update screen. */
  message?: string;
}

/** Config key the gate reads. */
export const MIN_VERSION_KEY = 'min_version';

/** Cap on the player-facing message so it stays renderable on a phone. */
export const MAX_GATE_MESSAGE_LENGTH = 200;

/** Admin writes must be an exact three-part version — no ranges, no partials. */
const STRICT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Parse a version into numeric segments, or null if it isn't version-shaped.
 *
 * Tolerant on the read side: missing segments default to 0 ('0.2' → [0,2,0])
 * and a build/prerelease suffix is ignored ('0.2.20-debug' → [0,2,20]), so an
 * Android debug build (versionNameSuffix '-debug') still compares sensibly.
 */
export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const core = value.trim().split(/[-+]/, 1)[0];
  if (core === '') return null;

  const parts = core.split('.');
  if (parts.length > 3) return null;

  const out: number[] = [0, 0, 0];
  for (let i = 0; i < parts.length; i++) {
    if (!/^\d+$/.test(parts[i])) return null;
    const n = Number(parts[i]);
    if (!Number.isSafeInteger(n)) return null;
    out[i] = n;
  }
  return [out[0], out[1], out[2]];
}

/**
 * Compare two versions segment-wise: negative if a < b, 0 if equal, positive if
 * a > b. Returns null when either side is unparseable, so callers must decide
 * explicitly rather than treating "unknown" as a silent 0.
 *
 * Note this is numeric per segment, not lexicographic — '0.2.9' < '0.2.10'.
 */
export function compareVersions(a: unknown, b: unknown): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Validate a raw 'min_version' config value, returning the normalized config or
 * null if it is malformed. Used by the worker to reject bad admin writes and by
 * the client to ignore anything that slipped through from an older schema.
 */
export function parseMinVersionConfig(value: unknown): MinVersionConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  if (typeof v.version !== 'string' || !STRICT_VERSION_PATTERN.test(v.version)) return null;

  if (v.message !== undefined) {
    if (typeof v.message !== 'string') return null;
    if (v.message.length > MAX_GATE_MESSAGE_LENGTH) return null;
  }

  return v.message === undefined
    ? { version: v.version }
    : { version: v.version, message: v.message };
}

/**
 * True when `clientVersion` is below the floor declared by `rawConfig`.
 *
 * Fails open on every uncertainty: no config, malformed config, or a client
 * version we can't parse all return false.
 */
export function isUpdateRequired(clientVersion: unknown, rawConfig: unknown): boolean {
  const config = parseMinVersionConfig(rawConfig);
  if (!config) return false;
  const cmp = compareVersions(clientVersion, config.version);
  if (cmp === null) return false;
  return cmp < 0;
}
