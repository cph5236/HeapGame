// server/src/platform/routes/timeWindow.ts
//
// Shared `since`/`until` parsing for the admin read routes. Extracted when the
// third and fourth handlers needed it — metrics.ts had already duplicated it
// once, which a review caught.

import type { Context } from 'hono';

export const DAY_MS = 86_400_000;
export const DEFAULT_WINDOW_DAYS = 30;

export function parseIso(v: string | undefined): string | null {
  if (v === undefined) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export type Window = { since: string; until: string };

/** Half-open `[since, until)`. Returns an error string instead of a window
 *  when the request is malformed, so callers can 400 with it. */
export function parseWindow(c: Context): Window | { error: string } {
  const until = c.req.query('until') === undefined
    ? new Date().toISOString()
    : parseIso(c.req.query('until'));
  if (until === null) return { error: 'until is not a valid ISO timestamp' };

  const since = c.req.query('since') === undefined
    ? new Date(Date.parse(until) - DEFAULT_WINDOW_DAYS * DAY_MS).toISOString()
    : parseIso(c.req.query('since'));
  if (since === null) return { error: 'since is not a valid ISO timestamp' };

  if (Date.parse(since) >= Date.parse(until)) {
    return { error: 'since must be before until' };
  }
  return { since, until };
}
