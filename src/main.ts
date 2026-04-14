import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { ScoreScene } from './scenes/ScoreScene';
import { UpgradeScene } from './scenes/UpgradeScene';
import { StoreScene } from './scenes/StoreScene';
import { TexturePreviewScene } from './scenes/TexturePreviewScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 480,
  height: 854,
  backgroundColor: '#5B8FC9',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 800 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    roundPixels: true,
  },
  fps: {
    target: 60,
    smoothStep: true,
  },
  scene: [BootScene, MenuScene, GameScene, ScoreScene, UpgradeScene, StoreScene, TexturePreviewScene],
  parent: 'game',
};

new Phaser.Game(config);
