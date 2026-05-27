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
