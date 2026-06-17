// src/systems/enemyRadarMath.ts
// Pure geometry for the off-screen enemy indicator (Threat Radar). No Phaser
// value import, so it unit-tests cleanly in the Vitest `node` environment.

export interface RadarView {
  /** Logical world coord of the viewport's top-left (camera scrollX/scrollY). */
  x: number;
  y: number;
  /** Logical viewport size (camera width/height ÷ zoom). */
  width: number;
  height: number;
}

export interface RadarOpts {
  /** Detection radius in world px; enemies farther than this are ignored. */
  rangePx: number;
  /** Arrow inset from the viewport edge, in logical px. */
  marginPx: number;
  /** Horizontal wrap period (worldWidth + wrapPad); the world is a cylinder. */
  wrapPeriod: number;
}

export interface Blip {
  /** Logical screen position of the arrow (clamped to the margin rect). */
  x: number;
  y: number;
  /** Arrow rotation in radians, pointing toward the enemy. */
  angle: number;
  /** Player→enemy distance in world px (for nearest-N selection). */
  dist: number;
}

/**
 * Whichever of enemyX, enemyX - period, enemyX + period is closest to playerX.
 * The wrap trick: an enemy at the far world edge resolves to a "ghost image"
 * just past the near edge, so its arrow appears on the side the player would
 * travel to reach it via wrap.
 */
export function wrapNearestX(enemyX: number, playerX: number, period: number): number {
  let best = enemyX;
  let bestDist = Math.abs(enemyX - playerX);
  for (const cand of [enemyX - period, enemyX + period]) {
    const d = Math.abs(cand - playerX);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

/**
 * Screen-space blip for one enemy, or null if it is on-screen OR beyond rangePx.
 *
 * World→logical-screen is (wx - view.x, wy - view.y); `view` is built from camera
 * scroll + size/zoom (NOT cam.worldView, which is stale during update()). The arrow
 * is clamped to a rect inset by marginPx; its angle points from the clamped edge
 * point toward the (wrap-resolved) enemy.
 */
export function computeBlip(
  enemyX: number, enemyY: number,
  playerX: number, playerY: number,
  view: RadarView, opts: RadarOpts,
): Blip | null {
  const wx = wrapNearestX(enemyX, playerX, opts.wrapPeriod);
  const dx = wx - playerX;
  const dy = enemyY - playerY;
  const dist = Math.hypot(dx, dy);
  if (dist > opts.rangePx) return null;

  const sx = wx - view.x;
  const sy = enemyY - view.y;
  const onScreen = sx >= 0 && sx <= view.width && sy >= 0 && sy <= view.height;
  if (onScreen) return null;

  const minX = opts.marginPx;
  const maxX = view.width - opts.marginPx;
  const minY = opts.marginPx;
  const maxY = view.height - opts.marginPx;
  const cx = Math.min(Math.max(sx, minX), maxX);
  const cy = Math.min(Math.max(sy, minY), maxY);
  const angle = Math.atan2(sy - cy, sx - cx);
  return { x: cx, y: cy, angle, dist };
}

/**
 * Nearest `max` blips across all enemies, so a crowd never exceeds the arrow pool.
 */
export function selectBlips(
  enemies: Iterable<{ x: number; y: number }>,
  playerX: number, playerY: number,
  view: RadarView, opts: RadarOpts, max: number,
): Blip[] {
  const blips: Blip[] = [];
  for (const e of enemies) {
    const b = computeBlip(e.x, e.y, playerX, playerY, view, opts);
    if (b) blips.push(b);
  }
  blips.sort((a, b) => a.dist - b.dist);
  return blips.length > max ? blips.slice(0, max) : blips;
}
