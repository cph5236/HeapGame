import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { logRoutes } from '../src/routes/log';
import type { Sink, StampedLogEntry } from '../src/logging/Sink';

class MemSink implements Sink {
  written: StampedLogEntry[] = [];
  async write(e: StampedLogEntry[]) { this.written.push(...e); }
}

function makeApp(sink: Sink) {
  const app = new Hono();
  app.route('/', logRoutes(() => sink));
  return app;
}

const validEntry = {
  userGuid: 'u', sessionId: 's', appVersion: '1.0.0',
  platform: 'web', userAgent: 'ua', level: 'error',
  timestamp: 100, message: 'boom', payload: { x: 1 },
};

describe('POST /log', () => {
  let sink: MemSink;
  beforeEach(() => { sink = new MemSink(); });

  it('accepts a valid batch with 204', async () => {
    const app = makeApp(sink);
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [validEntry] }),
    });
    expect(res.status).toBe(204);
    expect(sink.written).toHaveLength(1);
    expect(sink.written[0].serverTimestamp).toEqual(expect.any(Number));
  });

  it('rejects empty batch with 400', async () => {
    const app = makeApp(sink);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects batches > 25 entries with 400', async () => {
    const app = makeApp(sink);
    const entries = Array.from({ length: 26 }, () => validEntry);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an entry > 2KB with 400', async () => {
    const big = { ...validEntry, payload: { blob: 'x'.repeat(3000) } };
    const app = makeApp(sink);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [big] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects total body > 64KB with 400', async () => {
    const entries = Array.from({ length: 20 }, () => ({
      ...validEntry, payload: { blob: 'x'.repeat(1900) },
    }));
    const app = makeApp(sink);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    expect(res.status).toBe(400);
  });

  it('truncates userAgent to 200 chars before writing', async () => {
    const longUa = { ...validEntry, userAgent: 'a'.repeat(500) };
    const app = makeApp(sink);
    await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [longUa] }),
    });
    expect(sink.written[0].userAgent).toHaveLength(200);
  });

  it('strips unknown top-level entry fields', async () => {
    const dirty = { ...validEntry, extra: 'nope' } as Record<string, unknown>;
    const app = makeApp(sink);
    await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [dirty] }),
    });
    expect(sink.written[0]).not.toHaveProperty('extra');
  });

  it('swallows sink failure and still returns 204 (best-effort)', async () => {
    const failing: Sink = { write: async () => { throw new Error('boom'); } };
    const app = makeApp(failing);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [validEntry] }),
    });
    // 204 — we never want clients retrying. Server-side error is internal.
    expect(res.status).toBe(204);
  });
});
