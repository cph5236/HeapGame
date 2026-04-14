import Phaser from 'phaser';

export function generateAllTextures(scene: Phaser.Scene): void {
  generatePlatformTexture(scene);
  generateCloudTexture(scene);
  generateWallJumpTexture(scene);
  generateEnemyPercherTexture(scene);
  generateEnemyGhostTexture(scene);
}

function generatePlatformTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x8b5e3c, 1);
  g.fillRect(0, 0, 200, 64);
  g.lineStyle(2, 0xd4a96a, 0.8);
  g.strokeRect(0, 0, 200, 64);
  g.generateTexture('platform', 200, 64);
  g.destroy();
}

function generateCloudTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(10, 14, 8);
  g.fillCircle(18, 10, 10);
  g.fillCircle(26, 14, 8);
  g.fillRect(2, 14, 28, 8);
  g.generateTexture('cloud', 32, 22);
  g.destroy();
}

function generateWallJumpTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xaaaaaa, 1);
  g.fillRect(0, 0, 6, 32);
  g.fillStyle(0xffffff, 1);
  g.fillTriangle(8, 6, 8, 26, 22, 16);
  g.generateTexture('wall-jump', 24, 32);
  g.destroy();
}

function generateEnemyPercherTexture(scene: Phaser.Scene): void {
  // Rat: 24×24
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  // Ears
  g.fillStyle(0x777777, 1);
  g.fillRect(5, 1, 5, 6);
  g.fillRect(14, 1, 5, 6);
  g.fillStyle(0xffaaaa, 1);
  g.fillRect(6, 2, 3, 4);
  g.fillRect(15, 2, 3, 4);

  // Head
  g.fillStyle(0x888888, 1);
  g.fillRect(4, 5, 16, 9);

  // Body
  g.fillRect(3, 12, 18, 10);

  // Eyes
  g.fillStyle(0x000000, 1);
  g.fillRect(7, 7, 2, 2);
  g.fillRect(15, 7, 2, 2);
  g.fillStyle(0xff4444, 1);
  g.fillRect(8, 7, 1, 1);
  g.fillRect(16, 7, 1, 1);

  // Nose
  g.fillStyle(0xff8888, 1);
  g.fillRect(10, 13, 4, 2);

  // Whiskers
  g.fillStyle(0xcccccc, 1);
  g.fillRect(1, 13, 4, 1);
  g.fillRect(1, 15, 4, 1);
  g.fillRect(19, 13, 4, 1);
  g.fillRect(19, 15, 4, 1);

  // Tail
  g.fillStyle(0xaaaaaa, 1);
  g.fillRect(19, 19, 5, 2);

  g.generateTexture('enemy-percher', 50, 50);
  g.destroy();
}

function generateEnemyGhostTexture(scene: Phaser.Scene): void {
  // Vulture in flight: 36×36
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  // Wings spread wide — dark feathers
  g.fillStyle(0x1a1a1a, 1);
  g.fillTriangle(0, 20, 14, 15, 14, 24);   // left wing
  g.fillTriangle(36, 20, 22, 15, 22, 24);  // right wing

  // Wing tip feather detail
  g.fillStyle(0x2d2d2d, 1);
  g.fillTriangle(0, 20, 5, 16, 8, 23);
  g.fillTriangle(36, 20, 31, 16, 28, 23);

  // Body
  g.fillStyle(0x222222, 1);
  g.fillRect(12, 15, 12, 13);
  // Hunched back / shoulders
  g.fillRect(10, 13, 16, 5);

  // Bald pinkish head
  g.fillStyle(0xcc9977, 1);
  g.fillCircle(18, 11, 5);

  // Hooked beak pointing right
  g.fillStyle(0xddaa22, 1);
  g.fillTriangle(21, 9, 28, 12, 21, 14);

  // Beady eye
  g.fillStyle(0x000000, 1);
  g.fillRect(15, 10, 3, 3);
  g.fillStyle(0xffffff, 1);
  g.fillRect(15, 10, 1, 1);

  g.generateTexture('enemy-ghost', 36, 36);
  g.destroy();
}
