import { describe, it, expect } from 'vitest';
import { legacyPlan, legacyToSeries, isLegacyBucketError } from '../legacyMetrics';

describe('legacyPlan', () => {
  it('floors sub-hour requests to hourly and picks the finest legacy source', () => {
    expect(legacyPlan('15m')).toEqual({ source: 'hour', effective: '1h' });
    expect(legacyPlan('6h')).toEqual({ source: 'hour', effective: '6h' });
    expect(legacyPlan('1w')).toEqual({ source: 'day', effective: '1w' });
  });
});

describe('legacyToSeries', () => {
  it('re-buckets hourly strftime labels into 3h buckets and zero-fills', () => {
    const since = Date.parse('2026-09-23T00:00:00Z');
    const rows = legacyToSeries(
      [{ bucket: '2026-09-23T01:00:00Z', count: 2 }, { bucket: '2026-09-23T02:00:00Z', count: 3 }],
      '3h', since, since + 9 * 3_600_000);
    expect(rows.map((r) => r.count)).toEqual([5, 0, 0]);
  });

  it('rolls daily labels into Monday-start weeks', () => {
    const rows = legacyToSeries(
      [{ bucket: '2026-09-20', count: 1 }, { bucket: '2026-09-21', count: 4 }], // Sun, Mon
      '1w', Date.parse('2026-09-14T00:00:00Z'), Date.parse('2026-09-28T00:00:00Z'));
    expect(rows).toEqual([
      { t: '2026-09-14T00:00:00.000Z', count: 1 },
      { t: '2026-09-21T00:00:00.000Z', count: 4 },
    ]);
  });
});

it('recognises only the old worker\'s bucket rejection', () => {
  expect(isLegacyBucketError(400, '400 — bucket must be one of: hour, day, week')).toBe(true);
  expect(isLegacyBucketError(400, '400 — since must be before until')).toBe(false);
  expect(isLegacyBucketError(401, 'hour, day, week')).toBe(false);
});
