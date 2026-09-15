import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HUD_THEME, makePanel, makeCloudIcon, makeWallJumpIcon, makeDashChevrons } from './hudTheme';
import { staminaSegments, dashBarFillFraction } from './hudLogic';
import { HUD_INSET, HUD_TRAY_PAD, MAX_STAMINA_CAP } from '../constants';

export class AbilityTray {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private showDash: boolean;
  private readonly segBacks: Phaser.GameObjects.Rectangle[] = [];
  private readonly segFills: Phaser.GameObjects.Rectangle[] = [];
  private readonly cloudIcon: Phaser.GameObjects.Image;
  private readonly wallIcon: Phaser.GameObjects.Image;
  private readonly dashIcon: Phaser.GameObjects.Image;
  private staminaFlashTween?: Phaser.Tweens.Tween;
  private destroyed = false;
  /** Segment geometry, kept so update() can re-centre the visible run when the
   *  player's max changes (see layoutSegments). */
  private readonly segW: number;
  private readonly segGap: number;
  private readonly trayCx: number;
  private readonly glyphY: number;
  /** Last max the segment row was laid out for; -1 forces a first layout. */
  private laidOutForMax = -1;

  constructor(scene: Phaser.Scene, player: Player, showDashIndicator: boolean) {
    this.scene = scene;
    this.player = player;
    this.showDash = showDashIndicator;

    // Tray geometry: a column anchored top-left under the inset. Two rows —
    // a segmented stamina bar, then the ability glyphs side by side — instead
    // of the old per-owned-ability row count, which always hit 4 rows once
    // everything was unlocked (too tall for phone portrait).
    const left = HUD_INSET, top = HUD_INSET;
    const colW = 108, rowH = 30;
    const panelH = HUD_TRAY_PAD * 2 + rowH * 2;
    const cx = left + colW / 2;

    this.objects.push(makePanel(scene, cx, top + panelH / 2, colW, panelH, 14).setDepth(19));

    // Row 1 — stamina. Segments are built at the cap (MAX_STAMINA_CAP) and
    // hidden above the player's current max, so a mid-run max change (or a
    // pickup that raises the cap) needs no rebuild — and a Balloon-style
    // extra bar always has a segment to fill, unlike the old pip row which
    // sized itself from the BASE air-jump count.
    const segW = 10, segGap = 2, segH = 12;
    const rowY = top + HUD_TRAY_PAD + rowH / 2;
    this.segW = segW; this.segGap = segGap; this.trayCx = cx;
    for (let i = 0; i < MAX_STAMINA_CAP; i++) {
      const back = scene.add.rectangle(0, rowY, segW, segH, 0x000000, 0.45)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(20)
        .setStrokeStyle(1, HUD_THEME.border, HUD_THEME.borderAlpha);
      const fill = scene.add.rectangle(0, rowY, segW, segH, HUD_THEME.cloud, 1)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(21);
      this.segBacks.push(back); this.segFills.push(fill);
      this.objects.push(back, fill);
    }
    // x is set by layoutSegments(), not here: laying the row out across the
    // full MAX_STAMINA_CAP span and then hiding the unowned tail left a fresh
    // player's 3 bars bunched against the left edge of the panel rather than
    // centred under it — and that bar is the first thing the tutorial's
    // stamina popup points at.
    this.layoutSegments(MAX_STAMINA_CAP);

    // Row 2 — the ability glyphs, side by side. The dash glyph only exists
    // when there's no on-screen dash button carrying the cooldown already
    // (mobile joystick mode) — see hudLogic.showDashIndicator. Two glyphs
    // are centred a bit closer together than three so the row still reads
    // as deliberate rather than leaving a gap where the third would sit.
    const glyphY = rowY + rowH;
    this.glyphY = glyphY;
    // The dash glyph is always built, then shown or hidden by
    // layoutGlyphs(). Building it conditionally would leave setShowDash()
    // (control-scheme change mid-run) with nothing to reveal.
    this.cloudIcon = makeCloudIcon(scene, cx, glyphY).setDepth(20);
    this.wallIcon  = makeWallJumpIcon(scene, cx, glyphY).setDepth(20);
    this.dashIcon  = makeDashChevrons(scene, cx, glyphY).setDepth(20);
    this.objects.push(this.cloudIcon, this.wallIcon, this.dashIcon);
    this.layoutGlyphs();

    // Stamina-empty feedback: Player emits this when a press fails purely for
    // want of stamina (there is deliberately no sound for it — the flash IS
    // the feedback). scene.events is a persistent EventEmitter that survives a
    // scene shutdown, so — same discipline as PlayerAnimator/PlayerCosmetics —
    // we must unsubscribe ourselves on SHUTDOWN rather than rely on Phaser's
    // GameObject auto-teardown, which doesn't touch listeners at all.
    scene.events.on('player-action', this.onPlayerAction, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Centre the first `visibleCount` segments under the tray, so a 3-bar
   *  player's row sits where an 8-bar player's row sits. */
  private layoutSegments(visibleCount: number): void {
    const n = Math.max(1, Math.min(MAX_STAMINA_CAP, visibleCount));
    const totalW = n * this.segW + (n - 1) * this.segGap;
    const left = this.trayCx - totalW / 2;
    for (let i = 0; i < MAX_STAMINA_CAP; i++) {
      const x = left + i * (this.segW + this.segGap);
      this.segBacks[i].x = x;
      this.segFills[i].x = x;
    }
    this.laidOutForMax = n;
  }

  /** Position and show/hide the glyph row for the current dash setting. Two
   *  glyphs are centred a bit closer together than three so the row still
   *  reads as deliberate rather than leaving a gap where the third would sit. */
  private layoutGlyphs(): void {
    const cx = this.trayCx, y = this.glyphY;
    if (this.showDash) {
      this.cloudIcon.setPosition(cx - 30, y);
      this.wallIcon.setPosition(cx, y);
      this.dashIcon.setPosition(cx + 22, y).setVisible(true);
    } else {
      this.cloudIcon.setPosition(cx - 18, y);
      this.wallIcon.setPosition(cx + 18, y);
      this.dashIcon.setVisible(false);
    }
  }

  /**
   * Re-gate the dash glyph after a mid-run control-scheme change. The tray is
   * built once at create() from showDashIndicator(isMobile, mode), but Settings
   * can change `mode` mid-run: without this, Tilt → Joystick left both the tray
   * glyph and the new on-screen dash button showing the cooldown, and Joystick
   * → Tilt left neither. Called from each gameplay scene's remountControls().
   */
  setShowDash(show: boolean): void {
    if (show === this.showDash) return;
    this.showDash = show;
    this.layoutGlyphs();
  }

  private readonly onPlayerAction = (action: string): void => {
    if (action === 'stamina-empty') this.flashStamina();
  };

  /** Brief pulse on the stamina segments — the whole feedback cue for running
   *  dry, since there's no sound for it. Re-triggering while already flashing
   *  restarts the pulse rather than stacking tweens. */
  private flashStamina(): void {
    this.staminaFlashTween?.stop();
    const targets = [...this.segBacks, ...this.segFills];
    for (const t of targets) t.setAlpha(1);
    this.staminaFlashTween = this.scene.tweens.add({
      targets,
      alpha: 0.15,
      duration: 70,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
      onComplete: () => { for (const t of targets) t.setAlpha(1); },
    });
  }

  /** Idempotent: reachable from both the scene's own teardown and SHUTDOWN. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.staminaFlashTween?.stop();
    this.scene.events.off('player-action', this.onPlayerAction, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  update(): void {
    const max = this.player.staminaMax;
    if (max !== this.laidOutForMax) this.layoutSegments(max);
    const fills = staminaSegments(this.player.staminaCurrent, max);
    for (let i = 0; i < this.segFills.length; i++) {
      const visible = i < max;
      this.segBacks[i].setVisible(visible);
      this.segFills[i].setVisible(visible);
      if (visible) this.segFills[i].scaleX = fills[i];
    }
    // Two independent gates: the bar answers "can I afford anything", the cloud
    // answers "is an air jump still available this airtime". Without the second,
    // a full bar plus a dead jump button reads as a bug.
    this.cloudIcon.setAlpha(this.player.airJumpsLeft > 0 ? 1 : 0.25);
    this.wallIcon.setAlpha(this.player.canWallJump ? 1 : 0.25);
    // Dash keeps a CONTINUOUS fill, not a binary toggle — "how long until dash?"
    // is a timing decision players make constantly.
    if (this.showDash) {
      this.dashIcon.setAlpha(0.25 + 0.75 * dashBarFillFraction(this.player.dashCooldownFraction));
    }
  }
}
