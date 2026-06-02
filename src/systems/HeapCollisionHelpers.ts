import type Phaser from 'phaser';
import type { HeapEdgeCollider } from './HeapEdgeCollider';
import { PLAYER_HEIGHT, WALL_DEPENETRATION_FACTOR } from '../constants';

/**
 * Push the player horizontally out of a wall slab they've sunk into.
 *
 * Wall slabs disable top/underside collision (see HeapEdgeCollider) so the player
 * slides down vertical faces. But on a diagonal slope the exposed surface is the
 * slab *tops*, so falling into it while steering sideways lets the player sink
 * through. The slab's exposed side faces would normally block that, but on a slope
 * they're buried between neighbours, so Arcade has no enabled face to separate on.
 *
 * This restores that separation on the horizontal axis only, using the slab's
 * `wallSide`: a 'left' wall is the heap's left boundary (interior to the right), so
 * push the player left until clear; a 'right' wall pushes right. Into-wall velocity
 * is zeroed so they don't immediately re-penetrate. Run as an overlap handler, which
 * (unlike a collider) fires whenever bodies overlap regardless of enabled faces.
 */
export function depenetratePlayerFromWall(
  playerObj: Phaser.GameObjects.GameObject,
  wallObj: Phaser.GameObjects.GameObject,
): void {
  const sprite = playerObj as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  const pb     = sprite.body;
  const wb     = (wallObj as Phaser.Types.Physics.Arcade.ImageWithStaticBody).body;
  const side   = (wallObj as Phaser.GameObjects.Image).getData('wallSide');

  if (side === 'left') {
    const overlap = pb.right - wb.left;
    if (overlap > 0) {
      const push = overlap * WALL_DEPENETRATION_FACTOR;
      sprite.x -= push;
      pb.x     -= push;
      if (pb.velocity.x > 0) pb.velocity.x = 0;
    }
  } else if (side === 'right') {
    const overlap = wb.right - pb.left;
    if (overlap > 0) {
      const push = overlap * WALL_DEPENETRATION_FACTOR;
      sprite.x += push;
      pb.x     += push;
      if (pb.velocity.x < 0) pb.velocity.x = 0;
    }
  }
}

export interface SnappablePlayer {
  sprite: {
    x: number;
    y: number;
    body: { blocked: { down: boolean } };
  };
}

export function snapPlayerToSurface(
  player: SnappablePlayer,
  edgeColliders: HeapEdgeCollider[],
  snapTolerancePx: number,
): void {
  if (!player.sprite.body.blocked.down) return;
  const playerX = player.sprite.x;
  const feetY   = player.sprite.y + PLAYER_HEIGHT / 2;
  let slabTop: number | null = null;
  for (const ec of edgeColliders) {
    const s = ec.getSurfaceYAtX(playerX, feetY);
    if (s !== null && (slabTop === null || s < slabTop)) slabTop = s;
  }
  if (slabTop === null) return;
  const targetY = slabTop - PLAYER_HEIGHT / 2;
  if (Math.abs(targetY - player.sprite.y) <= snapTolerancePx) {
    player.sprite.y = targetY;
  }
}
