import type { MiddlewareHandler } from 'hono';

/** Cloudflare Workers Rate Limiting API binding shape. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
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
): MiddlewareHandler {
  return async (c, next) => {
    if (!limiter) return next();
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const { success } = await limiter.limit({ key: ip });
    if (!success) {
      console.warn(`[ratelimit] blocked label=${label} ip=${ip} path=${c.req.path}`);
      return c.json({ error: 'rate limit exceeded' }, 429);
    }
    return next();
  };
}
