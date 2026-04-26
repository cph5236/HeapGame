import type { EnemySpawnParams } from '../../shared/heapTypes';
import type { Vertex } from './HeapPolygon';

export function isPointInsidePolygon(x: number, y: number, polygon: Vertex[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const crosses = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function computeSurfaceAngle(v1: Vertex, v2: Vertex): number {
  const dx = Math.abs(v2.x - v1.x);
  const dy = Math.abs(v2.y - v1.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Returns spawn probability for the given params at the given height above floor.
 * Returns null if the point is outside the enemy's spawn zone.
 * pxAboveFloor = worldHeight - y  (computed at call site).
 */
export function spawnChance(params: EnemySpawnParams, pxAboveFloor: number): number | null {
  if (pxAboveFloor < params.spawnStartPxAboveFloor) return null;
  if (params.spawnEndPxAboveFloor !== -1 && pxAboveFloor > params.spawnEndPxAboveFloor) return null;
  if (params.spawnRampPxAboveFloor === -1) return params.spawnChanceMin;
  const range = params.spawnRampPxAboveFloor - params.spawnStartPxAboveFloor;
  const t = range <= 0 ? 1 : Math.min(1, (pxAboveFloor - params.spawnStartPxAboveFloor) / range);
  return params.spawnChanceMin + t * (params.spawnChanceMax - params.spawnChanceMin);
}

export function scaleSpawnChance(chance: number, mult: number): number {
  return Math.max(0, Math.min(1, chance * mult));
}

export function computeGhostFlip(
  x: number,
  velocityX: number,
  speed: number,
  xMin: number,
  xMax: number,
): number {
  if (x <= xMin && velocityX < 0) return speed;
  if (x >= xMax && velocityX > 0) return -speed;
  return velocityX;
}
