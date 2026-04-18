import Phaser from 'phaser';
import { HeapGenerator } from './HeapGenerator';
import { findSurfaceY } from './HeapSurface';
import { CHUNK_BAND_HEIGHT } from '../constants';
import type { BridgeDef } from '../data/bridgeDefs';

/**
 * Pure predicate — exported for unit testing.
 * Returns true if the two gap surface Y values warrant a bridge in this band.
 */
export function shouldSpawnBridge(
  leftSurfaceY: number,
  rightSurfaceY: number,
  bandTopY: number,
  bandBottomY: number,
  snapThresholdY: number,
): boolean {
  if (Math.abs(leftSurfaceY - rightSurfaceY) > snapThresholdY) return false;
  const surfY = Math.min(leftSurfaceY, rightSurfaceY);
  return surfY >= bandTopY && surfY <= bandBottomY;
}

export class BridgeSpawner {
  /** Arcade static group — add collider in InfiniteGameScene */
  readonly group: Phaser.Physics.Arcade.StaticGroup;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly generators: [HeapGenerator, HeapGenerator, HeapGenerator],
    private readonly colBounds: [number, number][],
    private readonly def: BridgeDef,
  ) {
    this.group = scene.physics.add.staticGroup();
  }

  /**
   * Call from InfiniteGameScene after each band loads (driven by col 0 generator).
   * Tries to place bridges across each gap for this band.
   */
  onBandLoaded(bandTopY: number): void {
    const bandBottomY = bandTopY + CHUNK_BAND_HEIGHT;

    for (let gapIdx = 0; gapIdx < 2; gapIdx++) {
      const leftColIdx  = gapIdx;
      const rightColIdx = gapIdx + 1;

      const [, leftColXMax]  = this.colBounds[leftColIdx];
      const [rightColXMin]   = this.colBounds[rightColIdx];

      const leftSurfY  = findSurfaceY(leftColXMax  - 20, 10, this.generators[leftColIdx].entries);
      const rightSurfY = findSurfaceY(rightColXMin + 20, 10, this.generators[rightColIdx].entries);

      const count = this.def.minBridgesPerBand +
        Math.floor(Math.random() * (this.def.maxBridgesPerBand - this.def.minBridgesPerBand + 1));

      for (let i = 0; i < count; i++) {
        if (!shouldSpawnBridge(leftSurfY, rightSurfY, bandTopY, bandBottomY, this.def.snapThresholdY)) {
          continue;
        }
        const bridgeCX = (leftColXMax + rightColXMin) / 2;
        const bridgeW  = rightColXMin - leftColXMax;
        const bridgeY  = Math.min(leftSurfY, rightSurfY);

        const body = this.group.create(bridgeCX, bridgeY, '') as Phaser.Physics.Arcade.Sprite;
        body.setVisible(false);
        (body.body as Phaser.Physics.Arcade.StaticBody).setSize(bridgeW, this.def.bodyHeight);
        body.refreshBody();
      }
    }
  }
}
