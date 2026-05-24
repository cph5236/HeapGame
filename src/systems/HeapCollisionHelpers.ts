import type Phaser from 'phaser';
import type { HeapEdgeCollider } from './HeapEdgeCollider';
import { PLAYER_HEIGHT } from '../constants';

export interface SnappablePlayer {
  inSlopeZone: boolean;
  slopeEjectDir: number;
  sprite: {
    x: number;
    y: number;
    body: { blocked: { down: boolean } };
  };
}

export function getWallSide(obj: Phaser.GameObjects.GameObject): 'left' | 'right' | null {
  const v = (obj as Phaser.GameObjects.Image).getData('wallSide');
  if (v === 'left' || v === 'right') return v;
  return null;
}

export function handleWallCollision(
  player: { inSlopeZone: boolean; slopeEjectDir: number },
  playerObj: Phaser.GameObjects.GameObject,
  wallObj: Phaser.GameObjects.GameObject,
): void {
  const body = (playerObj as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody).body;
  if (!body.blocked.down) return;
  const side = getWallSide(wallObj);
  if (side === null) return;  // safer than the original cast — wall slabs always have it
  player.inSlopeZone = true;
  player.slopeEjectDir = side === 'left' ? -1 : 1;
}

export function snapPlayerToSurface(
  player: SnappablePlayer,
  edgeColliders: HeapEdgeCollider[],
  snapTolerancePx: number,
): void {
  if (!player.sprite.body.blocked.down || player.inSlopeZone) return;
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
