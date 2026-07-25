import { describe, it, expect, expectTypeOf } from 'vitest';
import type { PlaceRequest } from '../../shared/heapTypes';
import type { SubmitScoreRequest } from '../../shared/scoreTypes';
import type { LogEntry } from '../../shared/logging/Logger';
// @ts-expect-error — plain JS module shared with the k6 runtime, no types
import { buildPlaceBody, buildScoreBody, buildLogBody } from '../k6/lib/payloads.js';

describe('k6 payloads satisfy the shared request types', () => {
  it('buildPlaceBody produces a valid PlaceRequest', () => {
    const body: PlaceRequest = buildPlaceBody({ x: 10, y: 500, playerGuid: 'p1' });
    expectTypeOf(body).toMatchTypeOf<PlaceRequest>();
    expect(body.x).toBe(10);
    expect(body.y).toBe(500);
    expect(body.playerGuid).toBe('p1');
  });

  it('buildScoreBody produces a valid SubmitScoreRequest', () => {
    const body: SubmitScoreRequest = buildScoreBody({
      heapId: 'h1',
      playerId: 'p1',
      playerName: 'Tester',
      elapsedMs: 30_000,
      kills: { percher: 1, ghost: 0 },
      baseHeightPx: 1200,
      isFailure: false,
    });
    expectTypeOf(body).toMatchTypeOf<SubmitScoreRequest>();
    expect(body.heapId).toBe('h1');
    expect(body.playerId).toBe('p1');
    expect(body.playerName).toBe('Tester');
    expect(body.inputs.baseHeightPx).toBe(1200);
    expect(body.inputs.kills.percher).toBe(1);
    expect(body.inputs.kills.ghost).toBe(0);
    expect(body.inputs.isFailure).toBe(false);
    // salvageItems is optional on SubmitScoreInputs (shared/pickupScores.ts)
    // and this builder's interface has no param for it — must stay absent
    // rather than a stray null/[] the server would still have to parse.
    expect(body.inputs.salvageItems).toBeUndefined();
  });

  it('buildScoreBody emits integers where the server demands them', () => {
    // server/src/routes/scores.ts rejects non-integer baseHeightPx / kill
    // counts outright (Number.isInteger checks) and requires elapsedMs >= 1.
    const body = buildScoreBody({
      heapId: 'h1', playerId: 'p1', playerName: 'T',
      elapsedMs: 1234.7, kills: { percher: 1.4, ghost: 2.9 },
      baseHeightPx: 900.6, isFailure: false,
    });
    expect(Number.isInteger(body.inputs.baseHeightPx)).toBe(true);
    expect(Number.isInteger(body.inputs.kills.percher)).toBe(true);
    expect(Number.isInteger(body.inputs.kills.ghost)).toBe(true);
    expect(body.inputs.elapsedMs).toBeGreaterThanOrEqual(1);

    // elapsedMs below the 1ms floor must still clamp up, not just floor down.
    const clamped = buildScoreBody({
      heapId: 'h1', playerId: 'p1', playerName: 'T',
      elapsedMs: 0.2, kills: { percher: 0, ghost: 0 },
      baseHeightPx: 0, isFailure: true,
    });
    expect(clamped.inputs.elapsedMs).toBe(1);
  });

  it('buildLogBody produces a batch envelope matching the real /log contract', () => {
    // server/src/routes/log.ts (~line 43) expects `{ entries: [...] }` where
    // each entry has `eventType` / `payload` (not `event` / `data`), a
    // numeric `timestamp` (not an ISO string `ts`), a required `level` drawn
    // from 'error' | 'warn' | 'event' (NOT 'info' — the brief's original
    // guess), and a required `platform` from 'web' | 'android' | 'ios'.
    const body: { entries: LogEntry[] } = buildLogBody({
      level: 'event',
      event: 'loadtest:tick',
      data: { n: 1 },
    });

    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries).toHaveLength(1);

    const entry = body.entries[0];
    expect(entry.level).toBe('event');
    expect(entry.eventType).toBe('loadtest:tick');
    expect(entry.payload).toEqual({ n: 1 });
    expect(['web', 'android', 'ios']).toContain(entry.platform);
    expect(typeof entry.timestamp).toBe('number');
    expect(Number.isFinite(entry.timestamp)).toBe(true);
    // 'ts'/'event'/'data' must not leak through as stray keys the server
    // would just ignore.
    expect(entry).not.toHaveProperty('ts');
    expect(entry).not.toHaveProperty('event');
    expect(entry).not.toHaveProperty('data');
  });

  it('buildLogBody rejects a bogus level rather than sending one the server 400s on', () => {
    // 'info' is not a valid LogLevel (shared/logging/Logger.ts) — the
    // server's VALID_LEVELS set would reject it outright.
    const body = buildLogBody({ level: 'info', event: 'x', data: {} });
    expect(['error', 'warn', 'event']).toContain(body.entries[0].level);
  });
});
