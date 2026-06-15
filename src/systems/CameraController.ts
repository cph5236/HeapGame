import Phaser from 'phaser';
import { getDprCap } from './displayMetrics';

export class CameraController {
  static setup(
    scene: Phaser.Scene,
    target: Phaser.GameObjects.Sprite,
    worldWidth: number,
    worldHeight: number,
    worldX = 0,
    zoom = getDprCap(),
  ): void {
    scene.cameras.main.setBounds(worldX, 0, worldWidth, worldHeight);
    scene.cameras.main.setZoom(zoom);
    scene.cameras.main.startFollow(target, true, 1, 0.1);
    scene.cameras.main.centerOn(target.x, target.y);
  }
}
