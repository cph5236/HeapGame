import { describe, it, expect } from 'vitest';
import { D1Sink } from '../src/platform/logging/D1Sink';
import { AnalyticsEngineSink } from '../src/platform/logging/AnalyticsEngineSink';
import type { StampedLogEntry } from '../src/platform/logging/Sink';

function fakeD1() {
  // NOTE: each prepare() builds a per-statement closure so that concurrent
  // prepares (e.g. via Promise.all) don't alias each other's SQL through a
  // shared outer variable. Required for correctness if D1Sink ever batches.
  const inserts: { sql: string; params: unknown[] }[] = [];
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return { run: async () => { inserts.push({ sql, params }); } };
        },
      };
    },
    batch: async (_stmts: any[]) => { /* not used here */ },
  } as any;
  return { d1, inserts };
}

function fakeAE() {
  const points: { indexes: string[]; blobs: string[]; doubles: number[] }[] = [];
  const ae = { writeDataPoint: (p: any) => { points.push(p); } } as any;
  return { ae, points };
}

const entry = (over: Partial<StampedLogEntry> = {}): StampedLogEntry => ({
  userGuid: 'u', sessionId: 's', appVersion: '1.0.0',
  platform: 'web', userAgent: 'ua', level: 'error',
  timestamp: 100, eventType: undefined, message: 'boom',
  payload: { x: 1 }, serverTimestamp: 200, ...over,
});

describe('D1Sink', () => {
  it('inserts each entry with the expected bound params', async () => {
    const { d1, inserts } = fakeD1();
    const sink = new D1Sink(d1);
    await sink.write([entry()]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/INSERT INTO logs/);
    expect(inserts[0].params).toEqual([
      'u', 's', 'error', null, 'boom',
      JSON.stringify({ x: 1 }), 'web', '1.0.0', 'ua', 100, 200,
    ]);
  });

  it('writes event_type when level=event and message=null', async () => {
    const { d1, inserts } = fakeD1();
    const sink = new D1Sink(d1);
    await sink.write([entry({ level: 'event', message: undefined, eventType: 'run:start' })]);
    expect(inserts[0].params[2]).toBe('event');
    expect(inserts[0].params[3]).toBe('run:start');
    expect(inserts[0].params[4]).toBeNull();
  });
});

describe('AnalyticsEngineSink', () => {
  it('maps each entry to writeDataPoint with the documented schema', async () => {
    const calls: any[] = [];
    const fakeAE = { writeDataPoint: (dp: any) => calls.push(dp) } as any;
    const sink = new AnalyticsEngineSink(fakeAE);
    const e: StampedLogEntry = {
      userGuid: '550e8400-e29b-41d4-a716-446655440000',
      sessionId: 'sess',
      appVersion: '1.0.0',
      platform: 'web',
      userAgent: 'ua',
      level: 'event',
      timestamp: 12345,
      eventType: 'run:end',
      message: undefined,
      payload: { heapId: 'h' },
      serverTimestamp: 67890,
    };
    await sink.write([e]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      indexes: ['550e8400e29b41d4a716446655440000'], // hyphens stripped, 32 chars
      blobs: [
        'event', 'run:end', 'web', '1.0.0', 'sess',
        JSON.stringify({ heapId: 'h' }), 'ua',
      ],
      doubles: [12345],
    });
    expect(calls[0].indexes[0]).toHaveLength(32);
  });

  it('uses message for blob2 when no eventType', async () => {
    const calls: any[] = [];
    const sink = new AnalyticsEngineSink({ writeDataPoint: (dp: any) => calls.push(dp) } as any);
    await sink.write([{
      userGuid: '00000000-0000-0000-0000-000000000000',
      sessionId: 's', appVersion: '1', platform: 'web', userAgent: 'u',
      level: 'error', timestamp: 1, message: 'boom', payload: {},
      serverTimestamp: 2,
    }]);
    expect(calls[0].blobs[1]).toBe('boom');
  });

  it('replaces oversize payload with a valid-JSON truncation stub (parseable)', async () => {
    const calls: any[] = [];
    const sink = new AnalyticsEngineSink({ writeDataPoint: (dp: any) => calls.push(dp) } as any);
    await sink.write([{
      userGuid: '00000000-0000-0000-0000-000000000000',
      sessionId: 's', appVersion: '1', platform: 'web', userAgent: 'u',
      level: 'error', timestamp: 1, message: 'm',
      payload: { blob: 'x'.repeat(8000) }, serverTimestamp: 2,
    }]);
    const blob6 = calls[0].blobs[5];
    expect(blob6.length).toBeLessThanOrEqual(4096);
    // Must still parse — slice-mid-string would break downstream JSON.parse queries.
    const parsed = JSON.parse(blob6);
    expect(parsed.truncated).toBe(true);
    expect(typeof parsed.originalSize).toBe('number');
  });

  it('preserves a 64-char non-UUID player id in the index', async () => {
    const { ae, points } = fakeAE();
    const gpgsId = 'g'.repeat(64); // GPGS ids are opaque and not UUIDs
    await new AnalyticsEngineSink(ae).write([entry({ userGuid: gpgsId })]);
    expect(points[0].indexes[0]).toBe(gpgsId);
  });

  it('does not collide two ids that share a 32-char prefix', async () => {
    const { ae, points } = fakeAE();
    const a = 'x'.repeat(32) + 'aaaa';
    const b = 'x'.repeat(32) + 'bbbb';
    await new AnalyticsEngineSink(ae).write([entry({ userGuid: a }), entry({ userGuid: b })]);
    expect(points[0].indexes[0]).not.toBe(points[1].indexes[0]);
  });

  it('still maps a hyphenated UUID to its 32-char hex form', async () => {
    const { ae, points } = fakeAE();
    await new AnalyticsEngineSink(ae).write([
      entry({ userGuid: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }),
    ]);
    expect(points[0].indexes[0]).toBe('3f2504e04f8911d39a0c0305e82c3301');
  });

  it('truncates an over-long id at the AE byte limit rather than silently exceeding it', async () => {
    const { ae, points } = fakeAE();
    await new AnalyticsEngineSink(ae).write([entry({ userGuid: 'z'.repeat(200) })]);
    expect(points[0].indexes[0].length).toBeLessThanOrEqual(96);
  });

  it('appends caller-supplied metric columns after the fixed layout', async () => {
    const { ae, points } = fakeAE();
    await new AnalyticsEngineSink(ae).write([entry({
      level: 'event', eventType: 'run:end',
      metrics: { doubles: [1200, 340, 5, 61000, 40], blobs: ['death'] },
    })]);
    // double1 stays the client timestamp; the projection follows it
    expect(points[0].doubles).toEqual([100, 1200, 340, 5, 61000, 40]);
    // blob8 follows the seven fixed blobs
    expect(points[0].blobs).toHaveLength(8);
    expect(points[0].blobs[7]).toBe('death');
  });

  it('writes the fixed layout unchanged when no metrics are supplied', async () => {
    const { ae, points } = fakeAE();
    await new AnalyticsEngineSink(ae).write([entry()]);
    expect(points[0].doubles).toEqual([100]);
    expect(points[0].blobs).toHaveLength(7);
  });
});
