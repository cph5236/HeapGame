import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HUD_THEME, makePanel, makeCloudIcon, makeWallJumpIcon, makeDashChevrons } from './hudTheme';
import { staminaSegments, dashBarFillFraction } from './hudLogic';
import { HUD_INSET, HUD_TRAY_PAD, MAX_STAMINA_CAP } from '../constants';

export class AbilityTray {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly player: Player;
  private readonly showDash: boolean;
  private readonly segBacks: Phaser.GameObjects.Rectangle[] = [];
  private readonly segFills: Phaser.GameObjects.Rectangle[] = [];
  private readonly cloudIcon: Phaser.GameObjects.Image;
  private readonly wallIcon: Phaser.GameObjects.Image;
  private readonly dashIcon?: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, player: Player, showDashIndicator: boolean) {
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
    const totalW = MAX_STAMINA_CAP * segW + (MAX_STAMINA_CAP - 1) * segGap;
    const segLeft = cx - totalW / 2;
    const rowY = top + HUD_TRAY_PAD + rowH / 2;
    for (let i = 0; i < MAX_STAMINA_CAP; i++) {
      const back = scene.add.rectangle(segLeft + i * (segW + segGap), rowY, segW, segH, 0x000000, 0.45)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(20)
        .setStrokeStyle(1, HUD_THEME.border, HUD_THEME.borderAlpha);
      const fill = scene.add.rectangle(segLeft + i * (segW + segGap), rowY, segW, segH, HUD_THEME.cloud, 1)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(21);
      this.segBacks.push(back); this.segFills.push(fill);
      this.objects.push(back, fill);
    }

    // Row 2 — the ability glyphs, side by side. The dash glyph only exists
    // when there's no on-screen dash button carrying the cooldown already
    // (mobile joystick mode) — see hudLogic.showDashIndicator. Two glyphs
    // are centred a bit closer together than three so the row still reads
    // as deliberate rather than leaving a gap where the third would sit.
    const glyphY = rowY + rowH;
    if (showDashIndicator) {
      this.cloudIcon = makeCloudIcon(scene, cx - 30, glyphY).setDepth(20);
      this.wallIcon  = makeWallJumpIcon(scene, cx, glyphY).setDepth(20);
      this.dashIcon  = makeDashChevrons(scene, cx + 22, glyphY).setDepth(20);
      this.objects.push(this.cloudIcon, this.wallIcon, this.dashIcon);
    } else {
      this.cloudIcon = makeCloudIcon(scene, cx - 18, glyphY).setDepth(20);
      this.wallIcon  = makeWallJumpIcon(scene, cx + 18, glyphY).setDepth(20);
      this.objects.push(this.cloudIcon, this.wallIcon);
    }
  }

  update(): void {
    const fills = staminaSegments(this.player.staminaCurrent, this.player.staminaMax);
    for (let i = 0; i < this.segFills.length; i++) {
      const visible = i < this.player.staminaMax;
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
    if (this.showDash && this.dashIcon) {
      this.dashIcon.setAlpha(0.25 + 0.75 * dashBarFillFraction(this.player.dashCooldownFraction));
    }
  }
}
