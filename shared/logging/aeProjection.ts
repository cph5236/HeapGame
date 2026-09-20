// shared/logging/aeProjection.ts
//
// Promotes a few run facts out of the payload JSON and into dedicated Analytics
// Engine columns.
//
// Why this exists: AE SQL has NO JSON functions (its string functions are only
// length/empty/lower/upper/startsWith/endsWith/position/substring/format/
// extract), so anything inside the payload blob is invisible to a query. The
// churn cross-tab splits on exactly these numbers, so they have to be columns.
//
// This file is the ONLY place that knows which game fields map to which column.
// The AE sink appends whatever it is handed, positionally, and stays free of
// game concepts.

import type { GameEvent } from './events';

export interface EventMetrics {
  /** Appended after double1 — so index 0 here is `double2`. */
  doubles?: number[];
  /** Appended after blob7 — so index 0 here is `blob8`. */
  blobs?: string[];
}

/**
 * Column assignments. Documented here because a query cannot see them and a
 * reader of the SQL has nothing else to go on:
 *
 *   double2 = score        double5 = durationMs
 *   double3 = height       double6 = pickupBonus
 *   double4 = kills        blob8   = cause ('death' | 'quit' | 'success')
 *
 * These positions are APPEND-ONLY. Reusing one for a different field would
 * silently reinterpret every row already stored.
 */
export function projectEventMetrics(e: GameEvent): EventMetrics | undefined {
  if (e.type !== 'run:end') return undefined;
  return {
    doubles: [e.score, e.height, e.kills, e.durationMs, e.pickupBonus],
    blobs: [e.cause],
  };
}
