import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { PortalDef } from '../data/portalDefs';
import type { ScanlineRow } from './HeapPolygon';

/**
 * Scans `rows` (ordered top→bottom, ascending Y) to find the topmost row
 * containing `x`, then verifies `clearanceRequired` px of clear air above it.
 * Returns the surface Y, or null if no surface or clearance is blocked.
 */
export function findPortalSurface(
  rows: ScanlineRow[],
  x: number,
  clearanceRequired: number,
): number | null {
  const surfaceRow = rows.find(r => x >= r.leftX && x <= r.rightX);
  if (!surfaceRow) return null;
  const clearTop = surfaceRow.y - clearanceRequired;
  const hasObstruction = rows.some(
    r => r.y > clearTop && r.y < surfaceRow.y && x >= r.leftX && x <= r.rightX,
  );
  return hasObstruction ? null : surfaceRow.y;
}

/** Returns a random number in [range[0], range[1]]. Injectable rng for testing. */
export function randBetween(range: [number, number], rng: () => number = Math.random): number {
  return range[0] + rng() * (range[1] - range[0]);
}

interface PortalPair {
  aX: number; aY: number;
  bX: number; bY: number;
  aRect: Phaser.GameObjects.Rectangle;
  bRect: Phaser.GameObjects.Rectangle;
}

export class PortalManager {
  private readonly pairs: PortalPair[] = [];
  private bandsSinceLastPair = 0;
  private teleportCooldownUntil = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
    private readonly colBounds: [number, number][],
    private readonly def: PortalDef,
    private readonly onTeleport: (invincibilityMs: number) => void,
  ) {}

  onBandLoaded(bandTopY: number): void {
    this.bandsSinceLastPair++;
    if (this.bandsSinceLastPair < this.def.bandsPerPair) return;
    this.bandsSinceLastPair = 0;
    this.spawnPair(bandTopY);
  }

  update(): void {
    if (this.scene.time.now < this.teleportCooldownUntil) return;

    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const hw = this.def.width  / 2;
    const hh = this.def.height / 2;

    for (const pair of this.pairs) {
      if (Math.abs(px - pair.aX) < hw && Math.abs(py - pair.aY) < hh) {
        this.teleport(pair.bX, pair.bY);
        return;
      }
      if (Math.abs(px - pair.bX) < hw && Math.abs(py - pair.bY) < hh) {
        this.teleport(pair.aX, pair.aY);
        return;
      }
    }
  }

  private teleport(toX: number, toY: number): void {
    this.player.sprite.setPosition(toX, toY - 30);
    (this.player.sprite.body as Phaser.Physics.Arcade.Body).reset(toX, toY - 30);
    this.onTeleport(this.def.invincibilityMs);
    this.teleportCooldownUntil = this.scene.time.now + 1_000;
  }

  private spawnPair(bandTopY: number): void {
    const numCols  = this.colBounds.length;
    const aColIdx  = Math.floor(Math.random() * numCols);
    const offset = 1 + Math.floor(Math.random() * (numCols - 1));
    const bColIdx  = (aColIdx + offset) % numCols;

    const deltaY   = this.def.minHeightDelta +
      Math.random() * (this.def.maxHeightDelta - this.def.minHeightDelta);

    const [aMin, aMax] = this.colBounds[aColIdx];
    const [bMin, bMax] = this.colBounds[bColIdx];

    const aX = (aMin + aMax) / 2;
    const aY = bandTopY;
    const bX = (bMin + bMax) / 2;
    const bY = bandTopY + deltaY;

    const aRect = this.scene.add.rectangle(aX, aY, this.def.width, this.def.height, 0x00ff88, 0.75);
    const bRect = this.scene.add.rectangle(bX, bY, this.def.width, this.def.height, 0x00ff88, 0.75);

    this.pairs.push({ aX, aY, bX, bY, aRect, bRect });
  }
}
