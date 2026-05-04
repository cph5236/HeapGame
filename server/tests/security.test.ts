import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';

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
