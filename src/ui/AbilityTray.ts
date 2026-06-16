import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HUD_THEME, makePanel, makeCloudIcon, makeWallJumpIcon, makeDashChevrons } from './hudTheme';
import { airJumpPipStates, dashBarFillFraction } from './hudLogic';
import { HUD_DASH_BAR_W, HUD_DASH_BAR_H, HUD_INSET, HUD_TRAY_PAD } from '../constants';

export class AbilityTray {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly player: Player;
  private readonly pips: Phaser.GameObjects.Arc[] = [];
  private readonly wallIcon?: Phaser.GameObjects.Image;
  private readonly dashFill?: Phaser.GameObjects.Rectangle;
  private readonly showDash: boolean;

  constructor(scene: Phaser.Scene, player: Player, showDashIndicator: boolean) {
    this.player = player;
    this.showDash = showDashIndicator;

    // Tray geometry: a column anchored top-left under the inset. Generous row
    // height + column width so the icons/pips don't feel cramped (PC feedback).
    const left = HUD_INSET;
    const top  = HUD_INSET;
    const colW = 70;
    const max  = player.maxAirJumpsCount;
    const hasWall = player.hasWallJump;
    const rows = 1 + (hasWall ? 1 : 0) + (showDashIndicator ? 1 : 0);
    const rowH = 32;
    const panelH = HUD_TRAY_PAD * 2 + rows * rowH;
    const cx = left + colW / 2;

    this.objects.push(
      makePanel(scene, cx, top + panelH / 2, colW, panelH, 14).setDepth(19),
    );

    let rowY = top + HUD_TRAY_PAD + rowH / 2;

    // Air-jump: cloud glyph + pip row (pips spaced out for clarity).
    this.objects.push(
      makeCloudIcon(scene, cx, rowY - 5).setDepth(20),
    );
    const pipGap = 13;
    const startX = cx - ((max - 1) * pipGap) / 2;
    for (let i = 0; i < max; i++) {
      const pip = scene.add.circle(startX + i * pipGap, rowY + 11, 3.5, HUD_THEME.cloud)
        .setScrollFactor(0).setDepth(20);
      this.pips.push(pip);
      this.objects.push(pip);
    }
    rowY += rowH;

    // Wall-jump icon (single charge → lit/dim).
    if (hasWall) {
      this.wallIcon = makeWallJumpIcon(scene, cx, rowY).setDepth(20);
      this.objects.push(this.wallIcon);
      rowY += rowH;
    }

    // Dash: slim cooldown bar (blue = charged) with orange-red accelerating
    // chevrons layered over its head (only when there's no on-screen dash button).
    if (showDashIndicator && player.hasDash) {
      const barLeft = cx - HUD_DASH_BAR_W / 2;
      this.objects.push(
        scene.add.rectangle(barLeft, rowY, HUD_DASH_BAR_W, HUD_DASH_BAR_H, 0x000000, 0.45)
          .setOrigin(0, 0.5).setScrollFactor(0).setDepth(20).setStrokeStyle(1, HUD_THEME.border, HUD_THEME.borderAlpha),
      );
      this.dashFill = scene.add.rectangle(barLeft, rowY, HUD_DASH_BAR_W, HUD_DASH_BAR_H, HUD_THEME.dashGlow, 1)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(21);
      this.objects.push(this.dashFill);
      this.objects.push(
        makeDashChevrons(scene, barLeft + 2, rowY).setDepth(22),
      );
    }
  }

  update(): void {
    const states = airJumpPipStates(this.player.airJumpsLeft, this.pips.length);
    for (let i = 0; i < this.pips.length; i++) this.pips[i].setAlpha(states[i] ? 1 : 0.22);

    if (this.wallIcon) this.wallIcon.setAlpha(this.player.canWallJump ? 1 : 0.25);

    if (this.showDash && this.dashFill) {
      const f = dashBarFillFraction(this.player.dashCooldownFraction);
      this.dashFill.scaleX = f;
      this.dashFill.fillColor = f >= 1 ? HUD_THEME.dashGlow : HUD_THEME.dashDim;
    }
  }
}
