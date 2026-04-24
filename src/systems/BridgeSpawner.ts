import Phaser from 'phaser';
import type { Vertex } from './HeapPolygon';
import { CHUNK_BAND_HEIGHT, MOCK_HEAP_HEIGHT_PX } from '../constants';
import type { BridgeDef } from '../data/bridgeDefs';

type PolygonGetter = (colIdx: number, bandTop: number) => Vertex[] | undefined;

const ANCHOR_X_TOLERANCE = 60;

function findWallAnchor(
  vertices: Vertex[],
  targetX: number,
): { x: number; y: number } {
  if (vertices.length < 2) return { x: targetX, y: MOCK_HEAP_HEIGHT_PX };

  let surfaceY = MOCK_HEAP_HEIGHT_PX;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    const minX = Math.min(v1.x, v2.x);
    const maxX = Math.max(v1.x, v2.x);
    if (targetX < minX || targetX > maxX) continue;

    const dx = v2.x - v1.x;
    let yAtX: number;
    if (Math.abs(dx) < 0.001) {
      yAtX = Math.min(v1.y, v2.y);
    } else {
      const t = (targetX - v1.x) / dx;
      yAtX = v1.y + t * (v2.y - v1.y);
    }
    if (yAtX < surfaceY) surfaceY = yAtX;
  }

  if (surfaceY < MOCK_HEAP_HEIGHT_PX) return { x: targetX, y: surfaceY };

  // Wall-face fallback: use the actual vertex X so the bridge spans to the
  // real heap edge rather than the column-bound X.
  let best: Vertex | null = null;
  for (const v of vertices) {
    if (Math.abs(v.x - targetX) <= ANCHOR_X_TOLERANCE) {
      if (!best || v.y < best.y) best = v;
    }
  }

  return best
    ? { x: best.x, y: best.y }
    : { x: targetX, y: MOCK_HEAP_HEIGHT_PX };
}

/**
 * Pure predicate — exported for unit testing.
 * Returns true when both anchors are valid (not ground fallback) and the
 * bridge midpoint Y falls within this band.
 */
export function shouldSpawnBridge(
  leftSurfaceY: number,
  rightSurfaceY: number,
  bandTopY: number,
  bandBottomY: number,
  groundFallback: number,
): boolean {
  if (leftSurfaceY >= groundFallback || rightSurfaceY >= groundFallback) return false;
  const midY = (leftSurfaceY + rightSurfaceY) / 2;
  return midY >= bandTopY && midY <= bandBottomY;
}

export class BridgeSpawner {
  debug = false;
  /** Arcade static group — add collider in InfiniteGameScene */
  readonly group: Phaser.Physics.Arcade.StaticGroup;
  private readonly processedBands = new Set<number>();
  private readonly visuals: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly colBounds: [number, number][],
    private readonly def: BridgeDef,
    private readonly getPolygon: PolygonGetter,
  ) {
    this.group = scene.physics.add.staticGroup();
  }

  onBandLoaded(bandTopY: number): void {
    if (this.processedBands.has(bandTopY)) return;
    const bandBottomY = bandTopY + CHUNK_BAND_HEIGHT;

    const poly0 = this.getPolygon(0, bandTopY);
    const poly1 = this.getPolygon(1, bandTopY);
    const poly2 = this.getPolygon(2, bandTopY);
    if (!poly0 || !poly1 || !poly2) {
      if (this.debug) console.log(`[Bridge] bandY=${bandTopY} — waiting: col0=${!!poly0} col1=${!!poly1} col2=${!!poly2}`);
      return;
    }
    this.processedBands.add(bandTopY);

    let spawnedCount = 0;
    for (let gapIdx = 0; gapIdx < 2; gapIdx++) {
      const leftColIdx  = gapIdx;
      const rightColIdx = gapIdx + 1;

      const [, leftColXMax] = this.colBounds[leftColIdx];
      const [rightColXMin]  = this.colBounds[rightColIdx];

      const leftPoly  = this.getPolygon(leftColIdx, bandTopY)!;
      const rightPoly = this.getPolygon(rightColIdx, bandTopY)!;

      const leftAnchor  = findWallAnchor(leftPoly,  leftColXMax);
      const rightAnchor = findWallAnchor(rightPoly, rightColXMin);

      if (!shouldSpawnBridge(leftAnchor.y, rightAnchor.y, bandTopY, bandBottomY, MOCK_HEAP_HEIGHT_PX)) {
        if (this.debug) console.log(`[Bridge] bandY=${bandTopY} gap${gapIdx}: skipped — left=${Math.round(leftAnchor.y)} right=${Math.round(rightAnchor.y)}`);
        continue;
      }

      const bridgeW  = rightAnchor.x - leftAnchor.x;
      const bridgeCX = leftAnchor.x + bridgeW / 2;
      const bridgeCY = (leftAnchor.y + rightAnchor.y) / 2;
      const deltaY   = rightAnchor.y - leftAnchor.y;
      const length   = Math.sqrt(bridgeW * bridgeW + deltaY * deltaY);
      const angleDeg = Math.atan2(deltaY, bridgeW) * (180 / Math.PI);

      // One diagonal sprite for visuals
      const visual = this.scene.add.image(bridgeCX, bridgeCY, 'bridge');
      visual.setDisplaySize(length, this.def.bodyHeight);
      visual.setAngle(angleDeg);
      visual.setDepth(5);
      this.visuals.push(visual);

      // segW = bodyHeight / cos(angle) — widens with slope so each 4px-tall box
      // tiles seamlessly along the diagonal without gaps.
      const angleRad   = Math.atan2(Math.abs(deltaY), bridgeW);
      const segW       = this.def.colliderHeight / Math.max(Math.cos(angleRad), 0.15);
      const slopePerPx = deltaY / bridgeW;

      let cx = leftAnchor.x + segW / 2;
      while (cx < rightAnchor.x) {
        const cy  = leftAnchor.y + (cx - leftAnchor.x) * slopePerPx;
        const seg = this.group.create(cx, cy, 'bridge') as Phaser.Physics.Arcade.Sprite;
        seg.setVisible(false);
        seg.setDisplaySize(segW + 1, this.def.colliderHeight);
        seg.refreshBody();
        const body = seg.body as Phaser.Physics.Arcade.StaticBody;
        body.checkCollision.left  = false;
        body.checkCollision.right = false;
        cx += segW;
      }

      spawnedCount++;
    }

    if (this.debug) {
      if (spawnedCount > 0) {
        console.log(`[Bridge] bandY=${bandTopY} — spawned ${spawnedCount} bridge(s)`);
      } else {
        console.log(`[Bridge] bandY=${bandTopY} — no bridges`);
      }
    }
  }
}
