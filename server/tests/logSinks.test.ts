import { describe, it, expect } from 'vitest';
import { D1Sink } from '../src/logging/D1Sink';
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
