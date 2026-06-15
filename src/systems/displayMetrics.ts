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
 *  physical canvas. Zoom only — does NOT recentre, so it's safe to call on a
 *  following gameplay camera (e.g. from the resize loop). Idempotent. */
export function applyCameraZoom(scene: Phaser.Scene): void {
  scene.cameras.main.setZoom(getDprCap());
}

/** Configure a static UI scene's camera for the physical canvas: origin (0,0) +
 *  scroll 0 + zoom = DPRcap. With this, a logical-authored object at (x,y) renders
 *  at physical (x·DPRcap, y·DPRcap), filling the canvas — REGARDLESS of its
 *  scrollFactor.
 *
 *  This must NOT use centreOn: centreOn fills the frame by setting scroll, but
 *  setScrollFactor(0) objects ignore scroll, so a centred camera leaves every
 *  fixed/overlay element (e.g. PauseScene's full-screen dim + buttons) pushed
 *  off-frame under zoom. origin-0 has no such dependence and matches the gameplay
 *  UI camera. Scrolling UI scenes (Upgrade/Store) capture cam.scrollY (= 0 here) as
 *  their scroll baseline and clamp relative to it, so they are unaffected. */
export function setupUiCamera(scene: Phaser.Scene): void {
  const cam = scene.cameras.main;
  cam.setOrigin(0, 0);
  cam.setZoom(getDprCap());
}
