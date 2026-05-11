import { describe, it, expect } from 'vitest';
import { D1Sink } from '../src/logging/D1Sink';
import { AnalyticsEngineSink } from '../src/logging/AnalyticsEngineSink';
import type { StampedLogEntry } from '../src/logging/Sink';

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
});
