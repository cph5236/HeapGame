// shared/metricsBuckets.ts
//
// Time-bucket vocabulary for the admin metrics series. Shared so the server
// (which buckets and zero-fills) and the admin UI (which picks a bucket for the
// selected window and labels the axis) agree on sizes and alignment.
//
// Every bucket is a fixed number of seconds aligned to the UTC epoch, so a
// bucket's start is pure arithmetic — no calendar logic, no timezone. Weeks are
// the one exception to epoch alignment: the epoch fell on a Thursday, so week
// buckets are shifted to start on Monday (1970-01-05).

export const METRICS_BUCKETS = {
  '1m':  60,
  '5m':  300,
  '15m': 900,
  '1h':  3_600,
  '3h':  10_800,
  '6h':  21_600,
  '1d':  86_400,
  '1w':  604_800,
} as const;

export type MetricsBucket = keyof typeof METRICS_BUCKETS;

/** Smallest to largest — the order `autoBucket` walks. */
export const BUCKET_ORDER = Object.keys(METRICS_BUCKETS) as MetricsBucket[];

/** Seconds from the epoch to the first Monday, 1970-01-05T00:00:00Z. */
export const WEEK_OFFSET_S = 4 * 86_400;

/**
 * Hard ceiling on buckets per series. Guards the zero-fill loop and the
 * response size against a fine bucket over a long window (1m over a year is
 * half a million points). A request past it is rejected, not truncated — a
 * silently shortened series reads as "no players lately".
 */
export const MAX_SERIES_BUCKETS = 1_500;

/**
 * The bucket `auto` resolves to: the finest one that keeps the series at or
 * under this many points. ~100-130 is where a bar per bucket still reads as bars
 * at dashboard width; finer than that turns to noise.
 */
export const AUTO_TARGET_BUCKETS = 130;

export function isMetricsBucket(v: unknown): v is MetricsBucket {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(METRICS_BUCKETS, v);
}

export function bucketSeconds(b: MetricsBucket): number {
  return METRICS_BUCKETS[b];
}

/** Grid offset in seconds: 0 for everything except weeks (Monday start).
 *  Exported so the SQL in metricsDb binds the same value. */
export function bucketOffsetSeconds(b: MetricsBucket): number {
  return b === '1w' ? WEEK_OFFSET_S : 0;
}

/** Start of the bucket containing `ms`, in epoch milliseconds. */
export function bucketStartMs(ms: number, b: MetricsBucket): number {
  const size = bucketSeconds(b);
  const off = bucketOffsetSeconds(b);
  const s = Math.floor(ms / 1000);
  return (Math.floor((s - off) / size) * size + off) * 1000;
}

/** Number of buckets a `[sinceMs, untilMs)` window spans at this size. */
export function bucketCount(sinceMs: number, untilMs: number, b: MetricsBucket): number {
  if (untilMs <= sinceMs) return 0;
  const first = bucketStartMs(sinceMs, b);
  const last = bucketStartMs(untilMs - 1, b);
  return (last - first) / (bucketSeconds(b) * 1000) + 1;
}

/** The finest bucket that keeps the window at or under AUTO_TARGET_BUCKETS. */
export function autoBucket(sinceMs: number, untilMs: number): MetricsBucket {
  for (const b of BUCKET_ORDER) {
    if (bucketCount(sinceMs, untilMs, b) <= AUTO_TARGET_BUCKETS) return b;
  }
  return BUCKET_ORDER[BUCKET_ORDER.length - 1];
}

export interface SeriesPoint {
  /** Bucket start, ISO-8601 UTC. */
  t: string;
  count: number;
}

/**
 * A dense series over `[sinceMs, untilMs)`: one point per bucket, zero where
 * nothing landed. Sparse input is keyed by bucket start in epoch ms.
 *
 * Zero-fill matters for reading the chart: a line drawn straight from a
 * Monday to a Friday says "we had players Tuesday through Thursday" when the
 * truth is that there were none.
 */
export function denseSeries(
  sparse: ReadonlyArray<{ startMs: number; count: number }>,
  b: MetricsBucket, sinceMs: number, untilMs: number,
): SeriesPoint[] {
  const byStart = new Map<number, number>();
  for (const r of sparse) byStart.set(r.startMs, (byStart.get(r.startMs) ?? 0) + r.count);
  const step = bucketSeconds(b) * 1000;
  const n = bucketCount(sinceMs, untilMs, b);
  const first = bucketStartMs(sinceMs, b);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = first + i * step;
    out.push({ t: new Date(t).toISOString(), count: byStart.get(t) ?? 0 });
  }
  return out;
}
