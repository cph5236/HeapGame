// src/entities/PlayerCosmetics.ts
//
// Visual cosmetic attachments for the in-game player: hat/face Images that
// follow the bag through squash/stretch, skin tint, and a movement trail
// emitter. Mirrors PlayerAnimator's POST_UPDATE sync so attachments never lag
// the physics-synced sprite by a frame. Tie color is PlayerAnimator's job.

import Phaser from 'phaser';
import type { ResolvedCosmetics } from '../systems/cosmeticsLogic';

/** Bag PNG is 174px wide displayed at 40 logical px — attachment art authored
 *  at the same ratio renders at matching scale. */
const ART_SCALE = 40 / 174;
/** Trail emits only while actually moving. */
const TRAIL_MIN_SPEED = 60;
/** Skin glaze strength — how strongly the flat skin color washes the bag. */
const SKIN_GLAZE_ALPHA = 0.26;

export class PlayerCosmetics {
  private readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private readonly scene:  Phaser.Scene;
  private readonly baseScaleX: number;
  private readonly baseScaleY: number;

  private hatImg:  Phaser.GameObjects.Image | null = null;
  private faceImg: Phaser.GameObjects.Image | null = null;
  private skinGlaze: Phaser.GameObjects.Image | null = null;
  private hatOffset  = { x: 0, y: 0 };
  private hatAngle   = 0;
  private hatScale   = 1;
  private faceOffset = { x: 0, y: 0 };
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private hidden = false;

  constructor(
    sprite:   Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
    scene:    Phaser.Scene,
    resolved: ResolvedCosmetics,
  ) {
    this.sprite     = sprite;
    this.scene      = scene;
    this.baseScaleX = sprite.scaleX;
    this.baseScaleY = sprite.scaleY;

    if (resolved.skinTint !== null) {
      // Multiply-tint alone is invisible on the near-black bag art, so lay a
      // translucent flat-color copy of the sprite over it (tintFill glaze).
      sprite.setTint(resolved.skinTint);
      this.skinGlaze = scene.add.image(sprite.x, sprite.y, sprite.texture.key)
        .setTintFill(resolved.skinTint).setAlpha(SKIN_GLAZE_ALPHA)
        .setDepth(sprite.depth + 0.1);
    }

    if (resolved.hat && scene.textures.exists(resolved.hat.textureKey)) {
      this.hatImg = scene.add.image(sprite.x, sprite.y, resolved.hat.textureKey)
        .setScale(ART_SCALE * resolved.hat.scale).setDepth(12);
      // Keep the hat's bottom edge (contact point) anchored as dScale grows
      // or shrinks it from the def's baseline, instead of scaling from center.
      const bottomAnchor = (this.hatImg.height / 2) * ART_SCALE * (resolved.hat.defScale - resolved.hat.scale);
      this.hatOffset = { x: resolved.hat.offsetX, y: resolved.hat.offsetY + bottomAnchor };
      this.hatAngle  = resolved.hat.angle;
      this.hatScale  = resolved.hat.scale;
    }
    if (resolved.face && scene.textures.exists(resolved.face.textureKey)) {
      this.faceImg = scene.add.image(sprite.x, sprite.y, resolved.face.textureKey)
        .setScale(ART_SCALE).setDepth(12);
      this.faceOffset = { x: resolved.face.offsetX, y: resolved.face.offsetY };
    }

    if (resolved.trail) {
      const t = resolved.trail;
      this.emitter = scene.add.particles(0, 0, t.textureKey, {
        tint:      t.tint,
        frequency: t.frequency,
        speedY:    { min: t.speedY[0], max: t.speedY[1] },
        speedX:    { min: -20, max: 20 },
        lifespan:  t.lifespan,
        scale:     { start: t.scale[0], end: t.scale[1] },
        alpha:     { start: t.alpha, end: 0 },
        emitting:  false,
      }).setDepth(9);
      this.emitter.startFollow(sprite);
    }

    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
  }

  /** Hide everything (death / successful placement) — mirrors the animator's dormant path. */
  hide(): void {
    this.hidden = true;
    this.hatImg?.setVisible(false);
    this.faceImg?.setVisible(false);
    this.skinGlaze?.setVisible(false);
    if (this.emitter) { this.emitter.stop(); this.emitter.setVisible(false); }
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
    this.hatImg?.destroy();
    this.faceImg?.destroy();
    this.skinGlaze?.destroy();
    this.emitter?.destroy();
  }

  private sync(): void {
    if (this.hidden) return;
    // Squash factors relative to the base display scale, so attachments
    // stretch with the bag through the animator's keyframes.
    const fx = this.sprite.scaleX / this.baseScaleX;
    const fy = this.sprite.scaleY / this.baseScaleY;
    const angle = this.sprite.angle;

    if (this.hatImg) {
      this.hatImg.setPosition(
        this.sprite.x + this.hatOffset.x * fx,
        this.sprite.y + this.hatOffset.y * fy,
      );
      this.hatImg.setScale(ART_SCALE * this.hatScale * fx, ART_SCALE * this.hatScale * fy);
      this.hatImg.setAngle(angle + this.hatAngle);
    }
    if (this.faceImg) {
      this.faceImg.setPosition(
        this.sprite.x + this.faceOffset.x * fx,
        this.sprite.y + this.faceOffset.y * fy,
      );
      this.faceImg.setScale(ART_SCALE * fx, ART_SCALE * fy);
      this.faceImg.setAngle(angle);
    }
    if (this.skinGlaze) {
      this.skinGlaze.setPosition(this.sprite.x, this.sprite.y);
      this.skinGlaze.setScale(this.sprite.scaleX, this.sprite.scaleY);
      this.skinGlaze.setAngle(angle);
      this.skinGlaze.setFlip(this.sprite.flipX, this.sprite.flipY);
      this.skinGlaze.setVisible(this.sprite.visible);
    }
    if (this.emitter) {
      const body = this.sprite.body;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > TRAIL_MIN_SPEED && !this.emitter.emitting) this.emitter.start();
      else if (speed <= TRAIL_MIN_SPEED && this.emitter.emitting) this.emitter.stop();
    }
  }
}
