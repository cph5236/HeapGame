// src/systems/enemyRadarMath.ts
// Pure geometry for the off-screen radar (enemies + pickups). No Phaser
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
  /**
   * Grows the "on-screen" suppression rect outward by this many logical px, so an
   * enemy whose centre is just past the edge — but whose sprite is still clearly
   * visible — gets no arrow (an arrow pointing at something you can already see is
   * noise). Defaults to 0 (suppress only when the centre is strictly inside view).
   */
  onScreenPadPx?: number;
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

/** Minimal camera shape needed to reconstruct the visible world rect. */
export interface CameraRectSource {
  scrollX: number;
  scrollY: number;
  /** Physical camera pixel size (Phaser Camera.width/height). */
  width: number;
  height: number;
  /** Camera zoom — equals the DPR cap under the crisp-canvas setup. */
  zoom: number;
}

/**
 * The camera's visible world rect — identical to Phaser `Camera.worldView`, but
 * reconstructed so it is valid *during* scene `update()` (Phaser only refreshes
 * worldView in preRender, so reading it in update() lags a frame and is zero on
 * the very first frame).
 *
 * Phaser zooms about the camera CENTRE (regardless of `originX/Y`), so the visible
 * rect's top-left is inset from `scrollX/Y` by half the size lost to zoom. Treating
 * the top-left as plain `scrollX` (the old radar bug) offsets the rect by hundreds
 * of px once zoom = DPR > 1 — which mis-flagged on-screen targets as off-screen on
 * high-DPR phones (desktop DPR=1 hid it). At zoom 1 this reduces to `scrollX/Y`.
 */
export function visibleWorldRect(cam: CameraRectSource): RadarView {
  const width = cam.width / cam.zoom;
  const height = cam.height / cam.zoom;
  return {
    x: cam.scrollX + (cam.width - width) / 2,
    y: cam.scrollY + (cam.height - height) / 2,
    width,
    height,
  };
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

  // On-screen test uses the RAW rendered position: enemies are only ever drawn at
  // enemyX (nothing re-renders them at the wrapped ghost), so a wrap-side enemy
  // whose ghost happens to fall inside the (possibly offset) view is still genuinely
  // off-screen and must keep its arrow.
  const rawSx = enemyX - view.x;
  const rawSy = enemyY - view.y;
  const pad = opts.onScreenPadPx ?? 0;
  if (rawSx >= -pad && rawSx <= view.width + pad && rawSy >= -pad && rawSy <= view.height + pad) {
    return null;
  }

  // Pin the arrow to a margin rect by casting a ray from the viewport centre along
  // the player→enemy direction (dx, dy already uses the wrap-resolved x, so the
  // arrow points the way the player travels to reach the enemy). Ray-from-centre
  // guarantees an edge point even when the wrapped ghost lands inside the rect —
  // a component-wise clamp would leave it mid-screen pointing nowhere.
  const minX = opts.marginPx;
  const maxX = view.width - opts.marginPx;
  const minY = opts.marginPx;
  const maxY = view.height - opts.marginPx;
  const ox = view.width / 2;
  const oy = view.height / 2;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (maxX - ox) / dx);
  else if (dx < 0) t = Math.min(t, (minX - ox) / dx);
  if (dy > 0) t = Math.min(t, (maxY - oy) / dy);
  else if (dy < 0) t = Math.min(t, (minY - oy) / dy);
  if (!Number.isFinite(t)) t = 0; // enemy coincident with centre (degenerate)
  const angle = Math.atan2(dy, dx);
  return { x: ox + t * dx, y: oy + t * dy, angle, dist };
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
