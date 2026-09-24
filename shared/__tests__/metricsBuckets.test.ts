import { describe, it, expect } from 'vitest';
import {
  autoBucket, bucketStartMs, bucketCount, denseSeries, isMetricsBucket,
} from '../metricsBuckets';

const H = 3_600_000;
const D = 86_400_000;
const at = (iso: string) => Date.parse(iso);

describe('bucketStartMs', () => {
  it('floors to the bucket on the UTC epoch grid', () => {
    expect(new Date(bucketStartMs(at('2026-09-23T10:07:59.999Z'), '5m')).toISOString())
      .toBe('2026-09-23T10:05:00.000Z');
    expect(new Date(bucketStartMs(at('2026-09-23T10:07:00Z'), '6h')).toISOString())
      .toBe('2026-09-23T06:00:00.000Z');
    expect(new Date(bucketStartMs(at('2026-09-23T23:59:59Z'), '1d')).toISOString())
      .toBe('2026-09-23T00:00:00.000Z');
  });

  it('starts weeks on Monday, not the epoch Thursday', () => {
    // 2026-09-23 is a Wednesday; its week starts Monday the 21st.
    expect(new Date(bucketStartMs(at('2026-09-23T12:00:00Z'), '1w')).toISOString())
      .toBe('2026-09-21T00:00:00.000Z');
    expect(new Date(bucketStartMs(at('2026-09-21T00:00:00Z'), '1w')).toISOString())
      .toBe('2026-09-21T00:00:00.000Z');
  });
});

describe('bucketCount', () => {
  it('counts partial buckets at both ends, half-open on until', () => {
    const since = at('2026-09-23T10:30:00Z');
    expect(bucketCount(since, since + 2 * H, '1h')).toBe(3);   // 10, 11, 12
    expect(bucketCount(at('2026-09-23T10:00:00Z'), at('2026-09-23T12:00:00Z'), '1h')).toBe(2);
  });
});

describe('autoBucket', () => {
  it('gets finer as the window shrinks', () => {
    const now = at('2026-09-23T12:34:00Z');
    expect(autoBucket(now - H, now)).toBe('1m');
    expect(autoBucket(now - 6 * H, now)).toBe('5m');
    expect(autoBucket(now - D, now)).toBe('15m');
    expect(autoBucket(now - 7 * D, now)).toBe('3h');
    expect(autoBucket(now - 30 * D, now)).toBe('6h');
    expect(autoBucket(now - 90 * D, now)).toBe('1d');
    expect(autoBucket(now - 365 * D, now)).toBe('1w');
  });
});

describe('denseSeries', () => {
  it('zero-fills every bucket in the window', () => {
    const since = at('2026-09-20T00:00:00Z');
    const series = denseSeries([{ startMs: at('2026-09-21T00:00:00Z'), count: 4 }], '1d', since, since + 3 * D);
    expect(series).toEqual([
      { t: '2026-09-20T00:00:00.000Z', count: 0 },
      { t: '2026-09-21T00:00:00.000Z', count: 4 },
      { t: '2026-09-22T00:00:00.000Z', count: 0 },
    ]);
  });
});

it('isMetricsBucket rejects anything off the list', () => {
  expect(isMetricsBucket('15m')).toBe(true);
  expect(isMetricsBucket('day')).toBe(false);
  expect(isMetricsBucket('toString')).toBe(false);
});
