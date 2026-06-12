import type Phaser from 'phaser';

/** Hard ceiling on render resolution. Bounds the ~DPRcap² fill cost on flagship
 *  phones while keeping text near-native on a ~2.6 DPR device (see spec §"Decisions"). */
export const DPR_CAP = 2.5;

/** Effective device pixel ratio used for the physical canvas + camera zoom.
 *  Returns 1 under the scene-preview (`?dev`) tooling, which forces the Canvas
 *  renderer at a fixed device size and must stay logical. */
export function getDprCap(): number {
  if (typeof window === 'undefined') return 1;
  const isScenePreview =
    typeof window.location !== 'undefined' &&
    new URLSearchParams(window.location.search).has('dev');
  if (isScenePreview) return 1;
  const dpr = window.devicePixelRatio;
  return Math.min(typeof dpr === 'number' && dpr > 0 ? dpr : 1, DPR_CAP);
}

/** Logical (CSS-pixel) viewport width. `scene.scale.width` is physical once the
 *  game size is `css × DPRcap`; divide it back to author layout in logical px. */
export function logicalWidth(scene: Phaser.Scene): number {
  return scene.scale.width / getDprCap();
}

/** Logical (CSS-pixel) viewport height. See {@link logicalWidth}. */
export function logicalHeight(scene: Phaser.Scene): number {
  return scene.scale.height / getDprCap();
}

/** Set a scene's main camera zoom to DPRcap so logical-authored content fills the
 *  physical canvas. Idempotent — safe to call again after a scene restart. */
export function applyCameraZoom(scene: Phaser.Scene): void {
  scene.cameras.main.setZoom(getDprCap());
}
