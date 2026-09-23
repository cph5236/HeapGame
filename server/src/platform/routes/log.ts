import { Hono } from 'hono';
import type { Sink, StampedLogEntry } from '../logging/Sink';
import type { LogEntry, LogLevel } from '../../../../shared/logging/Logger';
import type { Platform } from '../../../../shared/logging/events';

const MAX_ENTRIES = 25;
const MAX_ENTRY_BYTES = 2 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const VALID_LEVELS: ReadonlySet<LogLevel> = new Set(['error', 'warn', 'event']);
const VALID_PLATFORMS: ReadonlySet<Platform> = new Set(['web', 'android', 'ios']);

function coerceStr(v: unknown, max = 1024): string {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

// Attacker-controlled and feeds AE double/blob columns directly, so it must be
// validated rather than passed through. Caps sit well under AE's limits (20
// each) while comfortably exceeding what the projection actually sends (5
// doubles, 1 blob) — see shared/logging/aeProjection.ts.
function coerceMetrics(v: unknown): LogEntry['metrics'] {
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;

  // REJECT the whole object on a bad element — never filter it out. These
  // arrays are POSITIONAL: the sink appends them after the fixed columns, so
  // doubles[0] is double2, doubles[1] is double3, and so on (see
  // shared/logging/aeProjection.ts). Dropping one bad element shifts every
  // later value one column left, which writes silently and cannot be undone
  // afterwards — a non-finite durationMs would leave pickupBonus sitting in
  // double5, which is exactly the column the crosstab's `duration` dimension
  // reads. Discarding one entry's promoted columns is cheap; corrupting the
  // dataset is not. Same posture as `bindParams` in aeClient.ts.
  //
  // The length caps apply FIRST and truncate rather than reject: dropping a
  // tail past the cap leaves every surviving element on its own column, so it
  // costs data but never misfiles it. Only an invalid element inside the kept
  // range can shift positions, and that is what rejects.
  const rawDoubles = Array.isArray(m.doubles) ? m.doubles.slice(0, 8) : undefined;
  if (rawDoubles?.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return undefined;
  const rawBlobs = Array.isArray(m.blobs) ? m.blobs.slice(0, 4) : undefined;
  if (rawBlobs?.some((s) => typeof s !== 'string')) return undefined;

  const doubles = rawDoubles as number[] | undefined;
  const blobs = (rawBlobs as string[] | undefined)?.map((s) => coerceStr(s, 64));
  if (!doubles?.length && !blobs?.length) return undefined;
  return { doubles, blobs };
}

function normalize(raw: unknown): LogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const level = r.level;
  const platform = r.platform;
  if (typeof level !== 'string' || !VALID_LEVELS.has(level as LogLevel)) return null;
  if (typeof platform !== 'string' || !VALID_PLATFORMS.has(platform as Platform)) return null;
  const timestamp = typeof r.timestamp === 'number' ? r.timestamp : Date.now();
  const payload = (r.payload && typeof r.payload === 'object') ? r.payload as Record<string, unknown> : {};
  return {
    userGuid:   coerceStr(r.userGuid, 64),
    sessionId:  coerceStr(r.sessionId, 64),
    appVersion: coerceStr(r.appVersion, 32),
    platform:   platform as Platform,
    userAgent:  coerceStr(r.userAgent, 200),
    level:      level as LogLevel,
    timestamp,
    eventType:  typeof r.eventType === 'string' ? coerceStr(r.eventType, 64) : undefined,
    message:    typeof r.message   === 'string' ? coerceStr(r.message, 1024) : undefined,
    payload,
    metrics:    coerceMetrics(r.metrics),
  };
}

export function logRoutes(getSink: () => Sink) {
  const r = new Hono();

  r.post('/log', async (c) => {
    // Body-size gate (cheap before JSON parse on big payloads).
    const lenHeader = c.req.header('content-length');
    if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
      return c.body(null, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.body(null, 400);
    }
    const rawEntries = (body && typeof body === 'object')
      ? (body as Record<string, unknown>).entries
      : undefined;
    if (!Array.isArray(rawEntries) || rawEntries.length === 0 || rawEntries.length > MAX_ENTRIES) {
      return c.body(null, 400);
    }

    let totalBytes = 0;
    const normalized: StampedLogEntry[] = [];
    const serverTimestamp = Date.now();
    for (const raw of rawEntries) {
      const json = JSON.stringify(raw ?? {});
      if (json.length > MAX_ENTRY_BYTES) return c.body(null, 400);
      totalBytes += json.length;
      if (totalBytes > MAX_BODY_BYTES) return c.body(null, 400);
      const e = normalize(raw);
      if (!e) return c.body(null, 400);
      normalized.push({ ...e, serverTimestamp });
    }

    // Best-effort write. Swallow sink errors so abuse / outages don't surface to clients.
    try {
      await getSink().write(normalized);
    } catch {
      // intentionally swallow
    }
    return c.body(null, 204);
  });

  return r;
}
