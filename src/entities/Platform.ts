import Phaser from 'phaser';

export class Platform {
  readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithStaticBody;

  constructor(
    _scene: Phaser.Scene,
    group: Phaser.Physics.Arcade.StaticGroup,
    x: number,
    y: number,
    width: number,
    height: number,
    textureKey: string,
    visible = true,
  ) {
    this.sprite = group.create(
      x,
      y,
      textureKey,
    ) as Phaser.Types.Physics.Arcade.SpriteWithStaticBody;

    // Scale texture to desired dimensions
    this.sprite.setDisplaySize(width, height);

    // Resize the physics body to match display size.
    // refreshBody() is required after any static body resize.
    this.sprite.body.setSize(width, height);
    this.sprite.refreshBody();

    this.sprite.setDepth(5);
    if (!visible) this.sprite.setAlpha(0);
  }
}
