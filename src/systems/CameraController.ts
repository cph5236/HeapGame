import Phaser from 'phaser';

export class CameraController {
  static setup(
    scene: Phaser.Scene,
    target: Phaser.GameObjects.Sprite,
    worldWidth: number,
    worldHeight: number,
  ): void {
    scene.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    scene.cameras.main.startFollow(target, true, 1, 0.1);
    scene.cameras.main.centerOn(target.x, target.y);
  }
}
