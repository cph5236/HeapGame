import type { EnemyDef } from '../data/enemyDefs';
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
 * Returns spawn probability for the given def at world Y, resolved against worldHeight.
 * Returns null if Y is outside the enemy's spawn zone.
 */
export function spawnChance(def: EnemyDef, y: number, worldHeight: number): number | null {
  const startY   = def.spawnStartFrac * worldHeight;
  const endY     = def.spawnEndFrac   === -1 ? -1 : def.spawnEndFrac   * worldHeight;
  const rampEndY = def.spawnRampEndFrac === -1 ? -1 : def.spawnRampEndFrac * worldHeight;

  if (y > startY) return null;
  if (endY !== -1 && y < endY) return null;
  if (rampEndY === -1) return def.spawnChanceMin;

  const t = Math.min(1, Math.max(0, (startY - y) / (startY - rampEndY)));
  return def.spawnChanceMin + t * (def.spawnChanceMax - def.spawnChanceMin);
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
