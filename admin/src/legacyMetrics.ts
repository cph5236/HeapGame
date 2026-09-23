// admin/src/legacyMetrics.ts
//
// Compatibility with workers that predate adaptive buckets (#188's
// `bucket=hour|day|week`, sparse rows labelled by strftime).
//
// The admin runs locally from whatever branch is checked out, while each
// Worker deploys from main — so the admin is routinely newer than the
// environment it points at. Rather than fail, it asks the old endpoint for
// hourly or daily rows and does the re-bucketing and zero-filling itself.

import {
  bucketSeconds, bucketStartMs, denseSeries, type MetricsBucket, type SeriesPoint,
} from '../../shared/metricsBuckets';

export type LegacyBucket = 'hour' | 'day';

/** Old-server rows: `bucket` is '2026-09-19T12:00:00Z' (hour) or '2026-09-19' (day). */
export interface LegacyRow { bucket: string; count: number }

/** The finest bucket an old worker can serve for a request, and what to ask it for. */
export function legacyPlan(requested: MetricsBucket): { source: LegacyBucket; effective: MetricsBucket } {
  const size = bucketSeconds(requested);
  if (size < 3_600) return { source: 'hour', effective: '1h' };
  return { source: size < 86_400 ? 'hour' : 'day', effective: requested };
}

/** True for the old worker's 400 on a bucket name it doesn't know. */
export function isLegacyBucketError(status: number, message: string): boolean {
  return status === 400 && message.includes('hour, day, week');
}

/**
 * Re-bucket sparse legacy rows into a dense series at `effective`.
 * Both legacy labels parse as UTC starts, and every `effective` bucket from
 * legacyPlan is a whole multiple of its source, so each row lands wholly in
 * one target bucket.
 */
export function legacyToSeries(
  rows: LegacyRow[], effective: MetricsBucket, sinceMs: number, untilMs: number,
): SeriesPoint[] {
  const sparse: { startMs: number; count: number }[] = [];
  for (const r of rows) {
    const ms = Date.parse(r.bucket);
    if (Number.isFinite(ms)) sparse.push({ startMs: bucketStartMs(ms, effective), count: Number(r.count) || 0 });
  }
  return denseSeries(sparse, effective, sinceMs, untilMs);
}
