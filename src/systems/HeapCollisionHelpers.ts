import type { HeapEdgeCollider } from './HeapEdgeCollider';
import { PLAYER_HEIGHT } from '../constants';

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
