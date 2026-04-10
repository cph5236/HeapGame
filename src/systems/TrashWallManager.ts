// src/systems/TrashWallManager.ts

// ── Pure math — exported for unit testing ─────────────────────────────────────

/**
 * Interpolates wall speed between speedMin (at world floor) and speedMax (at yForMaxSpeed).
 * As wallY decreases (wall climbs higher), speed increases toward speedMax.
 */
export function computeWallSpeed(
  wallY: number,
  speedMin: number,
  speedMax: number,
  yForMaxSpeed: number,
  worldHeight: number,
): number {
  const t = Math.min(1, Math.max(0, (wallY - yForMaxSpeed) / (worldHeight - yForMaxSpeed)));
  return speedMax - t * (speedMax - speedMin);
}

/**
 * Clamps wallY so it can never lag more than maxLaggingDistance below playerY.
 * In Phaser coords Y increases downward, so "below" = larger Y.
 */
export function clampWallY(wallY: number, playerY: number, maxLaggingDistance: number): number {
  return Math.min(wallY, playerY + maxLaggingDistance);
}

/**
 * Returns true when the player has entered the lethal band at the wall's top edge.
 */
export function isKillZoneReached(playerY: number, wallY: number, killZoneHeight: number): boolean {
  return playerY >= wallY - killZoneHeight;
}
