import type { MiddlewareHandler } from 'hono';

/**
 * Returns Hono middleware that 401s any request whose X-Admin-Secret header
 * does not match `secret`. If `secret` is empty/undefined the middleware is a
 * no-op — allows local dev to run without a secret configured.
 */
export function requireAdminSecret(secret: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!secret) return next();
    const provided = c.req.header('x-admin-secret');
    if (provided !== secret) {
      return c.json({ error: 'admin secret required' }, 401);
    }
    return next();
  };
}
