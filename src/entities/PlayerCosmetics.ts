// src/entities/PlayerCosmetics.ts
//
// Visual cosmetic attachments for the in-game player: hat/face rigs that
// follow the bag through squash/stretch, skin tint, and a movement trail
// emitter. Mirrors PlayerAnimator's POST_UPDATE sync so attachments never lag
// the physics-synced sprite by a frame. Tie color is PlayerAnimator's job.

import Phaser from 'phaser';
import type { ResolvedCosmetics } from '../systems/cosmeticsLogic';
import type { AttachmentRig } from './cosmeticRigs/types';
import { createAttachmentRig } from './cosmeticRigs/createAttachmentRig';

/** Trail emits only while actually moving. */
const TRAIL_MIN_SPEED = 60;
/** Skin glaze strength — how strongly the flat skin color washes the bag. */
const SKIN_GLAZE_ALPHA = 0.26;

export class PlayerCosmetics {
  private readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private readonly scene:  Phaser.Scene;
  private readonly baseScaleX: number;
  private readonly baseScaleY: number;

  private hatRig:  AttachmentRig | null = null;
  private faceRig: AttachmentRig | null = null;
  private skinGlaze: Phaser.GameObjects.Image | null = null;
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private hidden = false;
  private destroyed = false;
  private prevVx = 0;
  private prevVy = 0;

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

    if (resolved.hat)  this.hatRig  = createAttachmentRig(scene, resolved.hat);
    if (resolved.face) this.faceRig = createAttachmentRig(scene, resolved.face);

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
    // Own our own teardown rather than trusting the scene to call destroy().
    // Phaser only auto-invokes init/preload/create/update on a Scene — a
    // `shutdown()` method is NOT called unless the scene wires it to the
    // SHUTDOWN event itself, and the game scenes don't. Worse, Systems.shutdown
    // emits SHUTDOWN without calling removeAllListeners (only Systems.destroy
    // does), so a POST_UPDATE listener survives the scene stopping. The next
    // time that scene starts, the stale listener fired against a sprite Phaser
    // had already destroyed. Unsubscribing here makes that impossible.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Hide everything (death / successful placement) — mirrors the animator's dormant path. */
  hide(): void {
    this.hidden = true;
    this.hatRig?.setVisible(false);
    this.faceRig?.setVisible(false);
    this.skinGlaze?.setVisible(false);
    if (this.emitter) { this.emitter.stop(); this.emitter.setVisible(false); }
  }

  /** Idempotent: reachable from both the scene's own teardown and SHUTDOWN. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.hatRig?.destroy();
    this.faceRig?.destroy();
    this.skinGlaze?.destroy();
    this.emitter?.destroy();
  }

  private sync(_time: number, delta: number): void {
    if (this.hidden) return;
    // Squash factors relative to the base display scale, so attachments
    // stretch with the bag through the animator's keyframes.
    const fx = this.sprite.scaleX / this.baseScaleX;
    const fy = this.sprite.scaleY / this.baseScaleY;
    // Phaser's GameObject.destroy() sets `body` to undefined, so any frame that
    // lands between the sprite dying and this listener going away has no body
    // to read. Belt-and-braces alongside the SHUTDOWN unsubscribe above.
    const body = this.sprite.body;
    if (!body) return;
    const dt = Math.max(delta, 1);
    const motion = {
      vx: body.velocity.x,
      vy: body.velocity.y,
      ax: (body.velocity.x - this.prevVx) * 1000 / dt,
      ay: (body.velocity.y - this.prevVy) * 1000 / dt,
      grounded: body.blocked.down || body.touching.down,
    };
    this.prevVx = body.velocity.x;
    this.prevVy = body.velocity.y;
    const anchor = {
      x: this.sprite.x, y: this.sprite.y, fx, fy, angle: this.sprite.angle,
    };

    this.hatRig?.update(delta, anchor, motion);
    this.faceRig?.update(delta, anchor, motion);

    if (this.skinGlaze) {
      // The bag swaps to the dash spritesheet mid-run, so the glaze has to track
      // the live texture *and* frame or it pastes a static silhouette over it.
      this.skinGlaze.setTexture(this.sprite.texture.key, this.sprite.frame.name);
      this.skinGlaze.setPosition(this.sprite.x, this.sprite.y);
      this.skinGlaze.setScale(this.sprite.scaleX, this.sprite.scaleY);
      this.skinGlaze.setAngle(this.sprite.angle);
      this.skinGlaze.setFlip(this.sprite.flipX, this.sprite.flipY);
      this.skinGlaze.setVisible(this.sprite.visible);
    }
    if (this.emitter) {
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > TRAIL_MIN_SPEED && !this.emitter.emitting) this.emitter.start();
      else if (speed <= TRAIL_MIN_SPEED && this.emitter.emitting) this.emitter.stop();
    }
  }
}
