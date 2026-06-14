import type Phaser from 'phaser';
import { getDprCap } from './displayMetrics';

// Phaser scene-event names as string literals so this module stays a *type-only*
// phaser import. A value import (`import Phaser from 'phaser'`) pulls in phaser's
// OS detection, which references a bare `window` at load and throws in the Vitest
// `node` environment — breaking pure-logic unit tests that transitively import
// this file. Values from Phaser.Scenes.Events: ADDED_TO_SCENE / SHUTDOWN.
const ADDED_TO_SCENE = 'addedtoscene';
const SHUTDOWN       = 'shutdown';

interface UiCameraContext {
  uiCam:   Phaser.Cameras.Scene2D.Camera;
  uiLayer: Phaser.GameObjects.Layer;
  add(obj: Phaser.GameObjects.GameObject): void;
}

const CONTEXTS = new WeakMap<Phaser.Scene, UiCameraContext>();

/**
 * Gameplay scenes follow the player with a zoomed (DPRcap) main camera. A zoomed
 * *following* camera pivots on its physical viewport centre, so it can't also pin
 * the logical UI origin the way a static menu camera does — screen-space HUD
 * authored in logical coords renders off-frame. Fix: a dedicated, non-following
 * UI camera (zoom = DPRcap, centred on the logical origin) that draws ONLY a UI
 * layer, while the main camera ignores that layer:
 *   • main camera ignores the UI layer  → HUD never doubles into world space
 *   • UI camera ignores every world object (current + future) → world never
 *     doubles over the HUD; it renders only the UI layer
 *
 * Call as the FIRST line of a gameplay scene's create(). Register every
 * screen-space object via {@link addToGameplayUi}; world objects need no action
 * (the ADDED_TO_SCENE hook auto-ignores them on the UI camera).
 */
export function setupGameplayUiCamera(scene: Phaser.Scene): void {
  const main = scene.cameras.main;

  const uiLayer = scene.add.layer();
  uiLayer.setDepth(1_000); // cosmetic; the two cameras render disjoint sets anyway
  const uiLayerGO = uiLayer as unknown as Phaser.GameObjects.GameObject;

  // The HUD/buttons are all setScrollFactor(0), so they ignore camera scroll —
  // centreOn (which works by setting scroll, as static menu scenes do) would
  // leave them off-frame. Instead pin origin to (0,0) with scroll 0 and zoom
  // DPRcap: a scroll-factor-0 object authored at logical (x,y) then renders at
  // physical (x·DPRcap, y·DPRcap), exactly filling the physical canvas.
  const uiCam = scene.cameras.add();
  uiCam.setOrigin(0, 0);
  uiCam.setZoom(getDprCap());

  // Split the cameras: main never draws the UI layer; the UI cam never draws world.
  main.ignore(uiLayer);
  for (const child of scene.children.list) {
    if (child !== uiLayerGO) uiCam.ignore(child);
  }

  // Future objects default to world: ignore them on the UI cam. UI objects are
  // moved into uiLayer by addToGameplayUi, which clears this ignore bit again.
  const onAdded = (obj: Phaser.GameObjects.GameObject): void => {
    if (obj === uiLayerGO) return;
    if (obj.displayList === uiLayer) return; // already a UI object
    uiCam.ignore(obj);
  };
  scene.events.on(ADDED_TO_SCENE, onAdded);
  scene.events.once(SHUTDOWN, () => {
    scene.events.off(ADDED_TO_SCENE, onAdded);
    CONTEXTS.delete(scene);
  });

  CONTEXTS.set(scene, {
    uiCam,
    uiLayer,
    add(obj) {
      uiLayer.add(obj); // leaves the scene display list → main camera (which ignores
                        // the layer) no longer draws it
      // The ADDED_TO_SCENE hook above auto-ignored this object on the UI camera
      // (it couldn't yet know it was UI). Clear that bit so the UI camera draws it.
      obj.cameraFilter &= ~uiCam.id;
    },
  });
}

/**
 * Register a screen-space object (HUD / button / joystick) into the gameplay UI
 * layer so it renders on the UI camera and not doubled in world space. No-op when
 * the scene has no UI camera (unit tests, static scenes, scene-preview without a
 * gameplay scene), so it's always safe to call from shared UI creators.
 */
export function addToGameplayUi(
  scene: Phaser.Scene,
  objs: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[],
): void {
  const ctx = CONTEXTS.get(scene);
  if (!ctx) return;
  if (Array.isArray(objs)) {
    for (const o of objs) ctx.add(o);
  } else {
    ctx.add(objs);
  }
}
