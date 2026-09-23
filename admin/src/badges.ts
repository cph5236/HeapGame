// admin/src/badges.ts
//
// "New feedback" tracking. The feedback table has a monotonic integer id, so
// "unread" is simply id > the highest id this browser has shown, per env.

import { currentEnv } from './api';
import { listFeedback, type FeedbackRow } from './data';
import { lsGet, lsSet } from './ui';

const key = () => `heapAdmin.feedbackSeen.${currentEnv()}`;

export function lastSeenFeedbackId(): number {
  return Number(lsGet(key()) ?? 0) || 0;
}

export function markFeedbackSeen(rows: FeedbackRow[]): void {
  const max = rows.reduce((m, r) => Math.max(m, r.id), lastSeenFeedbackId());
  lsSet(key(), String(max));
  setBadge(0);
}

export function unreadCount(rows: FeedbackRow[]): number {
  const seen = lastSeenFeedbackId();
  return rows.filter((r) => r.id > seen).length;
}

function setBadge(n: number): void {
  const el = document.getElementById('fbCount');
  if (!el) return;
  el.textContent = n > 99 ? '99+' : String(n);
  el.classList.toggle('hidden', n === 0);
}

/** Best-effort — a missing secret or an unreachable server just hides it. */
export function refreshFeedbackBadge(rows?: FeedbackRow[]): void {
  const env = currentEnv();
  (rows ? Promise.resolve(rows) : listFeedback())
    .then((r) => { if (env === currentEnv()) setBadge(unreadCount(r)); })
    .catch(() => setBadge(0));
}
