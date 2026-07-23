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

export interface PatrolBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Patrol bounds for a rat on the surface edge leftV→rightV, inset from each end
 * by `margin` so the rat turns around before its body overhangs the corner.
 * minY/maxY are the edge's Y at the inset X's (linear along the edge), keeping the
 * rat on the surface. If the edge is too short to inset both ends
 * (width <= 2*margin), the bounds collapse to the edge midpoint so the rat idles
 * in place rather than getting inverted bounds.
 *
 * Precondition: leftV.x <= rightV.x (caller orders the vertices).
 */
export function insetPatrolBounds(
  leftV: { x: number; y: number },
  rightV: { x: number; y: number },
  margin: number,
): PatrolBounds {
  const width = rightV.x - leftV.x;

  if (width <= 2 * margin) {
    // Too short (or degenerate): collapse to the midpoint. Midpoint Y equals the
    // edge's Y there for a straight edge, and avoids a divide-by-zero when width=0.
    const midX = (leftV.x + rightV.x) / 2;
    const midY = (leftV.y + rightV.y) / 2;
    return { minX: midX, maxX: midX, minY: midY, maxY: midY };
  }

  const minX = leftV.x + margin;
  const maxX = rightV.x - margin;
  const edgeY = (x: number): number =>
    leftV.y + ((x - leftV.x) / width) * (rightV.y - leftV.y);
  return { minX, maxX, minY: edgeY(minX), maxY: edgeY(maxX) };
}

/**
 * Whether a rat should patrol its bounds, or stand still. Narrow spans produce
 * twitchy in-place shuffles (walk a few px, flip animation, repeat), so below
 * `minWidth` the rat just idles. See RAT_MIN_PATROL_PX.
 */
export function shouldPatrol(minX: number, maxX: number, minWidth: number): boolean {
  return maxX - minX >= minWidth;
}

export type JumperState = 'idle' | 'attacking' | 'cooldown';

export interface WallFace {
  /** Horizontal sign of the outward (open-air) direction: -1 or +1. */
  outwardX: number;
  /** Outward unit normal x component. */
  nx: number;
  /** Outward unit normal y component. */
  ny: number;
}

/**
 * For a wall edge v1→v2, find the open-air side by probing both perpendicular
 * normals against the polygon. Returns the outward face if exactly one side is
 * open air (a valid exterior wall); returns null when both probes land inside
 * (interior edge) or both outside (degenerate spur) — caller rejects the spawn.
 */
export function computeWallFace(
  v1: Vertex,
  v2: Vertex,
  polygon: Vertex[],
  probe = 6,
): WallFace | null {
  const midX = (v1.x + v2.x) / 2;
  const midY = (v1.y + v2.y) / 2;
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // one unit normal
  const ny = dx / len;
  const insideA = isPointInsidePolygon(midX + nx * probe, midY + ny * probe, polygon);
  const insideB = isPointInsidePolygon(midX - nx * probe, midY - ny * probe, polygon);
  if (insideA === insideB) return null; // both in or both out → not a clean wall
  const s = insideA ? -1 : 1; // outward = the side that is NOT inside
  const ox = nx * s;
  const oy = ny * s;
  return { outwardX: Math.sign(ox) || 1, nx: ox, ny: oy };
}

/**
 * Pure state transition for a Jumper Cable. `msInState` is time elapsed since
 * the current state was entered. Cooldown ignores proximity (the disarmed tell).
 *
 * The attack holds the clamp extended + hazardous for at least `attackMinMs`
 * (so the lunge anim always plays out — no flicker-retract) and then stays out
 * as long as the player remains within `attackRangePx`, so an approaching player
 * still meets a live clamp regardless of how fast they close the gap. A hard
 * `attackMaxMs` cap forces the retract → cooldown tell even if the player camps
 * in range, preserving the "safe to brush past during cooldown" fairness.
 */
export function jumperNextState(
  state: JumperState,
  msInState: number,
  distToPlayer: number,
  cfg: { attackRangePx: number; attackMinMs: number; attackMaxMs: number; cooldownMs: number },
): JumperState {
  switch (state) {
    case 'idle':
      return distToPlayer <= cfg.attackRangePx ? 'attacking' : 'idle';
    case 'attacking': {
      if (msInState >= cfg.attackMaxMs) return 'cooldown';
      const leftRange = distToPlayer > cfg.attackRangePx;
      return msInState >= cfg.attackMinMs && leftRange ? 'cooldown' : 'attacking';
    }
    case 'cooldown':
      return msInState >= cfg.cooldownMs ? 'idle' : 'cooldown';
  }
}
