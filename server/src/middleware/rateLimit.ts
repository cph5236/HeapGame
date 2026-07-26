import type { MiddlewareHandler } from 'hono';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';

/** Cloudflare Workers Rate Limiting API binding shape. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

let _getSink: (() => Sink | undefined) | null = null;

export function setRateLimitSink(g: () => Sink | undefined): void {
  _getSink = g;
}

/**
 * Returns Hono middleware that rate-limits by client IP using the given binding.
 * If `limiter` is undefined (local dev / tests with no binding) the middleware
 * is a no-op. Logs a console.warn on every blocked request so they show up in
 * `wrangler tail` and the Workers Logs tab.
 */
export function rateLimit(
  limiter: RateLimiter | undefined,
  label: string,
  loadTestSecret?: string,
): MiddlewareHandler {
  return async (c, next) => {
    if (!limiter) return next();
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    // Staging-only: let a load generator present a synthetic per-VU key so that
    // traffic from one machine models many players arriving from distinct IPs.
    // loadTestSecret comes from LOADTEST_SECRET, which is never set in
    // production, so this branch is unreachable there and the limiter keys on
    // the (unspoofable) edge-set client IP.
    const key = loadTestSecret && c.req.header('X-LoadTest-Secret') === loadTestSecret
      ? c.req.header('X-LoadTest-Key') ?? ip
      : ip;
    const { success } = await limiter.limit({ key });
    if (!success) {
      console.warn(`[ratelimit] blocked label=${label} key=${key} path=${c.req.path}`);
      const sink = _getSink?.();
      if (sink) {
        await captureServer(sink, 'warn', 'rate_limit:hit', { bucket: label, key });
      }
      return c.json({ error: 'rate limit exceeded' }, 429);
    }
    return next();
  };
}
