import { Hono } from 'hono';
import type { FeedbackDB, NormalizedFeedback } from '../feedbackDb';
import type { FeedbackCategory } from '../../../shared/feedbackTypes';

const MAX_MESSAGE_LEN = 3000;
const MAX_BODY_BYTES = 8 * 1024;
const VALID_CATEGORIES: ReadonlySet<string> = new Set(['bug', 'suggestion']);

function coerceStr(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

export function feedbackRoutes(feedbackDb: FeedbackDB): Hono {
  const app = new Hono();

  // Public submit — abuse-resistant, server stamps created_at + id.
  app.post('/', async (c) => {
    const lenHeader = c.req.header('content-length');
    if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) return c.body(null, 400);

    let body: unknown;
    try { body = await c.req.json(); } catch { return c.body(null, 400); }
    if (!body || typeof body !== 'object') return c.body(null, 400);
    const r = body as Record<string, unknown>;

    const category = r.category;
    if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) return c.body(null, 400);

    const message = typeof r.message === 'string' ? r.message.trim() : '';
    if (!message || message.length > MAX_MESSAGE_LEN) return c.body(null, 400);

    const heapIdRaw = r.heapId;
    const norm: NormalizedFeedback = {
      category:   category as FeedbackCategory,
      playerGuid: coerceStr(r.playerGuid, 64),
      sessionId:  coerceStr(r.sessionId, 64),
      message,
      appVersion: coerceStr(r.appVersion, 32),
      platform:   coerceStr(r.platform, 16),
      heapId:     typeof heapIdRaw === 'string' ? coerceStr(heapIdRaw, 64) : null,
      userAgent:  coerceStr(r.userAgent, 200),
    };

    try {
      await feedbackDb.insert(norm, new Date().toISOString());
    } catch {
      // swallow — abuse / outages must not surface to clients (mirrors /log)
    }
    return c.body(null, 204);
  });

  // Admin read — gate applied in app.ts. Monotonic id cursor.
  app.get('/', async (c) => {
    const sinceRaw = c.req.query('since_id');
    const sinceId = sinceRaw != null && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : null;
    const rows = await feedbackDb.listSince(sinceId);
    return c.json(rows, 200);
  });

  return app;
}
