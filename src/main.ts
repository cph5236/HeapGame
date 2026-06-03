import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { HeapSelectScene } from './scenes/HeapSelectScene';
import { GameScene } from './scenes/GameScene';
import { ScoreScene } from './scenes/ScoreScene';
import { UpgradeScene } from './scenes/UpgradeScene';
import { StoreScene } from './scenes/StoreScene';
import { TexturePreviewScene } from './scenes/TexturePreviewScene';
import { InfiniteGameScene } from './scenes/InfiniteGameScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { WORLD_GRAVITY_Y } from './constants';
import { installAudioFocusGuard } from './systems/AudioFocusGuard';
import { InputManager } from './systems/InputManager';

// HiDPI text crispening. In RESIZE scale mode Phaser sizes the canvas backing
// store to CSS pixels (no devicePixelRatio multiply), so on high-DPR phones text
// is rendered at sub-native resolution and looks blurry. Phaser 3.90 defaults a
// Text object's resolution to 1, so we override the global `text` factory to
// default it to the device pixel ratio (capped to bound memory/CPU). This only
// changes the internal render resolution — display size and layout are unaffected
// — and any per-call `resolution` in the style still takes precedence.
const UI_TEXT_RESOLUTION = Math.min(
  typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  3,
);
Phaser.GameObjects.GameObjectFactory.register('text', function (
  this: Phaser.GameObjects.GameObjectFactory,
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle,
) {
  const merged = { resolution: UI_TEXT_RESOLUTION, ...(style ?? {}) };
  return this.displayList.add(
    new Phaser.GameObjects.Text(this.scene, x, y, text, merged),
  );
});

// Force Canvas renderer when using the dev scene shortcut — headless Chromium
// has no GPU context so WebGL produces a black canvas.
const isDevPreview = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('dev');

const config: Phaser.Types.Core.GameConfig = {
  type: isDevPreview ? Phaser.CANVAS : Phaser.AUTO,
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
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  render: {
    antialias: true,
    roundPixels: true,
  },
  fps: {
    target: 60,
    smoothStep: true,
  },
  scene: [BootScene, MenuScene, HeapSelectScene, GameScene, ScoreScene, UpgradeScene, StoreScene, InfiniteGameScene, TexturePreviewScene, LeaderboardScene],
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

// Restart UI scenes when the window is resized so they reposition their
// objects at the new canvas size. Gameplay scenes are excluded because a
// mid-game restart would discard all in-progress state.
//
// Guard: only restart once gameAssetsReady is true. If a resize fires during
// the initial asset load, restarting the scene orphans the loader's COMPLETE
// callback, which means gameAssetsReady never gets set and the START RUN
// button stays stuck in LOADING forever.
const RESIZE_SAFE_SCENES = ['MenuScene', 'HeapSelectScene', 'UpgradeScene', 'StoreScene', 'LeaderboardScene'];
let _resizeTimer: ReturnType<typeof setTimeout>;
let _lastResizeW = 0;
let _lastResizeH = 0;

game.scale.on(Phaser.Scale.Events.RESIZE, (gameSize: Phaser.Structs.Size) => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (game.registry.get('gameAssetsReady') !== true) return;

    const w = Math.round(gameSize.width);
    const h = Math.round(gameSize.height);
    if (w === _lastResizeW && h === _lastResizeH) return;
    _lastResizeW = w;
    _lastResizeH = h;

    for (const scene of game.scene.getScenes(true)) {
      if (RESIZE_SAFE_SCENES.includes(scene.scene.key)) {
        scene.scene.restart();
      }
    }
  }, 200);
});
