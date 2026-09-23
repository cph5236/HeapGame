import type { Sink, StampedLogEntry } from './Sink';

/**
 * The AE index for a player. Cloudflare caps an index at 96 bytes.
 *
 * A raw player GUID is a UUID, and stripping its hyphens yields exactly 32 hex
 * chars — a 1:1 reversible mapping, which is why that shape is preserved here.
 * But the envelope stamps `getEffectivePlayerId()`, which for a signed-in
 * player is a Google Play Games id: opaque, NOT a UUID, and up to MAX_ID_LEN
 * (64) characters. Hyphen-stripping is a no-op on it.
 *
 * Slicing to 32 would silently truncate such an id, irreversibly — two ids
 * sharing a 32-char prefix would collide into one player, and neither could be
 * mapped back to `player_auth.player_id` for a cohort join. So the cap is the
 * real AE limit, not 32.
 *
 * EXPORTED only so a test can assert `MAX_INDEX_BYTES >= MAX_ID_LEN`: that
 * inequality is the whole reason the truncation above is unreachable for a
 * real id, and raising `MAX_ID_LEN` past 96 without revisiting this would
 * silently reintroduce the collision this constant exists to prevent.
 */
export const MAX_INDEX_BYTES = 96;

/**
 * The AE `index1` form of a player id.
 *
 * EXPORTED because it is a join key, not a private detail. `player_auth.player_id`
 * in D1 keeps its hyphens; `index1` does not. Any query that filters AE by ids
 * taken from D1 must map them through this first, or it matches nothing at all
 * for every GUID player — see `server/src/platform/routes/analytics.ts`.
 */
export function userGuidIndex(playerId: string): string {
  const flat = playerId.replace(/-/g, '');
  // The AE cap is BYTES, and `.slice()` counts UTF-16 code units — equal only
  // while ids stay ASCII, which is true of both shapes today (hex GUID, GPGS
  // id) but is not something this function can assume about an id it is
  // handed. Measure the encoded length and trim to it.
  const bytes = new TextEncoder().encode(flat);
  if (bytes.length <= MAX_INDEX_BYTES) return flat;
  // `fatal: false` is the point: a cut landing mid-sequence yields U+FFFD
  // rather than throwing, so an over-long id is still written, just lossily.
  return new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, MAX_INDEX_BYTES))
    .replace(/\uFFFD+$/, '');
}

const MAX_PAYLOAD_BYTES = 4096;

/** Returns a JSON string for the payload that is guaranteed parseable. If the
 *  serialized payload exceeds MAX_PAYLOAD_BYTES, swap in a truncation stub
 *  rather than slicing mid-string (which would break downstream JSON.parse). */
function payloadJson(payload: Record<string, unknown> | undefined): string {
  const json = JSON.stringify(payload ?? {});
  if (json.length <= MAX_PAYLOAD_BYTES) return json;
  const head = json.slice(0, 1024);
  const stub = JSON.stringify({ truncated: true, originalSize: json.length, head });
  return stub.length <= MAX_PAYLOAD_BYTES
    ? stub
    : JSON.stringify({ truncated: true, originalSize: json.length });
}

export class AnalyticsEngineSink implements Sink {
  constructor(private ae: AnalyticsEngineDataset) {}

  async write(entries: StampedLogEntry[]): Promise<void> {
    for (const e of entries) {
      this.ae.writeDataPoint({
        indexes: [userGuidIndex(e.userGuid)],
        blobs: [
          e.level,
          e.eventType ?? e.message ?? '',
          e.platform,
          e.appVersion,
          e.sessionId,
          payloadJson(e.payload),
          e.userAgent.slice(0, 200),
          // blob8+ — caller-supplied, never interpreted here. Keeping this
          // sink free of game concepts is why the mapping lives in
          // shared/logging/aeProjection.ts instead.
          ...(e.metrics?.blobs ?? []),
        ],
        doubles: [e.timestamp, ...(e.metrics?.doubles ?? [])],
      });
    }
  }
}
