import { createHash } from 'node:crypto';
import { Vertex } from '../../shared/heapTypes';

/**
 * Ray-casting point-in-polygon test.
 * Returns true if the point is strictly inside the polygon.
 */
export function isPointInside(point: Vertex, polygon: Vertex[]): boolean {
  if (polygon.length < 3) return false;
  const { x, y } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** SHA-256 hash of a vertex array serialized as JSON. */
export function hashVertices(vertices: Vertex[]): string {
  return createHash('sha256').update(JSON.stringify(vertices)).digest('hex');
}

export const LIVE_ZONE_MAX = 500;
export const FREEZE_BATCH = 250;

export interface FreezeResult {
  newLiveZone: Vertex[];
  newBaseVertices: Vertex[];
  newBaseHash: string;
  newFreezeY: number;
}

/**
 * If liveZone exceeds LIVE_ZONE_MAX vertices, freeze the bottom FREEZE_BATCH
 * (highest Y = base side, end of the Y-ascending array) into the base.
 * Returns null if no freeze is needed.
 *
 * liveZone must be sorted Y ascending: index 0 = summit (lowest Y), end = base (highest Y).
 */
export function checkFreeze(
  liveZone: Vertex[],
  existingBase: Vertex[],
): FreezeResult | null {
  if (liveZone.length <= LIVE_ZONE_MAX) return null;

  const frozen = liveZone.slice(-FREEZE_BATCH);
  const newLiveZone = liveZone.slice(0, liveZone.length - FREEZE_BATCH);
  const newBaseVertices = [...existingBase, ...frozen];
  const newBaseHash = hashVertices(newBaseVertices);
  const newFreezeY = frozen[0].y;

  return { newLiveZone, newBaseVertices, newBaseHash, newFreezeY };
}
