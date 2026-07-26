// Request bodies for the k6 scenarios.
//
// k6 has its own JS runtime and cannot import the project's TypeScript, so
// these are plain JS. The JSDoc @param/@returns annotations below are
// enforced by `tsc --noEmit -p loadtest/tsconfig.k6.json` (checkJs), run as
// part of `npm run test:loadtest-types` (itself part of `npm test`), against
// shared/heapTypes, shared/scoreTypes and shared/logging/Logger. A breaking
// change to any of those types fails that tsc pass instead of the k6 run
// silently measuring 400s.
//
// loadtest/__tests__/payload-contract.test.ts also imports this module (as
// untyped JS — see the @ts-expect-error there) purely for the *runtime*
// assertions (integer flooring, required-field presence, value pass-through).
// The type contract itself lives here, checked in place, not at that import
// site: an `any`-typed import can't be used to verify a return value's shape
// (assigning `any` to a typed variable never errors), so the structural
// check has to happen where the JSDoc is, via checkJs on this file.

/**
 * @param {{ x: number, y: number, playerGuid?: string }} args
 * @returns {import('../../../shared/heapTypes').PlaceRequest}
 */
export function buildPlaceBody({ x, y, playerGuid }) {
  // server/src/routes/heap.ts (~line 419) only requires x/y to be finite
  // numbers — no integer constraint — so these pass through untouched.
  return { x, y, playerGuid };
}

/**
 * @param {{
 *   heapId: string,
 *   playerId: string,
 *   playerName?: string,
 *   elapsedMs: number,
 *   kills: { percher: number, ghost: number, jumper?: number },
 *   baseHeightPx: number,
 *   isFailure: boolean,
 * }} args
 * @returns {import('../../../shared/scoreTypes').SubmitScoreRequest}
 */
export function buildScoreBody({
  heapId, playerId, playerName,
  elapsedMs, kills, baseHeightPx, isFailure,
}) {
  // server/src/routes/scores.ts rejects non-integer baseHeightPx and kill
  // counts outright (Number.isInteger checks), and requires elapsedMs >= 1.
  // jumper is optional on SubmitScoreInputs.kills — only floor/forward it
  // when the caller actually supplied one; typed up front (rather than
  // mutated onto a narrower-inferred literal) so checkJs can see 'jumper' as
  // a valid, optional member.
  /** @type {{ percher: number, ghost: number, jumper?: number }} */
  const killsOut = {
    percher: Math.floor(kills.percher),
    ghost: Math.floor(kills.ghost),
  };
  if (kills.jumper !== undefined) {
    killsOut.jumper = Math.floor(kills.jumper);
  }

  return {
    heapId,
    playerId,
    playerName,
    inputs: {
      baseHeightPx: Math.floor(baseHeightPx),
      kills: killsOut,
      elapsedMs: Math.max(1, Math.floor(elapsedMs)),
      isFailure,
      // salvageItems is optional on SubmitScoreInputs (shared/pickupScores.ts)
      // and not part of this builder's interface — omitted entirely.
    },
  };
}

const VALID_LOG_LEVELS = new Set(['error', 'warn', 'event']);
const VALID_PLATFORMS = new Set(['web', 'android', 'ios']);

/**
 * Builds the /log batch envelope. server/src/routes/log.ts (~line 43) expects
 * `{ entries: [...] }` where each entry needs a valid `level` ('error' |
 * 'warn' | 'event' — NOT 'info') and a valid `platform` ('web' | 'android' |
 * 'ios'); everything else (userGuid, sessionId, appVersion, userAgent) is
 * coerced to '' when absent/wrong-typed rather than rejected. The event name
 * and payload travel as `eventType` / `payload` (see shared/logging/Logger.ts
 * LogEntry), not `event` / `data` as their param names here might suggest —
 * `src/logging/RemoteLogger.ts:enqueue` is the authoritative client example.
 * `timestamp` is a numeric epoch (Date.now()), not an ISO string.
 *
 * @param {{ level: string, event?: string, data?: Record<string, unknown>, platform?: string }} args
 * @returns {{ entries: import('../../../shared/logging/Logger').LogEntry[] }}
 */
export function buildLogBody({ level, event, data, platform = 'web' }) {
  // Defensive: normalize an invalid level/platform to something the server
  // accepts, so a caller typo measures the log pipeline instead of the 400
  // handler.
  /** @type {import('../../../shared/logging/Logger').LogLevel} */
  const lvl = VALID_LOG_LEVELS.has(level)
    ? /** @type {import('../../../shared/logging/Logger').LogLevel} */ (level)
    : 'event';
  /** @type {import('../../../shared/logging/events').Platform} */
  const plat = VALID_PLATFORMS.has(platform)
    ? /** @type {import('../../../shared/logging/events').Platform} */ (platform)
    : 'web';

  return {
    entries: [
      {
        userGuid: '',
        sessionId: '',
        appVersion: '',
        platform: plat,
        userAgent: '',
        level: lvl,
        timestamp: Date.now(),
        eventType: event,
        payload: data ?? {},
      },
    ],
  };
}
