import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { HeapSelectScene } from './scenes/HeapSelectScene';
import { GameScene } from './scenes/GameScene';
import { ScoreScene } from './scenes/ScoreScene';
import { UpgradeScene } from './scenes/UpgradeScene';
import { StoreScene } from './scenes/StoreScene';
import { CustomizationScene } from './scenes/CustomizationScene';
import { TexturePreviewScene } from './scenes/TexturePreviewScene';
import { InfiniteGameScene } from './scenes/InfiniteGameScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { TutorialScene } from './scenes/TutorialScene';
import { PauseScene } from './scenes/PauseScene';
import { WORLD_GRAVITY_Y } from './constants';
import { installAudioFocusGuard } from './systems/AudioFocusGuard';
import { InputManager } from './systems/InputManager';
import { getDprCap, applyCameraZoom } from './systems/displayMetrics';

// HiDPI text crispening. The physical canvas (css × DPRcap backing store) is
// paired with camera zoom = DPRcap so logical content fills the physical pixels.
// Text uses getDprCap() resolution so characters render at native DPI. This only
// changes the internal render resolution — display size and layout are unaffected
// — and any per-call `resolution` in the style still takes precedence.
//
// We assign the prototype method DIRECTLY rather than via GameObjectFactory.register:
// register() is a no-op when a factory of that name already exists
// (`if (!prototype.hasOwnProperty(type))`), and Phaser's built-in 'text' factory is
// registered at import time — so register('text', …) silently never overrode it and
// text stayed at resolution 1 (blurry under the DPRcap camera zoom). Direct prototype
// assignment is the only way to win.
Phaser.GameObjects.GameObjectFactory.prototype.text = function (
  this: Phaser.GameObjects.GameObjectFactory,
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle,
): Phaser.GameObjects.Text {
  const merged = { resolution: getDprCap(), ...(style ?? {}) };
  return this.displayList.add(
    new Phaser.GameObjects.Text(this.scene, x, y, text, merged),
  ) as Phaser.GameObjects.Text;
};

// Force the Canvas renderer when using the dev scene shortcut OR the DPR-gate
// harness — headless Chromium has no GPU framebuffer, so WebGL fails to boot
// ("Framebuffer Unsupported") and the game never starts running. `?dev` also
// forces DPRcap=1 (scene-preview must stay logical); `?canvas` keeps real DPR so
// the gate can exercise the physical-resolution path under a renderer that boots.
const _params = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search) : new URLSearchParams();
const forceCanvas = _params.has('dev') || _params.has('canvas');

const config: Phaser.Types.Core.GameConfig = {
  type: forceCanvas ? Phaser.CANVAS : Phaser.AUTO,
  backgroundColor: '#5B8FC9',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: WORLD_GRAVITY_Y },
      overlapBias: 4, // default 4; raises the threshold for separating colliding bodies, reducing jitter on slopes
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
    // Initial size from the viewport; applyCanvasSize() corrects it to the actual
    // #game parent's layout (and pins the logical CSS size) at READY, before render.
    width: window.innerWidth * getDprCap(),
    height: window.innerHeight * getDprCap(),
  },
  // Multiple simultaneous touch pointers so the joystick (one thumb) can coexist
  // with the dash / GRAB / PLACE buttons and a jump tap from the other thumb.
  input: {
    activePointers: 3,
  },
  render: {
    antialias: true,
    roundPixels: true,
  },
  fps: {
    target: 60,
    smoothStep: true,
  },
  scene: [BootScene, MenuScene, HeapSelectScene, GameScene, ScoreScene, UpgradeScene, StoreScene, CustomizationScene, InfiniteGameScene, TexturePreviewScene, LeaderboardScene, TutorialScene, PauseScene],
  parent: 'game',
};

const game = new Phaser.Game(config);
installAudioFocusGuard();

// Let InputManager map touch coords (page space) into game space so it can
// hit-test on-screen button zones and swallow those taps (no accidental jump).
InputManager.getInstance().attachScreenTransform(game.scale);

// Dev-only: expose the game instance for scene-preview / debugging tooling.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { game: Phaser.Game }).game = game;
}

const RESIZE_SAFE_SCENES = ['MenuScene', 'HeapSelectScene', 'UpgradeScene', 'StoreScene', 'LeaderboardScene'];

/**
 * Size the canvas backing store to physical pixels (css × DPRcap) for crisp
 * rendering, while pinning the CSS display size to logical px (1:1 with the
 * device). Then re-cache the ScaleManager bounds (so touch transforms aren't
 * stale) and re-apply camera zoom on every live scene.
 */
function applyCanvasSize(): void {
  const parent = document.getElementById('game');
  if (!parent) return; // safety only — a missing #game parent would hard-fail the game anyway
  const cssW = parent.clientWidth || window.innerWidth;
  const cssH = parent.clientHeight || window.innerHeight;
  const dpr  = getDprCap();

  game.scale.resize(cssW * dpr, cssH * dpr);   // physical backing store

  const canvas = game.canvas;
  canvas.style.width  = cssW + 'px';           // logical display size
  canvas.style.height = cssH + 'px';

  // Re-cache canvasBounds + displayScale from the now-logical CSS style. Phaser
  // computes displayScale = baseSize(physical) / canvasBounds(logical) = DPRcap,
  // which is exactly what transformX/Y need to map page→physical game coords.
  game.scale.refresh();

  for (const scene of game.scene.getScenes(true)) {
    if (scene.cameras?.main) {
      scene.cameras.resize(cssW * dpr, cssH * dpr);
      applyCameraZoom(scene);
    }
  }
}

game.events.once(Phaser.Core.Events.READY, applyCanvasSize);

let _resizeTimer: ReturnType<typeof setTimeout>;
let _lastResizeW = 0;
let _lastResizeH = 0;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    // During asset load: keep the canvas sized correctly, but defer the UI-scene
    // restart until assets are ready (a mid-load restart orphans the loader).
    if (game.registry.get('gameAssetsReady') !== true) { applyCanvasSize(); return; }
    const parent = document.getElementById('game');
    const w = Math.round(parent?.clientWidth ?? window.innerWidth);
    const h = Math.round(parent?.clientHeight ?? window.innerHeight);
    if (w === _lastResizeW && h === _lastResizeH) return;
    _lastResizeW = w;
    _lastResizeH = h;
    applyCanvasSize();
    for (const scene of game.scene.getScenes(true)) {
      if (RESIZE_SAFE_SCENES.includes(scene.scene.key)) scene.scene.restart();
    }
  }, 200);
});
