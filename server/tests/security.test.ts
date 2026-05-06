import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import type { CreateHeapResponse } from '../../shared/heapTypes';
import type { RateLimiter } from '../src/middleware/rateLimit';

const VERTICES = [
  { x: 100, y: 400 },
  { x: 300, y: 600 },
  { x: 500, y: 400 },
];

function makeApp(allowedOrigins?: string) {
  return createApp(new MockHeapDB(), new MockScoreDB(), { allowedOrigins });
}

describe('CORS allowlist', () => {
  it('echoes Access-Control-Allow-Origin for an allowed origin', async () => {
    const res = await makeApp('https://heap.example.com').request('/heaps', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://heap.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://heap.example.com');
  });

  it('omits Access-Control-Allow-Origin for a disallowed origin', async () => {
    const res = await makeApp('https://heap.example.com').request('/heaps', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://attacker.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('defaults to wildcard when no allowedOrigins is provided', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://anywhere.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://anywhere.example.com');
  });
});

describe('Admin secret gate', () => {
  function makeAppWithSecret(secret: string) {
    return createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: secret });
  }

  it('rejects POST /heaps without X-Admin-Secret', async () => {
    const res = await makeAppWithSecret('s3cret').request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /heaps with wrong X-Admin-Secret', async () => {
    const res = await makeAppWithSecret('s3cret').request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'nope' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(401);
  });

  it('accepts POST /heaps with correct X-Admin-Secret', async () => {
    const res = await makeAppWithSecret('s3cret').request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 's3cret' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(201);
  });

  it('does not gate read endpoints (GET /heaps)', async () => {
    const res = await makeAppWithSecret('s3cret').request('/heaps');
    expect(res.status).toBe(200);
  });

  it('does not gate POST /heaps/:id/place', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: 's3cret' });
    const created = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 's3cret' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await created.json() as CreateHeapResponse;

    const placeRes = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 500 }),
    });
    expect(placeRes.status).toBe(200);
  });

  it('disables the gate when adminSecret is empty string (dev mode)', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: '' });
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(201);
  });
});

function fakeLimiter(allow: boolean): RateLimiter {
  return { limit: async () => ({ success: allow }) };
}

describe('Rate limiting', () => {
  it('returns 429 on POST /scores when scores limiter denies', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      limiters: { scores: fakeLimiter(false) },
    });
    const res = await app.request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heapId: 'h', playerId: 'p', playerName: 'A', score: 1 }),
    });
    expect(res.status).toBe(429);
  });

  it('returns 429 on POST /heaps/:id/place when place limiter denies', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      limiters: { place: fakeLimiter(false) },
    });
    const res = await app.request('/heaps/anything/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1, y: 1 }),
    });
    expect(res.status).toBe(429);
  });

  it('returns 429 on /heaps when global limiter denies', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      limiters: { global: fakeLimiter(false) },
    });
    const res = await app.request('/heaps');
    expect(res.status).toBe(429);
  });

  it('passes through when all limiters allow', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      limiters: {
        scores: fakeLimiter(true),
        place:  fakeLimiter(true),
        global: fakeLimiter(true),
      },
    });
    const res = await app.request('/heaps');
    expect(res.status).toBe(200);
  });

  it('is a no-op when limiters are not configured', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {});
    const res = await app.request('/heaps');
    expect(res.status).toBe(200);
  });
});
