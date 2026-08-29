import type { Sink, StampedLogEntry } from './Sink';

/** Cloudflare AE indexes are capped at 32 bytes. A UUID has 32 hex chars
 *  once hyphens are stripped — a 1:1 reversible mapping that fits exactly. */
function userGuidIndex(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 32);
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
        ],
        doubles: [e.timestamp],
      });
    }
  }
}
