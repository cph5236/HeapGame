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
      gravity: { x: 0, y: 800 },
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

new Phaser.Game(config);
